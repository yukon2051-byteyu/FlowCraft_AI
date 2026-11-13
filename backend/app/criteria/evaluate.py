"""完了基準の評価（タスク2-2。docs/completion-criteria.md §5）。

実行の直後に、作業手順の完了基準を1つずつプログラムで確かめる。AIは使わない。
結果は次のどれか：

| status         | 画面の名前         | 意味 |
|----------------|--------------------|------|
| passed         | 満たしている       | 条件を満たした |
| failed         | 満たしていない     | 条件を満たさない（重さは on_fail による） |
| unverified     | 未検証             | **確かめられなかった。満たしているとはみなさない** |
| not_applicable | 対象外             | その実行では確かめる意味がない（後で追加する前回比較で使う） |
| recorded       | 記録               | 一覧にするだけの基準（list_rows）。判定に使わない |

未検証になるのは：対象のステップが実行されなかった・対象の列がない・実行時に指定する値が未入力／形が違う・
AIの提案が未確認・列のデータの形式が基準に合わない、のいずれか。理由を必ず書く。

根拠（evidence）には、判定に使った値を文字列で残す（例：集計前 20,818,240／集計後 20,818,240／差額 0）。

例（examples）の行番号は2種類あり、名前で区別する（同じ「行」と書くと、どちらか分からないため）：
- 「Excelの行」：元のファイル上の行番号（見出しの行を含む）。読み込みで見つかった形式の誤りに使う
- 「結果の行」：確かめた結果（表）の、見出しを除いた何行目か。途中のステップの結果は元のファイルと並びが違うため
"""

from __future__ import annotations

import calendar
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from app.engine.convert import is_missing, to_string
from app.engine.nodes.common import MAX_EXAMPLES
from app.engine.nodes.filter import _conditions, _eval, _prepare
from app.engine.nodes.quality_nodes import find_duplicates
from app.engine.result import NodeFailure, RunResult
from app.engine.table import Table
from app.flow.schema import (
    AllMatchedCriterion,
    DataTypeCriterion,
    ExpectedValueCriterion,
    FlowDefinition,
    JoinNode,
    ListRowsCriterion,
    LoadNode,
    NoBlankCriterion,
    ParamRef,
    PeriodCriterion,
    RequiredColumnsCriterion,
    RowCountCriterion,
    RunParameter,
    TotalMatchCriterion,
    UniqueCriterion,
    ValueRangeCriterion,
)

CriterionStatus = Literal["passed", "failed", "unverified", "not_applicable", "recorded"]

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


@dataclass
class CriterionResult:
    criterion_id: str
    name: str
    kind: str
    on_fail: str
    status: CriterionStatus
    # 判定の理由（1文。画面とExcelにそのまま出す）
    summary: str
    # 判定に使った値（ラベル → 表示用の文字列）。例 {"集計前": "20,818,240", "集計後": "20,818,240", "差額": "0"}
    evidence: dict[str, str] = field(default_factory=dict)
    # 該当した行などの例（最大5件）
    examples: list[dict[str, Any]] = field(default_factory=list)
    how_to_fix: str | None = None


class _Unverified(Exception):
    """確かめられなかった（理由つき）。評価の途中で投げ、未検証として記録する。"""

    def __init__(self, reason: str, how_to_fix: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.how_to_fix = how_to_fix


def _fmt(v: Any) -> str:
    """根拠の値を表示用の文字列にする（数値は3桁区切り）。"""
    if isinstance(v, bool):
        return "はい" if v else "いいえ"
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, Decimal):
        return f"{v:,f}"
    if isinstance(v, date):
        return v.isoformat()
    return to_string(v) or "（空欄）"


# ---------------------------------------------------------------------------
# 実行時に指定する値
# ---------------------------------------------------------------------------


def check_run_parameters(params: list[RunParameter], values: dict[str, str]) -> dict[str, str]:
    """実行時に指定する値の形を確かめる。戻り値は {param_id: 問題の説明}（問題がなければ空）。"""
    problems: dict[str, str] = {}
    for p in params:
        v = (values.get(p.param_id) or "").strip()
        if not v:
            if p.required:
                problems[p.param_id] = f"「{p.label}」が入力されていません"
            continue
        if p.type == "month" and not _MONTH.match(v):
            problems[p.param_id] = f"「{p.label}」は「2026-10」の形で入力してください（入力：{v}）"
        elif p.type == "date" and _parse_date(v) is None:
            problems[p.param_id] = f"「{p.label}」は「2026-10-01」の形で入力してください（入力：{v}）"
        elif p.type == "integer" and not re.fullmatch(r"-?\d+", v.replace(",", "")):
            problems[p.param_id] = f"「{p.label}」は整数で入力してください（入力：{v}）"
        elif p.type == "decimal" and _parse_decimal(v) is None:
            problems[p.param_id] = f"「{p.label}」は数値で入力してください（入力：{v}）"
    return problems


