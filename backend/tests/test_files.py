"""ファイルアップロードのテスト（タスク1-8）。

テスト用のExcelはその場で生成する（すべて架空データ）。
正常系／境界値（仕様17.2）／偽装・攻撃的な入力（仕様16.1）を確認する。
"""

import io
import zipfile
from datetime import datetime

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

# ---------------------------------------------------------------------------
# 準備
# ---------------------------------------------------------------------------


def make_xlsx(sheets: dict[str, list[list]], hidden: tuple[str, ...] = ()) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
        if name in hidden:
            ws.sheet_state = "hidden"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SALES = [
    ["売上日", "商品コード", "数量", "単価", "金額", "備考"],
    [datetime(2026, 10, 1), "00123", 2, 1500.5, 3001, None],
    [datetime(2026, 10, 2), "A-2040", 1, 980, 980, "返品なし"],
    [datetime(2026, 10, 3), "00123", 5, 1500.5, 7502.5, None],
]


def make_client(**overrides) -> TestClient:
    settings = Settings(_env_file=None, **overrides)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture
def client():
    with make_client() as c:
        yield c


def new_session(client: TestClient) -> dict:
    sid = client.post("/api/session").json()["session_id"]
    return {"X-Session-Id": sid}


def upload(client: TestClient, headers: dict, name: str, data: bytes):
    return client.post("/api/files", headers=headers, files={"file": (name, data, "application/octet-stream")})


def error_code(res) -> str:
    return res.json()["error"]["code"]


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_upload_xlsx_basic(client):
    h = new_session(client)
    res = upload(client, h, "売上実績.xlsx", make_xlsx({"売上": SALES, "メモ": [["メモ"], ["架空"]]}))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["kind"] == "xlsx"
    assert [s["name"] for s in body["sheets"]] == ["売上", "メモ"]
    d = body["detail"]
    assert d["sheet"] == "売上"
    assert (d["row_count"], d["column_count"]) == (3, 6)
    types = {c["name"]: c["inferred_type"] for c in d["columns"]}
    assert types == {
        "売上日": "date",
        "商品コード": "string",
        "数量": "integer",
        "単価": "decimal",
        "金額": "decimal",
        "備考": "string",
    }
    biko = next(c for c in d["columns"] if c["name"] == "備考")
    assert (biko["null_count"], biko["non_null_count"]) == (2, 1)


def test_leading_zero_codes_are_kept(client):
    """商品コード「00123」を数値123にしない（マスタ照合が壊れるため）。"""
    h = new_session(client)
    d = upload(client, h, "a.xlsx", make_xlsx({"売上": SALES})).json()["detail"]
    assert d["preview"]["rows"][0][1] == "00123"
    assert d["preview"]["rows"][0][0] == "2026/10/01"


@pytest.mark.parametrize(
    ("encoding", "label", "prefix"),
    [("utf-8", "UTF-8", b""), ("utf-8", "UTF-8（BOM付き）", b"\xef\xbb\xbf"), ("cp932", "Shift_JIS（CP932）", b"")],
)
def test_upload_csv_encodings(client, encoding, label, prefix):
    text = "日付,部署コード,金額\r\n2026/10/01,001,1000\r\n2026/10/02,002,2500.5\r\n"
    h = new_session(client)
    res = upload(client, h, "部署.csv", prefix + text.encode(encoding))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encoding"] == label
    d = body["detail"]
    assert d["preview"]["columns"] == ["日付", "部署コード", "金額"]
    assert {c["name"]: c["inferred_type"] for c in d["columns"]} == {"日付": "date", "部署コード": "string", "金額": "decimal"}
    assert d["preview"]["rows"][0] == ["2026/10/01", "001", "1000"]  # CSVは文字列のまま


def test_csv_quoted_fields_and_trailing_empty(client):
    text = '名前,住所,メモ\r\n"山田, 太郎","東京都\n千代田区",\r\n'
    h = new_session(client)
    d = upload(client, h, "q.csv", text.encode("utf-8")).json()["detail"]
    assert d["preview"]["rows"] == [["山田, 太郎", "東京都\n千代田区", None]]
    assert d["warnings"] == []  # 行末の空欄は「区切りが足りない行」ではない


