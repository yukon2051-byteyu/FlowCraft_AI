"""Excel読み取りの切り替え（openpyxl → python-calamine）の確認テスト。

注意が必要な値を集めたExcelを2つのライブラリで読み、値と型が完全に一致することを確かめる。
エラー値（#N/A など）を含むファイルは、空欄にならないよう openpyxl で読むことも確認する。
"""

import io
from datetime import date, datetime, time
from decimal import Decimal

import openpyxl
import pytest

from app.files.parse import _has_error_cells, _read_xlsx_calamine, _read_xlsx_openpyxl, read_xlsx


def build(sheets: dict[str, list[list]], hidden=(), cells: dict[str, dict[str, object]] | None = None) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
        if name in hidden:
            ws.sheet_state = "hidden"
        for ref, v in (cells or {}).get(name, {}).items():
            ws[ref] = v
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


TRICKY = [
    ["コード", "整数", "小数", "日付", "日時", "時刻", "真偽", "文字", "大きな数", "負数"],
    ["00123", 2, 0.1, datetime(2026, 10, 1), datetime(2026, 10, 1, 9, 30), time(9, 30), True, "山田", 12345678901234, -3],
    ["A-1", 0, 1500.5, datetime(2024, 2, 29), datetime(2026, 12, 31, 23, 59, 59), time(0, 0), False, " 前後に空白 ", 1e15, -0.5],
    ["", None, 1 / 3, None, None, None, None, "改行\nあり", 2**53, -12345678901234],
    ["１２３", 3.0, Decimal("2.5"), date(2026, 1, 1), None, None, None, "=文字", 0, 1e-7],
]


def assert_same(data: bytes):
    a = _read_xlsx_openpyxl(data, "x.xlsx", 500, 1_000_000)
    b = _read_xlsx_calamine(data, "x.xlsx", 500, 1_000_000)
    assert [(s.name, s.hidden) for s in a] == [(s.name, s.hidden) for s in b]
    for sa, sb in zip(a, b):
        assert len(sa.grid) == len(sb.grid), sa.name
        for r, (ra, rb) in enumerate(zip(sa.grid, sb.grid)):
            assert len(ra) == len(rb), (sa.name, r, ra, rb)
            for c, (va, vb) in enumerate(zip(ra, rb)):
                assert va == vb and type(va) is type(vb), f"{sa.name} 行{r + 1} 列{c + 1}: openpyxl={va!r} calamine={vb!r}"


def test_tricky_values_are_read_identically():
    assert_same(build({"値": TRICKY}))


def test_layout_title_rows_blank_rows_hidden_and_empty_sheets():
    report = [["月次売上報告（架空）"], [], ["部署", "金額"], ["営業1部", 120000], [], ["営業2部", 98000]]
    data = build({"表紙": [["表紙"]], "報告": report, "空": [], "隠し": [["a"], [1]]}, hidden=("隠し",), cells={"報告": {"F10": None}})
    assert_same(data)


def test_data_starting_away_from_a1():
    """A1から始まらない表でも、行・列の位置がずれないこと（タイトル行の判定に影響するため）。"""
    data = build({"S": []}, cells={"S": {"C3": "見出し", "D3": "値", "C4": "x", "D4": 1}})
    assert_same(data)
    grid = _read_xlsx_calamine(data, "x.xlsx", 500, 1000)[0].grid
    assert grid[2][2:] == ["見出し", "値"]


def test_formula_without_cached_value_is_blank_in_both():
    data = build({"S": [["a", "b"], [1, "=A2*2"]]})
    assert_same(data)


def test_error_cells_fall_back_to_openpyxl_and_are_not_blanked():
    """エラー値のセルがあるファイルは openpyxl で読み、#N/A を空欄にしない。"""
    data = build({"S": [["金額"], [100]]}, cells={"S": {"A3": "#N/A"}})
    assert _has_error_cells(data) is True
    grid = read_xlsx(data, "x.xlsx", 500, 1000)[0].grid
    assert grid[2] == ["#N/A"]
    # 参考：calamine で直接読むと #N/A が空欄になり、末尾の空行として行ごと消えてしまう（だから切り替えている）
    assert len(_read_xlsx_calamine(data, "x.xlsx", 500, 1000)[0].grid) == 2


def test_normal_file_uses_calamine():
    assert _has_error_cells(build({"S": TRICKY})) is False


@pytest.mark.parametrize("limit", [3, 10])
def test_row_limit_still_enforced(limit):
    from app.engine.result import NodeFailure  # noqa: F401
    from app.errors import AppError

    data = build({"S": [["n"]] + [[i] for i in range(20)]})
    with pytest.raises(AppError) as e:
        read_xlsx(data, "x.xlsx", 500, limit)
    assert e.value.code == "TOO_MANY_ROWS"
