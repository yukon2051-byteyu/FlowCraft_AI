"""実行結果を Excel ファイル（.xlsx）にする（タスク1-7）。

シートの構成
  1. 処理結果のシート（出力ステップで指定したもの）……実行が失敗したときは出力しない（不正な結果を成果物にしない）
  2. 確認結果 ……結論、ステップごとの状態・件数・お知らせ（原因・直し方つき）
  3. 処理の記録 ……作業手順の名前・版・実行日時・入力ファイル・処理ステップ・出力した表の指紋

値の書き方
  - 列の形式を保つ：整数・小数は数値、日付は日付、文字は文字（先頭0のコードは文字のまま）
  - 文字の値は必ず「文字」として書く。「=」で始まる値も数式にしない（ファイルに仕込まれた数式が、
    出力したExcelを開いたときに動かないようにするため）。URLや数字に見える文字も自動で変換しない

書き出しのライブラリ
  xlsxwriter（書き出し専用）を使う。10万行×8列で openpyxl（書き込み専用モード）は約35〜47秒、
  xlsxwriter（constant_memory）は約10秒だったため（docs/performance.md）。読み取りは従来どおり calamine／openpyxl。
"""

from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import xlsxwriter

from app.engine.result import EngineIssue, RunResult
from app.engine.runner import Execution
from app.engine.table import ColumnSpec, Table
from app.flow.schema import FlowDefinition

RESULT_SHEET = "確認結果"
RECORD_SHEET = "処理の記録"

STEP_LABEL = {
    "load": "ファイルを読み込む",
    "filter": "条件に合う行だけ残す",
    "sort": "並べ替える",
    "select_columns": "必要な列を取り出す",
    "rename_columns": "列の名前を変える",
    "drop_columns": "不要な列を消す",
    "add_constant": "同じ値の列を追加する",
    "cast": "データの形式をそろえる",
    "duplicates": "重複を調べる・取り除く",
    "missing": "空欄を調べる・埋める",
    "join": "別の表から情報を付け加える",
    "concat": "複数の表を縦にまとめる",
    "aggregate": "項目ごとに合計・集計する",
    "calculate": "計算した列を追加する",
    "output": "Excelに出力する",
}
STATUS_LABEL = {"ok": "完了", "warning": "確認が必要", "error": "エラー", "skipped": "実行していない"}
SEVERITY_LABEL = {"info": "お知らせ", "warning": "確認が必要", "error": "エラー"}

MAX_WIDTH = 60

CRITERION_KIND_LABEL = {
    "required_columns": "必要な列がそろっている",
    "data_type": "データの形式に合っている",
    "no_blank": "空欄がない",
    "unique": "重複がない",
    "value_range": "値が範囲内にある",
    "period": "対象期間内の日付だけ",
    "total_match": "2つの結果で合計が一致する",
    "row_count": "件数が範囲内にある",
    "all_matched": "照合できない行が上限以下",
    "expected_value": "確認用の値と一致する",
    "list_rows": "条件に合う行を一覧にする",
}
CRITERION_STATUS_LABEL = {"passed": "満たしている", "failed": "満たしていない", "unverified": "未検証", "not_applicable": "対象外", "recorded": "記録"}
ON_FAIL_LABEL = {"critical": "重大", "caution": "注意", "record": "記録のみ"}


def _criterion_rank(c: Any) -> int:
    """重要な順：重大で満たさない → 未検証 → 注意で満たさない → 満たしている → 記録"""
    if c.status == "failed" and c.on_fail == "critical":
        return 0
    if c.status == "unverified" and c.on_fail != "record":
        return 1
    if c.status == "failed" and c.on_fail == "caution":
        return 2
    if c.status == "passed":
        return 3
    return 4


def verdict_text(result: RunResult) -> str:
    """総合判定（タスク2-3）。確認結果のシートの「総合判定」の行に書く"""
    v = result.verdict
    if v is None:
        return "（判定していません）"
    label = {"normal": "正常", "caution": "注意", "critical": "重大", "unverified": "未検証"}[v.verdict]
    basis = "標準の確認のみ" if v.standard_only else "完了基準と標準の確認"
    return f"{label}（{basis}）：{v.headline}"