def test_preview_is_limited_but_counts_are_full(client):
    rows = [["ID", "金額"]] + [[i, i * 10] for i in range(1, 121)]
    h = new_session(client)
    d = upload(client, h, "big.xlsx", make_xlsx({"S": rows})).json()["detail"]
    assert d["preview"]["shown"] == 50
    assert d["preview"]["total"] == 120
    assert d["row_count"] == 120
    assert d["columns"][1]["unique_count"] == 120


def test_switch_sheet_and_header_row(client):
    report = [["月次売上報告（架空）"], [], ["部署", "金額"], ["営業1部", 100], ["営業2部", 200]]
    h = new_session(client)
    body = upload(client, h, "r.xlsx", make_xlsx({"表紙": [["表紙"]], "報告": report})).json()
    fid = body["file_id"]
    d = client.get(f"/api/files/{fid}", headers=h, params={"sheet": "報告", "header_row": 3}).json()
    assert d["preview"]["columns"] == ["部署", "金額"]
    assert d["row_count"] == 2
    assert client.get(f"/api/files/{fid}", headers=h, params={"sheet": "存在しない"}).status_code == 404
    assert error_code(client.get(f"/api/files/{fid}", headers=h, params={"sheet": "報告", "header_row": 9})) == "HEADER_ROW_OUT_OF_RANGE"


def test_hidden_and_empty_sheets_are_not_default(client):
    h = new_session(client)
    data = make_xlsx({"隠し": [["a"], [1]], "空": [], "本体": [["b"], [2]]}, hidden=("隠し",))
    body = upload(client, h, "s.xlsx", data).json()
    assert body["detail"]["sheet"] == "本体"
    sheets = {s["name"]: s for s in body["sheets"]}
    assert sheets["隠し"]["hidden"] is True
    assert sheets["空"]["is_empty"] is True


def test_list_and_delete(client):
    h = new_session(client)
    fid = upload(client, h, "a.xlsx", make_xlsx({"S": SALES})).json()["file_id"]
    assert [f["file_id"] for f in client.get("/api/files", headers=h).json()] == [fid]
    assert client.delete(f"/api/files/{fid}", headers=h).status_code == 204
    assert client.get("/api/files", headers=h).json() == []
    assert client.get(f"/api/files/{fid}", headers=h).status_code == 404


def test_other_session_cannot_access_file(client):
    a = new_session(client)
    b = new_session(client)
    fid = upload(client, a, "a.xlsx", make_xlsx({"S": SALES})).json()["file_id"]
    assert client.get(f"/api/files/{fid}", headers=b).status_code == 404
    assert client.delete(f"/api/files/{fid}", headers=b).status_code == 404
    assert client.get("/api/files", headers=b).json() == []
    assert client.get(f"/api/files/{fid}", headers=a).status_code == 200


def test_upload_requires_session(client):
    res = upload(client, {}, "a.xlsx", make_xlsx({"S": SALES}))
    assert res.status_code == 401


def test_filename_is_sanitized(client):
    h = new_session(client)
    body = upload(client, h, "..\\..\\windows\\evil.csv", b"a\r\n1\r\n").json()
    assert body["filename"] == "evil.csv"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd.csv", "passwd.csv"),
        ("C:\\Users\\x\\売上.xlsx", "売上.xlsx"),
        ("evil\x07\x00name.csv", "evilname.csv"),  # 制御文字の除去
        (".hidden.csv", "hidden.csv"),
        ("", "名称未設定"),
        (None, "名称未設定"),
        ("あ" * 300 + ".csv", "あ" * 120),
    ],
)
def test_safe_filename(raw, expected):
    """送信ツールは制御文字を %07 などに変換してしまうため、関数を直接呼んで確認する。"""
    from app.files.detect import safe_filename

    assert safe_filename(raw) == expected


# ---------------------------------------------------------------------------
# 境界値（仕様17.2）
# ---------------------------------------------------------------------------


def test_empty_file(client):
    h = new_session(client)
    assert error_code(upload(client, h, "e.csv", b"")) == "EMPTY_FILE"


def test_workbook_with_only_empty_sheets(client):
    h = new_session(client)
    assert error_code(upload(client, h, "e.xlsx", make_xlsx({"S1": [], "S2": []}))) == "EMPTY_FILE"


def test_header_only(client):
    h = new_session(client)
    d = upload(client, h, "h.csv", "日付,金額\r\n".encode()).json()["detail"]
    assert d["row_count"] == 0
    assert [w["code"] for w in d["warnings"]] == ["HEADER_ONLY"]
    assert all(c["note"] == "すべて空欄です。" for c in d["columns"])


