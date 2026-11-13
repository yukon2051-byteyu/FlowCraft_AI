"""実行結果を Excel ファイル（.xlsx）にする（タスク1-7、2026-11-13 レポートの見た目と情報の順序を改善）。

シートの構成（役割を分ける）
  1. 処理結果のシート（出力ステップで指定したもの）……総合判定が「重大」・処理が止まったときは出力しない
  2. 確認結果 ……管理者・業務担当者が判断するためのレポート（何が問題で、何をすればよいか）
  3. 処理の記録 ……SE が処理を追跡するための記録（実行の情報・入力・処理ステップ・詳細ログ）
  中身（何をどの順で見せるか）は report.py、見た目（書式）はこのファイル。

見た目の方針（白を基調にした業務レポート）
  - 濃紺 #203047：タイトル・見出し。ミント・ゴールド・コーラルは状態の表示にだけ使う
  - 重要度は色だけに頼らず、必ず文字（重大・注意 など）でも示す
  - 全シートで目盛線を消す。折り返しと行の高さを調整し、横に長くしない。A4横・幅1ページで印刷

値の書き方
  - 列の形式を保つ：整数・小数は数値、日付は日付、文字は文字（先頭0のコードは文字のまま）
  - 文字の値は必ず「文字」として書く。「=」で始まる値も数式にしない（ファイルに仕込まれた数式が、
    出力したExcelを開いたときに動かないようにするため）。URLや数字に見える文字も自動で変換しない

書き出しのライブラリ
  xlsxwriter（書き出し専用）。10万行×8列で openpyxl は約35〜47秒、xlsxwriter（constant_memory）は約10秒（docs/performance.md）。
  constant_memory のため、各シートは上の行から順に書く。
"""

from __future__ import annotations

import io
import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import xlsxwriter

from app.engine.result import RunResult
from app.engine.runner import Execution
from app.engine.table import ColumnSpec, Table
from app.export import report
from app.export.report import LEVEL_LABEL, CRITERION_KIND_LABEL, CRITERION_STATUS_LABEL, ON_FAIL_LABEL
from app.flow.schema import FlowDefinition

RESULT_SHEET = "確認結果"
RECORD_SHEET = "処理の記録"

FONT = "游ゴシック"
NAVY = "#203047"
MINT = "#39D9AD"
GOLD = "#D6A64D"
CORAL = "#D97772"
WHITE = "#FFFFFF"
GRAY_BG = "#F4F7FA"
LINE = "#E1E7ED"
SUB = "#5B6B80"  # 補足の文字（濃紺を薄くした色）

# 重要度ごとの表示（ラベルの塗り・文字、行の淡い塗り）
LEVEL_STYLE = {
    "critical": {"bg": CORAL, "fg": WHITE, "tint": "#FBEDEC"},
    "unverified": {"bg": "#F3E3C2", "fg": NAVY, "tint": "#FBF5E9"},
    "caution": {"bg": GOLD, "fg": WHITE, "tint": "#FBF5E9"},
    "normal": {"bg": MINT, "fg": NAVY, "tint": "#EAFAF5"},
    "record": {"bg": "#DDE3EA", "fg": NAVY, "tint": GRAY_BG},
}

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

MAX_WIDTH = 60
LINE_HEIGHT = 15.5  # 1行分の高さ（ポイント）


class _Book:
    """xlsxwriter のブックと、共通の書式（同じ設定の書式は使い回す）。"""

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
        self._cache: dict[tuple, Any] = {}
        self.header = self.fmt(bold=True, font_color=WHITE, bg_color=NAVY, border=1, border_color=NAVY)
        self.date = self.fmt(num_format="yyyy/mm/dd", border=1, border_color=LINE)
        self.int = self.fmt(num_format="#,##0", border=1, border_color=LINE)
        self.cell = self.fmt(border=1, border_color=LINE)
        self._dec: dict[int, Any] = {}

    def fmt(self, **props: Any) -> Any:
        base = {"font_name": FONT, "font_size": 10.5, "valign": "vcenter"}
        base.update(props)
        key = tuple(sorted(base.items()))
        if key not in self._cache:
            self._cache[key] = self.wb.add_format(base)
        return self._cache[key]

    def number_format(self, spec: ColumnSpec) -> Any:
        if spec.type == "integer" or spec.scale == 0:
            return self.int
        if spec.scale:
            if spec.scale not in self._dec:
                self._dec[spec.scale] = self.fmt(num_format="#,##0." + "0" * spec.scale, border=1, border_color=LINE)
            return self._dec[spec.scale]
        return self.cell  # 桁数の決まっていない小数は Excel の標準の表示（末尾に「.」が付かないように）