def conclusion(result: RunResult) -> str:
    """処理がどこまで進んだか（確認結果のシートの「結論」の行）"""
    if result.status != "failed" and not result.can_export and result.outputs:
        return "最後まで実行しましたが、総合判定が「重大」のため、処理結果は出力していません（調査用）。"
    if result.status == "failed":
        stopped = next((i for i, n in enumerate(result.nodes) if n.status == "error"), None)
        if stopped is not None:
            return f"ステップ{stopped + 1}「{result.nodes[stopped].node_name}」で止まりました。処理結果は出力していません（調査用）。"
        return "実行できませんでした。処理結果は出力していません（調査用）。"
    if result.status == "warning":
        return "最後まで実行しました（確認が必要なお知らせがあります）。"
    return "最後まで実行しました。"


class _Book:
    """xlsxwriter のブックと、共通の書式。"""

    def __init__(self, buf: io.BytesIO):
        self.wb = xlsxwriter.Workbook(
            buf,
            {
                "in_memory": True,
                "constant_memory": True,  # 行ごとに書き出してメモリを節約（行は上から順に書く）
                "strings_to_formulas": False,
                "strings_to_numbers": False,
                "strings_to_urls": False,
            },
        )
        self.header = self.wb.add_format({"bold": True, "bg_color": "#E6F4EF", "border": 1, "border_color": "#C9D6D1"})
        self.title = self.wb.add_format({"bold": True, "font_size": 14})
        self.wrap = self.wb.add_format({"text_wrap": True, "valign": "top"})
        self.date = self.wb.add_format({"num_format": "yyyy/mm/dd"})
        self.int = self.wb.add_format({"num_format": "#,##0"})
        self._dec: dict[int, Any] = {}

    def number_format(self, spec: ColumnSpec) -> Any:
        if spec.type == "integer" or spec.scale == 0:
            return self.int
        if spec.scale:
            if spec.scale not in self._dec:
                self._dec[spec.scale] = self.wb.add_format({"num_format": "#,##0." + "0" * spec.scale})
            return self._dec[spec.scale]
        return None  # 桁数の決まっていない小数は Excel の標準の表示（末尾に「.」が付かないように）


def _write(ws: Any, r: int, c: int, v: Any, fmt: Any = None, book: _Book | None = None) -> None:
    if v is None:
        return
    if isinstance(v, str):
        ws.write_string(r, c, v, fmt)  # 「=」で始まっても数式にしない
    elif isinstance(v, bool):
        ws.write_boolean(r, c, v, fmt)
    elif isinstance(v, (int, Decimal)):
        ws.write_number(r, c, float(v) if isinstance(v, Decimal) else v, fmt)
    elif isinstance(v, (date, datetime)):
        ws.write_datetime(r, c, v, fmt if fmt is not None else (book.date if book else None))
    else:
        ws.write_string(r, c, str(v), fmt)


def build_workbook(flow: FlowDefinition, ex: Execution, executed_at: datetime, flow_hash: str) -> bytes:
    """実行結果から .xlsx のバイト列を作る。"""
    result = ex.result
    buf = io.BytesIO()
    book = _Book(buf)
    include_results = result.can_export
    user_sheets = [o.sheet_name for o in result.outputs] if include_results else []
    # 利用者が付けたシート名と重ならないようにする
    result_name = _free_name(RESULT_SHEET, user_sheets)
    record_name = _free_name(RECORD_SHEET, [*user_sheets, result_name])

    if include_results:
        for out in result.outputs:
            _write_table(book, out.sheet_name, ex.tables[out.reference])
    _write_checks(book, result_name, flow, result, executed_at)
    _write_record(book, record_name, flow, ex, executed_at, flow_hash)
    book.wb.close()
    return buf.getvalue()


def _free_name(name: str, used: list[str]) -> str:
    n, i = name, 2
    while n in used:
        n = f"{name}{i}"
        i += 1
    return n