def test_single_row(client):
    h = new_session(client)
    d = upload(client, h, "one.csv", "日付,金額\r\n2026/10/01,100\r\n".encode()).json()["detail"]
    assert d["row_count"] == 1


def test_duplicate_and_blank_headers(client):
    rows = [["金額", None, "金額", " 部署 "], [1, 2, 3, "営業"]]
    h = new_session(client)
    d = upload(client, h, "d.xlsx", make_xlsx({"S": rows})).json()["detail"]
    assert d["preview"]["columns"] == ["金額", "列B", "金額_2", "部署"]
    assert {w["code"] for w in d["warnings"]} == {"BLANK_HEADER", "DUPLICATE_HEADER", "HEADER_TRIMMED"}


def test_data_without_header_gets_column(client):
    """見出しのない列にデータがある場合も、データを捨てずに仮の列名で残す。"""
    h = new_session(client)
    d = upload(client, h, "x.csv", "a,b\r\n1,2,3\r\n".encode()).json()["detail"]
    assert d["preview"]["columns"] == ["a", "b", "列C"]
    assert d["preview"]["rows"] == [["1", "2", "3"]]


def test_all_missing_column(client):
    rows = [["ID", "備考"], [1, None], [2, None]]
    h = new_session(client)
    col = upload(client, h, "m.xlsx", make_xlsx({"S": rows})).json()["detail"]["columns"][1]
    assert (col["null_count"], col["non_null_count"], col["inferred_type"]) == (2, 0, "string")


def test_mixed_types_are_reported(client):
    rows = [["金額"]] + [[i * 100] for i in range(1, 20)] + [["未定"]]
    h = new_session(client)
    col = upload(client, h, "t.xlsx", make_xlsx({"S": rows})).json()["detail"]["columns"][0]
    assert col["inferred_type"] == "string"
    assert "整数と思われますが、一致しない値が1件" in col["note"]
    assert "未定" in col["note"]


def test_short_rows_and_empty_rows_in_csv(client):
    text = "a,b,c\r\n1,2,3\r\n4,5\r\n\r\n7,8,9\r\n"
    h = new_session(client)
    d = upload(client, h, "r.csv", text.encode()).json()["detail"]
    assert d["row_count"] == 4  # 空行も削除せず残す
    assert {w["code"] for w in d["warnings"]} == {"SHORT_ROWS", "EMPTY_ROWS"}
    assert d["preview"]["rows"][1] == ["4", "5", None]


def test_trailing_empty_rows_are_ignored():
    with make_client() as c:
        h = new_session(c)
        d = upload(c, h, "t.csv", "a\r\n1\r\n\r\n\r\n,\r\n".encode()).json()["detail"]
        assert d["row_count"] == 1
        assert d["warnings"] == []


def test_file_size_limit_in_handler():
    with make_client(max_file_size_mb=1) as c:
        h = new_session(c)
        res = upload(c, h, "big.csv", b"a\r\n" + b"1\r\n" * 600_000)  # 約1.8MB
        assert res.status_code == 413
        assert error_code(res) == "FILE_TOO_LARGE"


def test_max_files_limit():
    with make_client(max_files=2) as c:
        h = new_session(c)
        for i in range(2):
            assert upload(c, h, f"{i}.csv", b"a\r\n1\r\n").status_code == 201
        res = upload(c, h, "3.csv", b"a\r\n1\r\n")
        assert (res.status_code, error_code(res)) == (409, "TOO_MANY_FILES")


def test_total_rows_limit_across_files():
    with make_client(max_total_rows=10) as c:
        h = new_session(c)
        assert upload(c, h, "a.csv", ("a\r\n" + "1\r\n" * 6).encode()).status_code == 201
        res = upload(c, h, "b.csv", ("a\r\n" + "1\r\n" * 5).encode())
        assert (res.status_code, error_code(res)) == (413, "TOTAL_ROWS_EXCEEDED")
        assert upload(c, h, "c.csv", ("a\r\n" + "1\r\n" * 4).encode()).status_code == 201  # ちょうど上限


def test_rows_limit_single_file():
    with make_client(max_total_rows=5) as c:
        h = new_session(c)
        rows = [["n"]] + [[i] for i in range(10)]
        assert error_code(upload(c, h, "a.xlsx", make_xlsx({"S": rows}))) == "TOO_MANY_ROWS"