def _write(ws: Any, r: int, c: int, v: Any, fmt: Any = None, book: _Book | None = None) -> None:
    if v is None:
        if fmt is not None:
            ws.write_blank(r, c, None, fmt)
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


def _width(v: Any) -> int:
    text = "" if v is None else str(v)
    return sum(2 if ord(ch) > 0x7F else 1 for ch in text)  # 全角は2文字分


def _lines(text: Any, width: float) -> int:
    """折り返したときの行数の見積もり（列幅は文字数。全角は2）"""
    if text is None or text == "":
        return 1
    return sum(max(1, math.ceil(_width(part) / max(width - 1, 4))) for part in str(text).split("\n"))


def _setup_print(ws: Any, title_rows: int = 1) -> None:
    ws.hide_gridlines(2)  # 画面と印刷の両方で目盛線を消す
    ws.set_landscape()
    ws.set_paper(9)  # A4
    ws.set_margins(left=0.5, right=0.5, top=0.6, bottom=0.6)
    ws.fit_to_pages(1, 0)  # 幅は1ページ、縦は必要なだけ（文字を極端に小さくしないよう、列幅を抑えている）
    ws.repeat_rows(0, title_rows - 1)
    ws.set_footer("&C&P / &N ページ")


class _Sheet:
    """上の行から順に書くための小さな道具（行の高さは、折り返しを見積もって決める）。"""

    def __init__(self, book: _Book, name: str, widths: list[float]):
        self.book = book
        self.ws = book.wb.add_worksheet(name)
        self.widths = widths
        self.r = 0
        for i, w in enumerate(widths):
            self.ws.set_column(i, i, w)

    def span_width(self, first: int, last: int) -> float:
        return sum(self.widths[first : last + 1]) + (last - first)

    def row(self, cells: list[tuple[int, int, Any, Any]], height: float | None = None, min_lines: int = 1) -> int:
        """cells：(最初の列, 最後の列, 値, 書式) の一覧。最初と最後が違えば結合して書く"""
        lines = max([min_lines] + [_lines(v, self.span_width(a, b)) for a, b, v, _ in cells if isinstance(v, str)])
        self.ws.set_row(self.r, height if height is not None else max(20, lines * LINE_HEIGHT + 6))
        for a, b, v, f in cells:
            if a == b:
                _write(self.ws, self.r, a, v, f, self.book)
            else:
                # 結合したセルの値は1回だけ書く（文字は文字のまま。数式にはしない設定）
                self.ws.merge_range(self.r, a, self.r, b, "" if v is None else v, f)
        self.r += 1
        return self.r - 1

    def gap(self, height: float = 8) -> None:
        self.ws.set_row(self.r, height)
        self.r += 1


def build_workbook(
    flow: FlowDefinition,
    ex: Execution,
    executed_at: datetime,
    flow_hash: str,
    run_values: dict[str, str] | None = None,
    analysis: Any = None,
    comparison: Any = None,
) -> bytes:
    """実行結果から .xlsx のバイト列を作る。analysis：分析（app/analysis）、comparison：前回との比較（app/quality/compare）"""
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
    _write_checks(book, result_name, flow, result, executed_at, include_results, [o.sheet_name for o in result.outputs] if include_results else [], analysis, comparison)
    _write_record(book, record_name, flow, ex, executed_at, flow_hash, run_values or {})
    # 開いたときに「確認結果」を最初に見せる
    book.wb.worksheets()[len(user_sheets)].activate()
    book.wb.close()
    return buf.getvalue()


def _free_name(name: str, used: list[str]) -> str:
    n, i = name, 2
    while n in used:
        n = f"{name}{i}"
        i += 1
    return n


def _write_table(book: _Book, name: str, table: Table) -> None:
    """処理結果のシート：見出しは濃紺、見出しを固定し、絞り込み（フィルター）を付ける"""
    ws = book.wb.add_worksheet(name)
    widths: dict[int, int] = {}
    for row in [list(table.columns), *table.rows(0, 200)]:
        for i, v in enumerate(row):
            widths[i] = max(widths.get(i, 0), _width(v))
    for i, w in widths.items():
        ws.set_column(i, i, min(max(w + 3, 9), MAX_WIDTH))
    _setup_print(ws)
    ws.freeze_panes(1, 0)
    if table.columns:
        ws.autofilter(0, 0, max(table.row_count, 1), len(table.columns) - 1)
    ws.set_row(0, 22)
    for c, col in enumerate(table.columns):
        ws.write_string(0, c, col, book.header)
    # 書式は列ごとに1回だけ決める（10万行でも遅くならないように）
    fmts = []
    for col in table.columns:
        spec = table.specs[col]
        fmts.append(book.date if spec.type == "date" else book.number_format(spec) if spec.type in ("integer", "decimal") else book.cell)
    for r, row in enumerate(table.rows(), start=1):
        for c, v in enumerate(row):
            _write(ws, r, c, v, fmts[c], book)