def _width(v: Any) -> int:
    text = "" if v is None else str(v)
    return sum(2 if ord(ch) > 0x7F else 1 for ch in text)  # 全角は2文字分


def _set_widths(ws: Any, rows: list[list[Any]], first: int = 0) -> None:
    widths: dict[int, int] = {}
    for r in rows:
        for i, v in enumerate(r):
            widths[i] = max(widths.get(i, 0), _width(v))
    for i, w in widths.items():
        if i >= first:
            ws.set_column(i, i, min(max(w + 2, 8), MAX_WIDTH))


def _write_table(book: _Book, name: str, table: Table) -> None:
    ws = book.wb.add_worksheet(name)
    ws.freeze_panes(1, 0)
    _set_widths(ws, [list(table.columns), *table.rows(0, 200)])
    for c, col in enumerate(table.columns):
        ws.write_string(0, c, col, book.header)
    # 書式は列ごとに1回だけ決める
    fmts = []
    for col in table.columns:
        spec = table.specs[col]
        fmts.append(book.date if spec.type == "date" else book.number_format(spec) if spec.type in ("integer", "decimal") else None)
    for r, row in enumerate(table.rows(), start=1):
        for c, v in enumerate(row):
            _write(ws, r, c, v, fmts[c], book)


def _write_lines(book: _Book, ws: Any, rows: list[list[Any]], header_rows: set[int], title_rows: set[int]) -> None:
    for r, values in enumerate(rows):
        for c, v in enumerate(values):
            if r in title_rows:
                fmt = book.title
            elif r in header_rows:
                fmt = book.header
            elif isinstance(v, str) and len(v) > 30:
                fmt = book.wrap
            else:
                fmt = None
            _write(ws, r, c, v, fmt, book)


# ---------------------------------------------------------------------------
# 確認結果・処理の記録
# ---------------------------------------------------------------------------


def _issue_row(step: str, name: str, status: str, rows_in: str, rows_out: Any, issue: EngineIssue | None) -> list[Any]:
    if issue is None:
        return [step, name, status, rows_in, rows_out, "", "", "", ""]
    return [step, name, status, rows_in, rows_out, SEVERITY_LABEL.get(issue.severity, issue.severity), issue.message, issue.cause or "", issue.how_to_fix or ""]


def _write_checks(book: _Book, name: str, flow: FlowDefinition, result: RunResult, executed_at: datetime) -> None:
    ws = book.wb.add_worksheet(name)
    rows: list[list[Any]] = [
        ["確認結果"],
        ["作業手順", flow.flow_name],
        ["実行日時", executed_at.astimezone().strftime("%Y/%m/%d %H:%M:%S")],
        ["結論", conclusion(result)],
        ["総合判定", verdict_text(result)],
        *[["判定の理由", r] for r in (result.verdict.reasons if result.verdict else [])],
        [],
    ]
    # 完了基準の判定と根拠（タスク2-5）。画面と同じく、重要な順に並べる
    criteria_header = None
    if result.criteria:
        rows.append(["完了基準の判定と根拠（プログラムで計算。AIは使っていません）"])
        criteria_header = len(rows)
        rows.append(["完了基準", "種類", "満たさないとき", "判定", "理由", "根拠", "対応", "該当する例"])
        for c in sorted(result.criteria, key=_criterion_rank):
            judged = CRITERION_STATUS_LABEL.get(c.status, c.status)
            if c.status == "failed":
                judged += f"（{ON_FAIL_LABEL.get(c.on_fail, c.on_fail)}）"
            rows.append(
                [
                    c.name,
                    CRITERION_KIND_LABEL.get(c.kind, c.kind),
                    ON_FAIL_LABEL.get(c.on_fail, c.on_fail),
                    judged,
                    c.summary,
                    " ／ ".join(f"{k}：{v}" for k, v in c.evidence.items()),
                    (c.how_to_fix or "") if c.status != "passed" else "",
                    " ／ ".join("、".join(f"{k}：{v}" for k, v in e.items()) for e in c.examples),
                ]
            )
        rows.append([])
    if result.flow_issues:
        rows.append(["実行前に見つかった問題"])
        rows += [[SEVERITY_LABEL.get(i.severity, i.severity), i.message, i.cause or "", i.how_to_fix or ""] for i in result.flow_issues]
        rows.append([])
    header_at = len(rows)
    rows.append(["ステップ", "名前", "状態", "入力件数", "出力件数", "お知らせの種類", "内容", "原因", "直し方"])
    for i, n in enumerate(result.nodes):
        rows_in = "＋".join(f"{r:,}" for r in n.input_rows)
        status = STATUS_LABEL.get(n.status, n.status)
        if not n.issues:
            rows.append(_issue_row(str(i + 1), n.node_name, status, rows_in, n.output_rows, None))
        for issue in sorted(n.issues, key=lambda x: {"error": 0, "warning": 1}.get(x.severity, 2)):
            rows.append(_issue_row(str(i + 1), n.node_name, status, rows_in, n.output_rows, issue))
    _set_widths(ws, rows[header_at:] + (rows[criteria_header:] if criteria_header is not None else []), first=1)
    ws.set_column(0, 0, 24)
    _write_lines(book, ws, rows, {header_at} | ({criteria_header} if criteria_header is not None else set()), {0})


