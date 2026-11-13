"""分析エンジン（Phase A。docs/analysis-design.md）。

実行で作られた表と作業手順の設定から、確定的な計算だけで分析を作る（AIは使わない）。
- 基本集計：出力する表ごとの件数、数値の列の合計・平均・最大・最小
- ランキング・構成比：「同じ値ごとにまとめる」ステップ（まとめる列が1つ）から。列名の意味は推測しない
- 時系列：まとめる列が日付のとき、その順に並べる
- 注目すべき変化：前回の分析と比べ、増減率と増減の量の両方が閾値を超えたものだけ（品質の判定には入れない）
- 確認すべきこと：品質の判定の理由と注目すべき変化から、決まった文で作る（原因は断定しない）

数値は Decimal で計算し、文字列で返す。割合の分母が 0 のときは割合を出さない。
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.flow.schema import AggregateNode, FlowDefinition
from app.quality.compare import ref_fingerprint

TOP_N = 5
MAX_ITEMS = 50
MAX_NUMERIC_COLUMNS = 10
# 注目すべき変化（R-5）：増減率と増減の量の両方が超えたとき
NOTABLE_RATE_PCT = Decimal(20)
NOTABLE_COUNT_MIN = Decimal(10)
NOTABLE_SUM_SHARE = Decimal("0.01")  # 前回の合計の1%


def _d(v: Any) -> Decimal | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return Decimal(str(v))
    except ArithmeticError:
        return None


def fmt(v: Decimal) -> str:
    """表示用（3桁区切り。整数ならそのまま、小数は最大2桁）"""
    if v == v.to_integral_value():
        return f"{int(v):,}"
    q = v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{q:,f}".rstrip("0").rstrip(".")


def pct(part: Decimal, whole: Decimal) -> str | None:
    if whole == 0:
        return None
    return f"{(part / whole * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%"


class NumericSummary(BaseModel):
    column: str
    count: int
    sum: str
    avg: str
    min: str
    max: str


class TableSummary(BaseModel):
    reference: str
    sheet_name: str
    rows: int
    numeric: list[NumericSummary] = Field(default_factory=list)


class BreakdownItem(BaseModel):
    key: str
    value: str
    share: str | None  # 構成比（全体が 0 のときは None）


class Breakdown(BaseModel):
    """まとめるステップ1つ分のランキング・構成比"""

    reference: str
    step_name: str
    dimension: str  # まとめた列
    measure: str  # 合計（または件数）の列
    measure_kind: Literal["sum", "count"]
    total: str
    groups: int
    items: list[BreakdownItem]  # 値の大きい順（最大50件）
    is_time: bool  # まとめた列が日付（時系列として並べる）
    # この表を作るまでの上流のステップの指紋（QM-2 と同じ）。前回と違えば比べない
    fingerprint: str = ""


class NotableChange(BaseModel):
    reference: str
    dimension: str
    measure: str
    key: str  # 分類の値（全体の合計なら「（全体）」）
    previous: str
    current: str
    diff: str
    rate: str


class AnalysisReport(BaseModel):
    version: int = 1
    tables: list[TableSummary]
    breakdowns: list[Breakdown]
    notable_changes: list[NotableChange] = Field(default_factory=list)
    check_items: list[str] = Field(default_factory=list)
    # 分析できなかったこと（理由）。空のグラフや不自然な 0 の代わりに示す
    notes: list[str] = Field(default_factory=list)
    compared_with: str | None = None  # 比べた前回（対象期間の表示。比べていなければ None）


def _numeric(table: Any) -> list[NumericSummary]:
    out: list[NumericSummary] = []
    for col in table.columns:
        if table.type_of(col) not in ("integer", "decimal"):
            continue
        vals = [x for x in (_d(v) for v in table.data[col]) if x is not None]
        if not vals:
            continue
        total = sum(vals, Decimal(0))
        out.append(NumericSummary(column=col, count=len(vals), sum=fmt(total), avg=fmt(total / len(vals)), min=fmt(min(vals)), max=fmt(max(vals))))
        if len(out) >= MAX_NUMERIC_COLUMNS:
            break
    return out


def _breakdown(node: AggregateNode, table: Any, fingerprint: str = "") -> Breakdown | None:
    p = node.parameters
    if len(p.group_by) != 1:
        return None
    agg = next((a for a in p.aggregations if a.function == "sum"), None) or next((a for a in p.aggregations if a.function == "count"), None)
    if agg is None or agg.output_column not in table.columns or p.group_by[0] not in table.columns:
        return None
    dim = p.group_by[0]
    pairs: list[tuple[str, Decimal]] = []
    for k, v in zip(table.data[dim], table.data[agg.output_column], strict=False):
        dv = _d(v)
        if dv is None:
            continue
        pairs.append(("（空欄）" if k is None else (k.strftime("%Y-%m-%d") if hasattr(k, "strftime") else str(k)), dv))
    if not pairs:
        return None
    total = sum((v for _, v in pairs), Decimal(0))
    is_time = table.type_of(dim) == "date"
    ordered = sorted(pairs, key=lambda kv: kv[0]) if is_time else sorted(pairs, key=lambda kv: (-kv[1], kv[0]))
    return Breakdown(
        reference=node.output_reference or "",
        step_name=node.node_name,
        dimension=dim,
        measure=agg.output_column,
        measure_kind="sum" if agg.function == "sum" else "count",
        total=fmt(total),
        groups=len(pairs),
        items=[BreakdownItem(key=k, value=fmt(v), share=pct(v, total)) for k, v in ordered[:MAX_ITEMS]],
        is_time=is_time,
        fingerprint=fingerprint,
    )


def _num(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


def notable_changes(current: list[Breakdown], previous: list[Breakdown]) -> list[NotableChange]:
    """同じまとめ方（参照・分類の列・数値の列）どうしで、分類ごとと全体の値を比べる"""
    out: list[NotableChange] = []
    prev_by = {(b.reference, b.dimension, b.measure): b for b in previous}
    for b in current:
        pb = prev_by.get((b.reference, b.dimension, b.measure))
        if pb is None or b.is_time or (b.fingerprint and pb.fingerprint and b.fingerprint != pb.fingerprint):
            continue  # まとめ方の定義（上流のステップ）が変わっていれば比べない
        prev_total = _num(pb.total)
        min_abs = NOTABLE_COUNT_MIN if b.measure_kind == "count" else max(prev_total * NOTABLE_SUM_SHARE, Decimal(1))
        prev_items = {i.key: _num(i.value) for i in pb.items}
        candidates = [("（全体）", prev_total, _num(b.total))] + [(i.key, prev_items[i.key], _num(i.value)) for i in b.items if i.key in prev_items]
        for key, p, c in candidates:
            if p == 0:
                continue  # 前回が 0 のときは増減率を出さない（注目すべき変化にもしない）
            diff = c - p
            rate = diff / p * 100
            if abs(rate) >= NOTABLE_RATE_PCT and abs(diff) >= min_abs:
                out.append(
                    NotableChange(
                        reference=b.reference,
                        dimension=b.dimension,
                        measure=b.measure,
                        key=key,
                        previous=fmt(p),
                        current=fmt(c),
                        diff=("+" if diff > 0 else "") + fmt(diff),
                        rate=f"{rate.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP):+}%",
                    )
                )
    return out


def check_items(verdict: Any, criteria: list[Any], changes: list[NotableChange]) -> list[str]:
    """確認すべきこと（決まった文。原因は断定しない）"""
    out: list[str] = []
    for c in criteria:
        if c.status == "failed" and c.on_fail in ("critical", "caution") and c.how_to_fix:
            out.append(f"「{c.name}」：{c.how_to_fix}")
        elif c.status == "unverified" and c.on_fail != "record" and c.how_to_fix:
            out.append(f"「{c.name}」（確かめられませんでした）：{c.how_to_fix}")
    for ch in changes[:5]:
        direction = "増えて" if not ch.diff.startswith("-") else "減って"
        target = "全体" if ch.key == "（全体）" else f"「{ch.key}」"
        out.append(
            f"{target}の「{ch.measure}」が、前回の{ch.previous}から{ch.current}に{direction}います（{ch.rate}）。"
            "対象期間・取り込んでいないファイル・分類の内訳に変わりがないか確認してください。"
        )
    return out[:10]


def analyze(flow: FlowDefinition, ex: Any, *, previous: AnalysisReport | None = None, previous_label: str | None = None) -> AnalysisReport:
    r = ex.result
    tables = [
        TableSummary(reference=o.reference, sheet_name=o.sheet_name, rows=ex.tables[o.reference].row_count, numeric=_numeric(ex.tables[o.reference]))
        for o in r.outputs
        if o.reference in ex.tables
    ]
    breakdowns: list[Breakdown] = []
    notes: list[str] = []
    for node in flow.nodes:
        if isinstance(node, AggregateNode) and node.output_reference in ex.tables:
            b = _breakdown(node, ex.tables[node.output_reference], ref_fingerprint(flow, node.output_reference))
            if b is not None:
                breakdowns.append(b)
    if not tables:
        notes.append("出力する表がないため、基本集計は表示しません。")
    if not breakdowns:
        notes.append("「同じ値ごとにまとめる」ステップ（まとめる列が1つ）がないため、ランキング・構成比は表示しません。")
    elif not any(b.is_time for b in breakdowns):
        notes.append("日付でまとめた集計がないため、時系列の推移は表示しません。")
    changes = notable_changes(breakdowns, previous.breakdowns) if previous else []
    if previous is None:
        notes.append("比較できる過去の実行結果がありません。今回のデータの分析は確認できます。")
    return AnalysisReport(
        tables=tables,
        breakdowns=breakdowns,
        notable_changes=changes,
        check_items=check_items(r.verdict, r.criteria, changes),
        notes=notes,
        compared_with=previous_label if previous else None,
    )