# ---------------------------------------------------------------------------
# 1枚目：確認結果（判断するためのレポート）
# ---------------------------------------------------------------------------

# 列：A 重要度・見出し／B 確認項目／C 結果／D 件数／E 対応
CHECK_WIDTHS = [12.0, 34.0, 26.0, 9.0, 52.0]


def _write_checks(
    book: _Book, name: str, flow: FlowDefinition, result: RunResult, executed_at: datetime, exported: bool, sheets: list[str], analysis: Any = None, comparison: Any = None
) -> None:
    s = _Sheet(book, name, CHECK_WIDTHS)
    ws = s.ws
    _setup_print(ws)
    ws.freeze_panes(1, 0)
    last = len(CHECK_WIDTHS) - 1
    st = report.status_of(result, exported)
    style = LEVEL_STYLE[st.verdict_level]

    title = book.fmt(bold=True, font_size=18, font_color=NAVY)
    sub = book.fmt(font_size=9.5, font_color=SUB)
    label = book.fmt(bold=True, font_color=NAVY, bg_color=GRAY_BG, text_wrap=True, border=1, border_color=LINE)
    value = book.fmt(text_wrap=True, border=1, border_color=LINE)
    value_bold = book.fmt(bold=True, text_wrap=True, border=1, border_color=LINE)
    section = book.fmt(bold=True, font_size=12.5, font_color=NAVY, bottom=2, bottom_color=NAVY)
    note = book.fmt(font_size=9.5, font_color=SUB, text_wrap=True)

    # ---- 第1階層：総合判定 ----
    s.row([(0, last, f"確認結果｜{flow.flow_name}", title)], height=32)
    s.row([(0, last, f"実行日時 {executed_at.astimezone().strftime('%Y/%m/%d %H:%M:%S')} ／ 処理時間 {report.format_duration(result.duration_ms)} ／ 作業手順の版 {flow.flow_version}", sub)], height=18)
    s.gap()
    banner = book.fmt(bold=True, font_size=16, font_color=style["fg"], bg_color=style["bg"], align="left", indent=1)
    s.row([(0, last, f"総合判定：{st.verdict}", banner)], height=34)
    official_fmt = book.fmt(bold=True, text_wrap=True, border=1, border_color=LINE, font_color="#B4534E" if "停止" in st.official_output else NAVY)
    s.row([(0, 0, "処理・検証", label), (1, last, st.processing, value)])
    s.row([(0, 0, "正式な集計結果", label), (1, last, st.official_output, official_fmt)])
    s.row([(0, 0, "判定の根拠", label), (1, last, st.basis, value)])
    for i, reason in enumerate(st.reasons):
        s.row([(0, 0, "主要な理由" if i == 0 else "", label), (1, last, f"・{reason}", value)])
    s.gap(14)

    no = iter(range(1, 20))  # 見出しの番号（出す項目に応じて振る）

    # ---- 第2階層：確認すべき問題（重要な順） ----
    items = report.items_of(result)
    s.row([(0, last, f"{next(no)}. 確認すべき問題（重要な順）", section)], height=24)
    if not items:
        s.row([(0, last, "確認すべき問題はありません（業務の完了基準は設定されていません。標準の確認でも問題は見つかりませんでした）。", note)])
    else:
        s.row([(0, 0, "重要度", book.header), (1, 1, "確認項目", book.header), (2, 2, "結果", book.header), (3, 3, "問題件数", book.header), (4, 4, "対応の要点", book.header)], height=22)
        for i, it in enumerate(items):
            ls = LEVEL_STYLE[it.level]
            zebra = {"bg_color": GRAY_BG} if i % 2 else {}
            chip = book.fmt(bold=True, align="center", font_color=ls["fg"], bg_color=ls["bg"], border=1, border_color=LINE)
            text = book.fmt(text_wrap=True, border=1, border_color=LINE, **zebra)
            strong = book.fmt(bold=True, text_wrap=True, border=1, border_color=LINE, **zebra)
            num = book.fmt(bold=True, num_format="#,##0", align="right", border=1, border_color=LINE, **zebra)
            s.row([(0, 0, LEVEL_LABEL[it.level], chip), (1, 1, it.name, strong), (2, 2, it.result, text), (3, 3, it.count, num), (4, 4, it.action, text)])
        s.row([(0, last, "「自動の確認」は、設定しなくても処理の中で必ず行う確認（標準の確認）です。詳しいログは「処理の記録」シートにあります。", note)], height=20)
    s.gap(14)

    # ---- 今回の主要数値・前回との比較・注目すべき変化（分析エンジン。AIは使っていない） ----
    if analysis is not None and result.status != "failed":
        num_r = book.fmt(num_format="#,##0", align="right", border=1, border_color=LINE)
        s.row([(0, last, f"{next(no)}. 今回の主要数値（集計結果から計算しています。AIは使っていません）", section)], height=24)
        for t in analysis.tables[:4]:
            s.row([(0, 0, "出力する表", label), (1, 2, t.sheet_name, value), (3, last, f"{t.rows:,}行", value_bold)])
        for b in analysis.breakdowns[:3]:
            s.row([(0, 0, "内訳", label), (1, last, f"「{b.dimension}」別の「{b.measure}」　合計 {b.total}（{b.groups}区分。上位5件と構成比）", value_bold)])
            for it in b.items[:5]:
                s.row([(0, 0, "", label), (1, 2, it.key, value), (3, 3, report.to_number(it.value), num_r), (4, last, it.share or "", value)])
        for n in analysis.notes:
            if not n.startswith("比較できる過去の実行結果がありません"):
                s.row([(0, last, n, note)])
        s.gap(14)

        s.row([(0, last, f"{next(no)}. 前回との比較", section)], height=24)
        compared = [r for r in (comparison.rows if comparison else []) if r.status == "compared"]
        if not compared:
            reason = comparison.business_reason if comparison and comparison.business_reason else "比較できる過去の実行結果がありません。"
            s.row([(0, last, f"{reason}今回のデータの分析は確認できます。", note)], height=20)
        else:
            s.row([(0, 1, "項目", book.header), (2, 2, "前回", book.header), (3, 3, "今回", book.header), (4, 4, "変化", book.header)], height=22)
            for r in compared:
                s.row([(0, 1, r.label, value), (2, 2, r.previous, value), (3, 3, r.current, value_bold), (4, 4, f"{r.diff}{f'（{r.rate}）' if r.rate else ''}", value)])
        if analysis.notable_changes:
            s.row([(0, last, f"注目すべき変化（{analysis.compared_with} と比べて。品質の判定とは別です）", value_bold)], height=20)
            for ch in analysis.notable_changes[:5]:
                target = "全体" if ch.key == "（全体）" else f"「{ch.key}」"
                s.row([(0, last, f"・{target}の「{ch.measure}」：{ch.previous} → {ch.current}（{ch.rate}）", value)])
        s.gap(14)

    # ---- 第3階層：完了基準の詳細 ----
    if result.criteria:
        s.row([(0, last, f"{next(no)}. 完了基準の詳細（判定はプログラムで計算しています。AIは使っていません）", section)], height=24)
        for c in sorted(result.criteria, key=lambda c: report.LEVEL_RANK[report.criterion_level(c)]):
            level = report.criterion_level(c)
            ls = LEVEL_STYLE[level]
            chip = book.fmt(bold=True, align="center", font_color=ls["fg"], bg_color=ls["bg"], border=1, border_color=LINE)
            head = book.fmt(bold=True, font_size=11, bg_color=ls["tint"], text_wrap=True, border=1, border_color=LINE)
            judged = CRITERION_STATUS_LABEL.get(c.status, c.status)
            s.row([(0, 0, LEVEL_LABEL[level], chip), (1, last, f"{c.name}　―　{judged}", head)], height=24)
            s.row([(0, 0, "種類", label), (1, last, f"{CRITERION_KIND_LABEL.get(c.kind, c.kind)}（満たさないとき：{ON_FAIL_LABEL.get(c.on_fail, c.on_fail)}）", value)])
            s.row([(0, 0, "判定理由", label), (1, last, c.summary, value)])
            for i, (k, v) in enumerate(c.evidence.items()):
                s.row([(0, 0, "根拠" if i == 0 else "", label), (1, 2, k, value), (3, last, v, value_bold)])
            for i, e in enumerate(c.examples):
                s.row([(0, 0, "該当する例" if i == 0 else "", label), (1, last, " ／ ".join(f"{k}：{v}" for k, v in e.items()), value)])
            if c.how_to_fix and c.status != "passed":
                s.row([(0, 0, "推奨対応", label), (1, last, c.how_to_fix, value_bold)])
            s.gap(10)
        s.gap(6)

    # ---- 確認すべきこと（判定の理由と注目すべき変化から、決まった文で作る。原因は断定しない） ----
    if analysis is not None and analysis.check_items:
        s.row([(0, last, f"{next(no)}. 確認すべきこと", section)], height=24)
        for c in analysis.check_items:
            s.row([(0, last, f"・{c}", value)])
        s.gap(14)

    # ---- 処理ステップの要約 ----
    s.row([(0, last, f"{next(no)}. 処理ステップの要約", section)], height=24)
    if result.flow_issues:
        for i, issue in enumerate(result.flow_issues):
            s.row([(0, 0, "実行前の問題" if i == 0 else "", label), (1, last, f"{issue.message}　{issue.how_to_fix or ''}", value)])
    s.row([(0, 0, "ステップ", book.header), (1, 1, "名前", book.header), (2, 2, "状態", book.header), (3, 3, "件数", book.header), (4, 4, "要点（最も重要なお知らせ）", book.header)], height=22)
    for i, (step, nm, state, counts, point) in enumerate(report.step_summary(result)):
        level = {"エラー": "critical", "要確認": "caution", "完了": "normal"}.get(state, "record")
        ls = LEVEL_STYLE[level]
        zebra = {"bg_color": GRAY_BG} if i % 2 else {}
        chip = book.fmt(bold=True, align="center", font_color=ls["fg"], bg_color=ls["bg"], border=1, border_color=LINE)
        text = book.fmt(text_wrap=True, border=1, border_color=LINE, **zebra)
        s.row([(0, 0, f"ステップ{step}", text), (1, 1, nm, text), (2, 2, state, chip), (3, 3, counts, text), (4, 4, point, text)])


