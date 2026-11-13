"""Phase Q-2：空白データの検出（docs/blank-data-design.md §3）。

実際の Excel で作って保存したサンプル（blank_title_total_sample.xlsx。利用者が用意した架空のデータ）で確かめる：
- 7行目：表の途中の完全空白行（F7 は空の文字列を返す数式だが、空とみなす）
- E5：空白文字だけのセル（半角スペース3個。見た目は空欄）
- D6：普通の空欄（売上の未入力）
- F7・F9：空の文字列を返す数式（普通の空欄と区別する）
- A9:B9：結合セル（B9 は欠損として数えない）
- 9行目：集計メモの行（売上 300,000 ＝ 上の行の合計）
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.files.blanks import detect_blanks
from app.files.parse import read_csv, read_xlsx
from app.files.profile import build_table
from app.main import create_app

SAMPLE = Path(__file__).parent / "fixtures" / "blank_title_total_sample.xlsx"


def report_of(sheet, header_row):
    return detect_blanks(sheet, header_row, build_table(sheet, header_row, is_csv=False).columns)


def test_sample_excel_detects_each_kind_of_blank():
    sheet = read_xlsx(SAMPLE.read_bytes(), SAMPLE.name, 200, 100_000)[0]
    r = report_of(sheet, 3)
    cols = {c.name: c for c in r.columns}
    names = list(cols)
    assert r.formulas_checked is True
    assert r.middle_blank_rows == [7]
    assert r.whitespace_cells == ["E5"]
    sales = cols[names[3]]
    assert (sales.blank, sales.rows) == (1, [6])  # D6
    note = cols[names[4]]
    assert (note.whitespace_only, note.blank, note.rows) == (1, 0, [5])  # E5 は空欄に見えるが、値は空白文字
    formula = cols[names[5]]
    assert formula.formula_blank == 1 and formula.blank == 0  # F9（F7 は完全空白行の中）
    assert r.formula_blank_cells == ["F7", "F9"]
    # 結合セル：見出しより上の表題（A1:G1）は対象外。A9:B9 の B9 は欠損として数えない
    assert r.merged_ranges == ["A9:B9"]
    assert (cols[names[1]].merged, cols[names[1]].total) == (1, 0)
    # 集計メモの行
    (cand,) = r.total_row_candidates
    assert cand.row == 9
    assert any("上の行の合計と一致" in x and "300,000" in x for x in cand.reasons)
    assert any("集計メモ" in x for x in cand.reasons)


def test_csv_blank_rows_whitespace_and_no_formulas():
    text = "コード,名前,金額\r\nA1,田中,100\r\n,,\r\nA2,  ,200\r\nA3,,300\r\n"
    sheet = read_csv(text, "x.csv", 200, 100_000)
    r = detect_blanks(sheet, 1, build_table(sheet, 1, is_csv=True).columns)
    assert r.middle_blank_rows == [3]
    name = r.columns[1]
    assert (name.whitespace_only, name.blank, name.rows) == (1, 1, [4, 5])
    assert r.formulas_checked is True and r.formula_blank_cells == [] and r.merged_ranges == []
    # 最後の行の金額 300 は、上の行の合計（100＋200）と一致するので「合計の行の可能性」として示す（CSV の数字の文字列も数値とみなす）
    assert [c.row for c in r.total_row_candidates] == [5]


def test_no_total_candidate_when_last_row_is_ordinary():
    text = "コード,金額\r\nA1,100\r\nA2,200\r\nA3,250\r\n"
    sheet = read_csv(text, "x.csv", 200, 100_000)
    r = detect_blanks(sheet, 1, build_table(sheet, 1, is_csv=True).columns)
    assert r.total_row_candidates == [] and r.middle_blank_rows == [] and not r.has_any


def test_trailing_blank_rows_are_not_middle_rows():
    text = "コード,金額\r\nA1,100\r\n,\r\nA2,200\r\n,\r\n,\r\n"
    sheet = read_csv(text, "x.csv", 200, 100_000)
    r = detect_blanks(sheet, 1, build_table(sheet, 1, is_csv=True).columns)
    assert r.middle_blank_rows == [3]


def test_sheet_detail_api_returns_blanks():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
        up = c.post("/api/files", headers=h, files={"file": (SAMPLE.name, SAMPLE.read_bytes())}).json()
        detail = c.get(f"/api/files/{up['file_id']}", headers=h, params={"header_row": 3}).json()
        b = detail["blanks"]
        assert b["middle_blank_rows"] == [7] and b["whitespace_cells"] == ["E5"] and b["formula_blank_cells"] == ["F7", "F9"]
        assert b["total_row_candidates"][0]["row"] == 9