def _parse_date(v: str) -> date | None:
    try:
        return date.fromisoformat(v) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else None
    except ValueError:
        return None


def _parse_decimal(v: str) -> Decimal | None:
    try:
        d = Decimal(v.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


class _Context:
    def __init__(self, flow: FlowDefinition, result: RunResult, tables: dict[str, Table], values: dict[str, str]):
        self.flow = flow
        self.result = result
        self.tables = tables
        self.values = {k: (v or "").strip() for k, v in values.items()}
        self.params = {p.param_id: p for p in flow.run_parameters}
        self.param_problems = check_run_parameters(flow.run_parameters, values)
        self.runs = {r.node_id: r for r in result.nodes}
        # 参照名 → それを作るステップ
        self.producer = {n.output_reference: n for n in flow.nodes if n.output_reference}

    def value(self, v: Any, what: str) -> str:
        """基準の値を取り出す。実行時に指定する値なら、入力された値（未入力・形の誤りなら未検証）"""
        if isinstance(v, ParamRef):
            p = self.params[v.param]
            if v.param in self.param_problems:
                raise _Unverified(f"{what}に使う{self.param_problems[v.param]}。", "実行するときに、正しい値を入力してください。")
            got = self.values.get(v.param, "")
            if not got:
                raise _Unverified(f"{what}に使う「{p.label}」が入力されていません。", "実行するときに値を入力してください。")
            return got
        return str(v)

    def table(self, ref: str) -> Table:
        """対象の表。対象のステップが実行されなかった（途中で止まった）ときは未検証"""
        if ref in self.tables:
            return self.tables[ref]
        node = self.producer.get(ref)
        name = f"「{node.node_name}」" if node else f"（{ref}）"
        raise _Unverified(f"対象のステップ{name}が実行されなかったため、確かめられませんでした。", "先に、止まったステップの問題を直してください。")

    def column(self, table: Table, column: str | None) -> str:
        if not column:
            raise _Unverified("確かめる列が指定されていません。", "完了基準の設定で、確かめる列を選んでください。")
        if column not in table.columns:
            raise _Unverified(f"列「{column}」が対象の結果にないため、確かめられませんでした。", "列の名前が変わっていないか、完了基準の対象の列を確かめてください。")
        return column


# ---------------------------------------------------------------------------
# 種類ごとの評価
# ---------------------------------------------------------------------------

Outcome = tuple[CriterionStatus, str, dict[str, str], list[dict[str, Any]], str | None]


def _load_node(ctx: _Context, input_id: str) -> LoadNode:
    for n in ctx.flow.nodes:
        if isinstance(n, LoadNode) and n.parameters.input_id == input_id:
            return n
    raise _Unverified(f"入力（{input_id}）を読み込むステップがないため、確かめられませんでした。")


def _eval_required_columns(c: RequiredColumnsCriterion, ctx: _Context) -> Outcome:
    definition = next(d for d in ctx.flow.input_definitions if d.input_id == c.target.ref)
    wanted = c.params.columns or [col.name for col in definition.columns if col.required]
    if not wanted:
        raise _Unverified("確かめる列がありません（入力の定義に「必ずある列」がありません）。", "完了基準で確かめる列を指定してください。")
    load = _load_node(ctx, c.target.ref)
    run = ctx.runs[load.node_id]
    if run.status == "error":
        failure = next((i for i in run.issues if i.code == "MISSING_COLUMNS"), None)
        if failure is None:
            raise _Unverified(f"「{load.node_name}」が別の理由で止まったため、列を確かめられませんでした。")
        missing = [m for m in failure.details.get("missing", []) if m in wanted] or list(failure.details.get("missing", []))
        return ("failed", f"必要な列がありません：{'、'.join(missing)}", {"足りない列": "、".join(missing), "確かめた列": f"{len(wanted)}列"}, [], failure.how_to_fix)
    if run.status == "skipped":
        raise _Unverified(f"「{load.node_name}」が実行されなかったため、確かめられませんでした。")
    # 任意の列がファイルになかった場合、読み込みでは空欄の列として補っている。補った列は「なかった」と数える
    added = {str(i.details.get("column")) for i in run.issues if i.code == "OPTIONAL_COLUMN_ADDED"}
    table = ctx.tables.get(load.output_reference or "")
    present = set(table.columns) if table else set()
    missing = [w for w in wanted if w not in present or w in added]
    ev = {"確かめた列": f"{len(wanted)}列", "足りない列": "、".join(missing) or "なし"}
    if missing:
        return ("failed", f"必要な列がありません：{'、'.join(missing)}", ev, [], "ファイルの列名が変わっていないか確かめてください。")
    return ("passed", f"必要な列（{len(wanted)}列）がそろっています。", ev, [], None)


def _eval_data_type(c: DataTypeCriterion, ctx: _Context) -> Outcome:
    column = c.target.column or ""
    definition = next(d for d in ctx.flow.input_definitions if d.input_id == c.target.ref)
    col = next((x for x in definition.columns if x.name == column), None)
    if col is None:
        raise _Unverified(f"列「{column}」は入力の定義にないため、確かめられませんでした。", "完了基準の対象の列を確かめてください。")
    load = _load_node(ctx, c.target.ref)
    run = ctx.runs[load.node_id]
    type_label = {"integer": "整数", "decimal": "小数", "date": "日付", "boolean": "はい／いいえ", "string": "文字"}[col.type]
    if run.status == "error":
        failure = next((i for i in run.issues if i.code == "TYPE_CONVERSION_FAILED"), None)
        if failure is None:
            raise _Unverified(f"「{load.node_name}」が別の理由で止まったため、データの形式を確かめられませんでした。")
        f = failure.details.get("failures", {}).get(column)
        if f is None:
            raise _Unverified(f"「{load.node_name}」がほかの列の形式の誤りで止まったため、列「{column}」は確かめられませんでした。")
        ex = [{"Excelの行": e["row"], "値": e["value"]} for e in f["examples"]]
        return ("failed", f"列「{column}」に、{type_label}にできない値が{f['count']:,}件あります。", {"形式": type_label, "変換できない件数": f"{f['count']:,}"}, ex, failure.how_to_fix)
    if run.status == "skipped":
        raise _Unverified(f"「{load.node_name}」が実行されなかったため、確かめられませんでした。")
    # 読み込みが成功した＝定義した形式に、すべての値を変換できた
    return ("passed", f"列「{column}」の値は、すべて{type_label}として読み込めました。", {"形式": type_label, "変換できない件数": "0"}, [], None)


def _eval_no_blank(c: NoBlankCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    column = ctx.column(table, c.target.column)
    rows = [i for i, v in enumerate(table.data[column]) if is_missing(v)]
    ev = {"空欄の件数": f"{len(rows):,}", "許容件数": f"{c.params.max_count:,}", "確かめた行数": f"{table.row_count:,}"}
    ex = [{"結果の行": i + 1} for i in rows[:MAX_EXAMPLES]]
    if len(rows) > c.params.max_count:
        return ("failed", f"列「{column}」に空欄が{len(rows):,}件あります（許容 {c.params.max_count:,}件）。", ev, ex, "空欄の行を確かめ、元のファイルを直してください。")
    return ("passed", f"列「{column}」の空欄は{len(rows):,}件で、許容件数以内です。", ev, ex, None)


def _eval_unique(c: UniqueCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    for col in c.params.columns:
        ctx.column(table, col)
    _, d = find_duplicates(table, c.params.columns)
    label = "・".join(c.params.columns)
    ev = {"重複したキー": f"{d['duplicate_keys']:,}種類", "重複している行": f"{d['duplicate_rows']:,}行", "キーに空欄を含む行": f"{d['blank_key_rows']:,}行"}
    ex = [{"キー": e["key"], "件数": e["count"], "結果の行": "、".join(map(str, e["rows"]))} for e in d["examples"]]
    if d["duplicate_keys"]:
        return ("failed", f"「{label}」が重複している行が{d['duplicate_rows']:,}行（{d['duplicate_keys']:,}種類）あります。", ev, ex, "重複している行を確かめ、同じものが二重に記録されていれば、元のファイルから取り除いて再実行してください（二重計上の防止）。")
    return ("passed", f"「{label}」に重複はありません。", ev, ex, None)


def _comparable(table: Table, column: str, raw: str, what: str) -> Any:
    """基準の値を、列の形式（数値・日付）にそろえる"""
    t = table.type_of(column)
    if t in ("integer", "decimal"):
        d = _parse_decimal(raw)
        if d is None:
            raise _Unverified(f"{what}「{raw}」は数値ではないため、数値の列「{column}」と比べられませんでした。", "完了基準の値を確かめてください。")
        return d
    if t == "date":
        d2 = _parse_date(raw)
        if d2 is None:
            raise _Unverified(f"{what}「{raw}」は日付（2026-10-01 の形）ではないため、日付の列「{column}」と比べられませんでした。", "完了基準の値を確かめてください。")
        return d2
    raise _Unverified(f"列「{column}」は数値・日付の列ではないため、範囲を確かめられませんでした。", "数値か日付の列を対象にしてください。")


def _out_of(table: Table, column: str, low: Any, high: Any) -> tuple[list[int], int]:
    out: list[int] = []
    blanks = 0
    for i, v in enumerate(table.data[column]):
        if v is None:
            blanks += 1
            continue
        if (low is not None and v < low) or (high is not None and v > high):
            out.append(i)
    return out, blanks


def _eval_value_range(c: ValueRangeCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    column = ctx.column(table, c.target.column)
    low = _comparable(table, column, ctx.value(c.params.min, "最小"), "最小") if c.params.min is not None else None
    high = _comparable(table, column, ctx.value(c.params.max, "最大"), "最大") if c.params.max is not None else None
    out, blanks = _out_of(table, column, low, high)
    rng = f"{_fmt(low) if low is not None else ''}〜{_fmt(high) if high is not None else ''}"
    ev = {"範囲": rng, "範囲外の件数": f"{len(out):,}", "空欄（確かめていない）": f"{blanks:,}"}
    ex = [{"結果の行": i + 1, "値": _fmt(table.data[column][i])} for i in out[:MAX_EXAMPLES]]
    if out:
        return ("failed", f"列「{column}」に、範囲（{rng}）の外の値が{len(out):,}件あります。", ev, ex, "範囲外の値を確かめてください。")
    return ("passed", f"列「{column}」の値は、すべて範囲（{rng}）の中です。", ev, ex, None)


def _eval_period(c: PeriodCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    column = ctx.column(table, c.target.column)
    if table.type_of(column) != "date":
        raise _Unverified(f"列「{column}」は日付の列ではないため、対象期間を確かめられませんでした。", "日付の列を対象にしてください。")
    if c.params.month is not None:
        raw = ctx.value(c.params.month, "対象の月")
        m = _MONTH.match(raw)
        if not m:
            raise _Unverified(f"対象の月「{raw}」の形が正しくないため、確かめられませんでした（例：2026-10）。")
        y, mo = int(m.group(1)), int(m.group(2))
        start, end = date(y, mo, 1), date(y, mo, calendar.monthrange(y, mo)[1])
    else:
        start = _comparable(table, column, ctx.value(c.params.start, "開始日"), "開始日") if c.params.start is not None else None
        end = _comparable(table, column, ctx.value(c.params.end, "終了日"), "終了日") if c.params.end is not None else None
    out, blanks = _out_of(table, column, start, end)
    present = [v for v in table.data[column] if v is not None]
    period = f"{start.isoformat() if start else ''}〜{end.isoformat() if end else ''}"
    ev = {
        "対象期間": period,
        "期間外の件数": f"{len(out):,}",
        "最も早い日": min(present).isoformat() if present else "（なし）",
        "最も遅い日": max(present).isoformat() if present else "（なし）",
        "空欄（確かめていない）": f"{blanks:,}",
    }
    ex = [{"結果の行": i + 1, "日付": _fmt(table.data[column][i])} for i in out[:MAX_EXAMPLES]]
    if out:
        return ("failed", f"対象期間（{period}）の外の日付が{len(out):,}件あります。", ev, ex, "別の月のデータが混ざっていないか、元のファイルを確かめてください。")
    return ("passed", f"列「{column}」の日付は、すべて対象期間（{period}）の中です。", ev, ex, None)


def _sum(table: Table, column: str) -> Decimal:
    if table.type_of(column) not in ("integer", "decimal"):
        raise _Unverified(f"列「{column}」は数値の列ではないため、合計を計算できませんでした。", "数値の列を対象にしてください。")
    return sum((Decimal(v) for v in table.data[column] if v is not None), Decimal(0))


def _eval_total_match(c: TotalMatchCriterion, ctx: _Context) -> Outcome:
    a_table = ctx.table(c.target.ref)
    a_col = ctx.column(a_table, c.target.column)
    b_table = ctx.table(c.params.compare_ref)
    b_col = ctx.column(b_table, c.params.compare_column)
    a, b = _sum(a_table, a_col), _sum(b_table, b_col)
    diff = abs(a - b)
    tol = Decimal(c.params.tolerance)
    a_name = ctx.producer[c.target.ref].node_name if c.target.ref in ctx.producer else c.target.ref
    b_name = ctx.producer[c.params.compare_ref].node_name if c.params.compare_ref in ctx.producer else c.params.compare_ref
    ev = {f"比べる相手（{b_name}・{b_col}）": _fmt(b), f"対象（{a_name}・{a_col}）": _fmt(a), "差額": _fmt(diff), "許容差": _fmt(tol)}
    if diff > tol:
        return ("failed", f"合計が一致しません（差額 {_fmt(diff)}、許容差 {_fmt(tol)}）。", ev, [], "集計の条件や、途中で除外された行がないかを確かめてください。")
    return ("passed", f"合計が一致しています（{_fmt(a)}、差額 {_fmt(diff)}）。", ev, [], None)


def _eval_row_count(c: RowCountCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    n = table.row_count
    rng = f"{c.params.min:,}" if c.params.min is not None else ""
    rng += "〜" + (f"{c.params.max:,}" if c.params.max is not None else "")
    ev = {"件数": f"{n:,}", "範囲": rng}
    if (c.params.min is not None and n < c.params.min) or (c.params.max is not None and n > c.params.max):
        return ("failed", f"件数が{n:,}件で、範囲（{rng}）の外です。", ev, [], "元のファイルの行数や、途中の条件を確かめてください。")
    return ("passed", f"件数は{n:,}件で、範囲（{rng}）の中です。", ev, [], None)


_CAUSE_LABEL = {
    "TRIM": "前後の空白（取り除けば一致）",
    "WIDTH": "全角・半角の違い（そろえれば一致）",
    "CASE": "大文字・小文字の違い（そろえれば一致）",
    "LEADING_ZERO": "先頭の0の有無（そろえれば一致）",
}


def _eval_all_matched(c: AllMatchedCriterion, ctx: _Context) -> Outcome:
    join = ctx.producer.get(c.target.ref)
    if not isinstance(join, JoinNode):
        raise _Unverified("対象が「別の表から情報を付け加える」ステップではないため、確かめられませんでした。")
    run = ctx.runs[join.node_id]
    if run.status == "skipped":
        raise _Unverified(f"「{join.node_name}」が実行されなかったため、確かめられませんでした。", "先に、止まったステップの問題を直してください。")
    unmatched = [i for i in run.issues if i.code == "UNMATCHED_RECORDS"]
    if run.status == "error" and not unmatched:
        raise _Unverified(f"「{join.node_name}」が別の理由で止まったため、確かめられませんでした。")
    rows = sum(int(i.details.get("unmatched_rows", 0)) + int(i.details.get("blank_key_rows", 0)) for i in unmatched)
    keys = [k for i in unmatched for k in i.details.get("unmatched_keys", [])]
    ev = {"照合できない行": f"{rows:,}", "許容件数": f"{c.params.max_count:,}"}
    # 原因の内訳（行数）：表記の違いで説明できるもの／相手の表にない値／照合キーが空欄 を分けて示す。
    # 「空白を除けばすべて直る」ように見せないため、説明できない残りも必ず示す
    explained = 0
    for i in unmatched:
        for cause in i.details.get("cause_candidates", []):
            n = int(cause.get("rows", 0))
            if n:
                explained += n
                ev[f"原因：{_CAUSE_LABEL.get(cause.get('code', ''), cause['label'])}"] = f"{n:,}行"
    blank = sum(int(i.details.get("blank_key_rows", 0)) for i in unmatched)
    missing = rows - explained - blank
    if missing > 0:
        ev["原因：相手の表（マスタ）にない値"] = f"{missing:,}行"
    if blank > 0:
        ev["原因：照合に使う値が空欄"] = f"{blank:,}行"
    # 空白の違いが見えるよう、かぎかっこで囲む（例：「P-1005 」）
    ex = [{"照合できないキー": f"「{k}」"} for k in keys[:MAX_EXAMPLES]]
    fix = next((i.how_to_fix for i in unmatched if i.how_to_fix), None)
    if rows > c.params.max_count:
        return ("failed", f"照合できない行が{rows:,}行あります（許容 {c.params.max_count:,}行）。", ev, ex, fix or "マスタへの登録漏れがないか確かめてください。")
    return ("passed", f"照合できない行は{rows:,}行で、許容件数以内です。", ev, ex, None)


def _eval_expected_value(c: ExpectedValueCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    raw = ctx.value(c.params.value, "確認用の値")
    expected = _parse_decimal(raw)
    if expected is None:
        raise _Unverified(f"確認用の値「{raw}」は数値ではないため、確かめられませんでした。", "数値を入力してください。")
    if c.params.measure == "sum":
        column = ctx.column(table, c.target.column)
        actual = _sum(table, column)
        what = f"列「{column}」の合計"
    else:
        actual = Decimal(table.row_count)
        what = "件数"
    diff = abs(actual - expected)
    tol = Decimal(c.params.tolerance)
    ev = {"計算した値": _fmt(actual), "確認用の値": _fmt(expected), "差": _fmt(diff), "許容差": _fmt(tol)}
    if diff > tol:
        return ("failed", f"{what}（{_fmt(actual)}）が確認用の値（{_fmt(expected)}）と一致しません（差 {_fmt(diff)}）。", ev, [], "元のファイルと確認用の値の出どころを確かめてください。")
    return ("passed", f"{what}（{_fmt(actual)}）が確認用の値と一致しています。", ev, [], None)


def _eval_list_rows(c: ListRowsCriterion, ctx: _Context) -> Outcome:
    table = ctx.table(c.target.ref)
    conds = _conditions(c.params.condition)
    for cond in conds:
        ctx.column(table, cond.column)
    try:
        prepared = {id(x): _prepare(x, table, c.name) for x in conds}
    except NodeFailure as f:
        raise _Unverified(f.issue.message, f.issue.how_to_fix) from None
    rows = [i for i in range(table.row_count) if _eval(c.params.condition, i, table, prepared)]
    cols = table.columns[:6]
    ex = [{"結果の行": i + 1, **{col: _fmt(table.data[col][i]) for col in cols}} for i in rows[:MAX_EXAMPLES]]
    return ("recorded", f"条件に合う行は{len(rows):,}件です（判定には使いません）。", {"該当件数": f"{len(rows):,}"}, ex, None)


_EVALUATORS: dict[str, Callable[[Any, _Context], Outcome]] = {
    "required_columns": _eval_required_columns,
    "data_type": _eval_data_type,
    "no_blank": _eval_no_blank,
    "unique": _eval_unique,
    "value_range": _eval_value_range,
    "period": _eval_period,
    "total_match": _eval_total_match,
    "row_count": _eval_row_count,
    "all_matched": _eval_all_matched,
    "expected_value": _eval_expected_value,
    "list_rows": _eval_list_rows,
}


def evaluate_criteria(flow: FlowDefinition, result: RunResult, tables: dict[str, Table], values: dict[str, str] | None = None) -> list[CriterionResult]:
    """完了基準をすべて評価する。1つの基準の評価で問題が起きても、ほかの基準の評価は続ける。"""
    ctx = _Context(flow, result, tables, values or {})
    out: list[CriterionResult] = []
    for c in flow.completion_criteria.items:
        base = {"criterion_id": c.criterion_id, "name": c.name, "kind": c.kind, "on_fail": c.on_fail}
        if c.confirmation_status != "confirmed":
            what = "AIの提案" if c.confirmation_status == "ai_proposed" else "この基準"
            out.append(CriterionResult(**base, status="unverified", summary=f"{what}がまだ確認されていないため、評価していません。", how_to_fix="内容を確かめて「確認済み」にしてください。"))
            continue
        try:
            status, summary, evidence, examples, fix = _EVALUATORS[c.kind](c, ctx)
        except _Unverified as u:
            out.append(CriterionResult(**base, status="unverified", summary=u.reason, how_to_fix=u.how_to_fix))
            continue
        out.append(CriterionResult(**base, status=status, summary=summary, evidence=evidence, examples=examples, how_to_fix=fix))
    return out