# ---------------------------------------------------------------------------
# 2枚目：処理の記録（SE が処理を追跡するための記録）
# ---------------------------------------------------------------------------

# 列：A 項目・ログID／B 名前／C 種類・処理／D 内容／E 原因／F 直し方
RECORD_WIDTHS = [16.0, 26.0, 18.0, 50.0, 34.0, 34.0]


def _write_record(book: _Book, name: str, flow: FlowDefinition, ex: Execution, executed_at: datetime, flow_hash: str, run_values: dict[str, str]) -> None:
    result = ex.result
    s = _Sheet(book, name, RECORD_WIDTHS)
    ws = s.ws
    _setup_print(ws)
    ws.freeze_panes(1, 0)
    last = len(RECORD_WIDTHS) - 1
    title = book.fmt(bold=True, font_size=18, font_color=NAVY)
    section = book.fmt(bold=True, font_size=12.5, font_color=NAVY, bottom=2, bottom_color=NAVY)
    label = book.fmt(bold=True, font_color=NAVY, bg_color=GRAY_BG, border=1, border_color=LINE)
    value = book.fmt(text_wrap=True, border=1, border_color=LINE)
    mono = book.fmt(text_wrap=True, font_size=9.5, font_color=SUB, border=1, border_color=LINE)
    num = book.fmt(num_format="#,##0", border=1, border_color=LINE)

    s.row([(0, last, f"処理の記録｜{flow.flow_name}", title)], height=32)
    s.gap()
    s.row([(0, last, "実行の情報", section)], height=24)
    params = "、".join(f"{p.label}：{run_values.get(p.param_id, '（未入力）')}" for p in flow.run_parameters)
    info = [
        ("作業手順", flow.flow_name, value),
        ("作業手順の版", f"版{flow.flow_version}（完了基準の版 {flow.completion_criteria.version}）", value),
        ("作業手順のID", str(flow.flow_id), mono),
        ("実行日時", executed_at.astimezone().strftime("%Y/%m/%d %H:%M:%S"), value),
        ("処理時間", f"{report.format_duration(result.duration_ms)}（{result.duration_ms:,}ミリ秒）", value),
        ("処理エンジンの版", result.engine_version, value),
        ("作業手順の指紋", flow_hash, mono),
    ]
    if params:
        info.append(("実行時に指定した値", params, value))
    for k, v, f in info:
        s.row([(0, 0, k, label), (1, last, v, f)])
    s.gap(14)

    labels = {d.input_id: d.label for d in flow.input_definitions}
    s.row([(0, last, "入力ファイル", section)], height=24)
    s.row([(0, 0, "入力の名前", book.header), (1, 2, "ファイル", book.header), (3, 3, "シート", book.header), (4, 4, "件数", book.header), (5, 5, "状態", book.header)], height=22)
    for node, run in zip(flow.nodes, result.nodes):
        if node.node_type != "load":
            continue
        loaded = next((i for i in run.issues if i.code == "LOADED"), None)
        s.row(
            [
                (0, 0, labels.get(getattr(node.parameters, "input_id", ""), ""), value),
                (1, 2, str(loaded.details.get("file", "")) if loaded else "（読み込めませんでした）", value),
                (3, 3, str(loaded.details.get("sheet", "")) if loaded else "", value),
                (4, 4, run.output_rows, num),
                (5, 5, report.STEP_STATUS_LABEL.get(run.status, run.status), value),
            ]
        )
    s.gap(14)

    s.row([(0, last, "処理ステップ", section)], height=24)
    s.row([(0, 0, "ステップ", book.header), (1, 1, "名前", book.header), (2, 2, "処理", book.header), (3, 3, "使うデータ", book.header), (4, 4, "件数（入力 → 出力）", book.header), (5, 5, "状態・時間", book.header)], height=22)
    producer = {n.output_reference: i for i, n in enumerate(flow.nodes) if n.output_reference}
    for i, (node, run) in enumerate(zip(flow.nodes, result.nodes)):
        if node.node_type == "load":
            uses = f"入力：{labels.get(getattr(node.parameters, 'input_id', ''), '')}"
        else:
            uses = "、".join(f"ステップ{producer[r] + 1}の結果" for r in node.input_references if r in producer)
        rows_in = "＋".join(f"{r:,}" for r in run.input_rows)
        counts = f"{rows_in} → {run.output_rows:,}" if run.output_rows is not None and rows_in else (f"{run.output_rows:,}" if run.output_rows is not None else "")
        state = f"{report.STEP_STATUS_LABEL.get(run.status, run.status)}（{run.duration_ms:,}ミリ秒）"
        s.row([(0, 0, f"ステップ{i + 1}", value), (1, 1, node.node_name, value), (2, 2, STEP_LABEL.get(node.node_type, node.node_type), value), (3, 3, uses, value), (4, 4, counts, value), (5, 5, state, value)])
    s.gap(14)

    if result.can_export:
        s.row([(0, last, "出力した表（指紋は、同じ内容かどうかを後から確かめるための値です）", section)], height=24)
        s.row([(0, 0, "シート", book.header), (1, 1, "件数", book.header), (2, 2, "列数", book.header), (3, last, "指紋", book.header)], height=22)
        for o in result.outputs:
            t = ex.tables[o.reference]
            s.row([(0, 0, o.sheet_name, value), (1, 1, t.row_count, num), (2, 2, len(t.columns), num), (3, last, result.fingerprints.get(o.reference, ""), mono)])
        s.gap(14)

    # 詳細ログ（最後に置き、絞り込みを付ける）。確認が必要なものを先に、同じ重さの中は実行の順。ログIDで元の順序を追える
    s.row([(0, last, "詳細ログ（確認が必要なものを先に表示。ログIDは「ステップ番号-そのステップ内の順番」）", section)], height=24)
    header_row = s.row([(0, 0, "ログID", book.header), (1, 1, "名前", book.header), (2, 2, "種類", book.header), (3, 3, "内容", book.header), (4, 4, "原因", book.header), (5, 5, "直し方", book.header)], height=22)
    logs = report.detailed_log(result)
    for i, (log_id, _step, nm, kind, message, cause, fix) in enumerate(logs):
        level = {"エラー": "critical", "要確認": "caution"}.get(kind, "record")
        ls = LEVEL_STYLE[level]
        chip = book.fmt(bold=True, align="center", font_color=ls["fg"], bg_color=ls["bg"], border=1, border_color=LINE)
        zebra = {"bg_color": GRAY_BG} if i % 2 else {}
        text = book.fmt(text_wrap=True, border=1, border_color=LINE, **zebra)
        s.row([(0, 0, log_id, text), (1, 1, nm, text), (2, 2, kind, chip), (3, 3, message, text), (4, 4, cause, text), (5, 5, fix, text)])
    if logs:
        ws.autofilter(header_row, 0, header_row + len(logs), last)