def _write_record(book: _Book, name: str, flow: FlowDefinition, ex: Execution, executed_at: datetime, flow_hash: str) -> None:
    ws = book.wb.add_worksheet(name)
    result = ex.result
    labels = {d.input_id: d.label for d in flow.input_definitions}
    rows: list[list[Any]] = [
        ["処理の記録"],
        ["作業手順", flow.flow_name],
        ["作業手順の版", flow.flow_version],
        ["作業手順のID", str(flow.flow_id)],
        ["実行日時", executed_at.astimezone().strftime("%Y/%m/%d %H:%M:%S")],
        ["処理時間（秒）", Decimal(str(round(result.duration_ms / 1000, 1)))],
        ["処理エンジンの版", result.engine_version],
        ["作業手順の指紋", flow_hash],
        [],
        ["入力ファイル"],
    ]
    files_header = len(rows)
    rows.append(["入力の名前", "ファイル", "シート", "件数"])
    for node, run in zip(flow.nodes, result.nodes):
        if node.node_type != "load":
            continue
        loaded = next((i for i in run.issues if i.code == "LOADED"), None)
        rows.append(
            [
                labels.get(getattr(node.parameters, "input_id", ""), ""),
                str(loaded.details.get("file", "")) if loaded else "（読み込めませんでした）",
                str(loaded.details.get("sheet", "")) if loaded else "",
                run.output_rows,
            ]
        )
    rows += [[], ["処理ステップ"]]
    steps_header = len(rows)
    rows.append(["ステップ", "名前", "処理", "使うデータ"])
    producer = {n.output_reference: i for i, n in enumerate(flow.nodes) if n.output_reference}
    for i, node in enumerate(flow.nodes):
        if node.node_type == "load":
            uses = f"入力：{labels.get(getattr(node.parameters, 'input_id', ''), '')}"
        else:
            uses = "、".join(f"ステップ{producer[r] + 1}の結果" for r in node.input_references if r in producer)
        rows.append([str(i + 1), node.node_name, STEP_LABEL.get(node.node_type, node.node_type), uses])
    outputs_header = None
    if result.can_export:
        rows += [[], ["出力した表（指紋は、同じ内容かどうかを後から確かめるための値です）"]]
        outputs_header = len(rows)
        rows.append(["シート", "件数", "列数", "指紋"])
        for o in result.outputs:
            t = ex.tables[o.reference]
            rows.append([o.sheet_name, t.row_count, len(t.columns), result.fingerprints.get(o.reference, "")])
    _set_widths(ws, rows[1:], first=1)
    ws.set_column(0, 0, 18)
    headers = {files_header, steps_header} | ({outputs_header} if outputs_header is not None else set())
    _write_lines(book, ws, rows, headers, {0})
