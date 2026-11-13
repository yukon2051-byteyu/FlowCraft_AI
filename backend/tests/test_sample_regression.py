"""利用者が実際の Excel で作った検証用サンプル（架空データ）による回帰テスト。

tests/fixtures/blank_title_total_sample.xlsx（2026-11-13 受領。公開前にメタデータ・コメント・外部リンク・非表示シートがないことを確認済み）
- 1行目：A1:G1 を結合した表題 → 見出しと間違えない（見出しは3行目）
- 2行目：空行
- E5：空白文字だけのセル（半角スペース3個）
- D6：数値の未入力
- 7行目：完全空白行（F7 は空の文字列を返す数式）
- 9行目：「集計メモ」（売上 300,000 ＝ 上の行の合計。A9:B9 を結合）

空白データの品質ルール（Phase Q）で、検出と扱いのテストをこのファイルに追加していく。
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

SAMPLE = Path(__file__).parent / "fixtures" / "blank_title_total_sample.xlsx"


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def upload(client):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    res = client.post("/api/files", headers=h, files={"file": ("サンプル.xlsx", SAMPLE.read_bytes())})
    assert res.status_code == 201, res.text
    return h, res.json()


def test_merged_title_is_not_taken_as_header(client):
    h, body = upload(client)
    d = body["detail"]
    assert d["header_row"] == 3
    assert [c["name"] for c in d["columns"]] == ["社員ID", "氏名", "部署", "売上金額", "備考（空白文字検証）", "数式の結果", "判定メモ"]
    assert d["warnings"][0]["code"] == "HEADER_ROW_GUESSED"
    assert "3行目と推定しました" in d["warnings"][0]["message"]
    # 利用者が見出しの行を指定したときは、推定しない（その行を使う）
    again = client.get(f"/api/files/{body['file_id']}?header_row=1", headers=h).json()
    assert again["header_row"] == 1 and all(w["code"] != "HEADER_ROW_GUESSED" for w in again["warnings"])


def test_blank_row_and_values_are_read_as_they_are(client):
    _, body = upload(client)
    d = body["detail"]
    rows = d["preview"]["rows"]
    assert d["row_count"] == 6  # 4〜9行目（空行と集計メモを含む。除外の扱いは Phase Q）
    assert rows[1][4] == "   "  # 空白文字だけのセルは、そのまま読める（実際の Excel のファイルで確認）
    assert rows[2][3] is None  # 数値の未入力
    assert all(v is None for v in rows[3])  # 完全空白行（空の文字列を返す数式のセルも空欄として読む）
    assert any(w["code"] == "EMPTY_ROWS" for w in d["warnings"])