def test_column_limit():
    with make_client(max_columns=5) as c:
        h = new_session(c)
        assert error_code(upload(c, h, "w.csv", b"a,b,c,d,e,f\r\n1,2,3,4,5,6\r\n")) == "TOO_MANY_COLUMNS"


# ---------------------------------------------------------------------------
# 偽装・不正なファイル（仕様16.1）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["data.txt", "data.json", "data", "data.accdb"])
def test_unsupported_extension(client, name):
    h = new_session(client)
    assert error_code(upload(client, h, name, b"a,b\r\n1,2\r\n")) == "UNSUPPORTED_FILE_TYPE"


@pytest.mark.parametrize("name", ["old.xls", "macro.xlsm"])
def test_unsupported_excel_variants(client, name):
    h = new_session(client)
    assert error_code(upload(client, h, name, b"dummy")) == "UNSUPPORTED_EXCEL_FORMAT"


def test_text_disguised_as_xlsx(client):
    h = new_session(client)
    assert error_code(upload(client, h, "fake.xlsx", b"a,b\r\n1,2\r\n")) == "EXTENSION_MISMATCH"


def test_xlsx_disguised_as_csv(client):
    h = new_session(client)
    assert error_code(upload(client, h, "fake.csv", make_xlsx({"S": SALES}))) == "EXTENSION_MISMATCH"


def test_password_protected_or_legacy(client):
    h = new_session(client)
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512
    assert error_code(upload(client, h, "secret.xlsx", ole)) == "ENCRYPTED_OR_LEGACY_EXCEL"


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, b in files.items():
            zf.writestr(n, b)
    return buf.getvalue()


def test_zip_that_is_not_excel(client):
    h = new_session(client)
    assert error_code(upload(client, h, "x.xlsx", _zip({"hello.txt": b"hi"}))) == "NOT_EXCEL_WORKBOOK"


def test_macro_inside_xlsx(client):
    data = make_xlsx({"S": SALES})
    with zipfile.ZipFile(io.BytesIO(data)) as src:
        parts = {n: src.read(n) for n in src.namelist()}
    parts["xl/vbaProject.bin"] = b"fake macro"
    h = new_session(client)
    assert error_code(upload(client, h, "m.xlsx", _zip(parts))) == "MACRO_NOT_SUPPORTED"


def test_zip_bomb_is_rejected():
    bomb = _zip({"[Content_Types].xml": b"<x/>", "xl/workbook.xml": b"<x/>", "xl/big.xml": b"0" * (3 * 1024 * 1024)})
    assert len(bomb) < 50_000  # 送信サイズは小さいが、展開すると3MB
    with make_client(max_uncompressed_mb=2) as c:
        h = new_session(c)
        assert error_code(upload(c, h, "bomb.xlsx", bomb)) == "XLSX_TOO_LARGE_UNCOMPRESSED"


def test_corrupted_xlsx(client):
    h = new_session(client)
    data = make_xlsx({"S": SALES})
    assert error_code(upload(client, h, "broken.xlsx", data[: len(data) // 2])) == "CORRUPTED_XLSX"


def test_broken_workbook_xml(client):
    h = new_session(client)
    bad = _zip({"[Content_Types].xml": b"<x/>", "xl/workbook.xml": b"not xml at all"})
    assert error_code(upload(client, h, "bad.xlsx", bad)) == "CORRUPTED_XLSX"


def test_binary_named_csv(client):
    h = new_session(client)
    assert error_code(upload(client, h, "bin.csv", b"\x00\x01\x02binary")) == "BINARY_NOT_CSV"


def test_undecodable_csv(client):
    h = new_session(client)
    # UTF-8でもCP932でも解釈できないバイト列（0x81 の後ろに、2バイト目として不正な値）
    # ※ 0xFF などはPythonのCP932では読めてしまうため使わない
    assert error_code(upload(client, h, "x.csv", b"a,b\r\n\x81\x20\r\n")) == "UNKNOWN_ENCODING"


def test_content_length_guard_rejects_before_reading():
    with make_client(max_file_size_mb=1) as c:
        h = new_session(c)
        res = c.post(
            "/api/files",
            headers={**h, "Content-Length": str(50 * 1024 * 1024), "Content-Type": "multipart/form-data; boundary=x"},
            content=b"--x--",
        )
        assert res.status_code == 413
