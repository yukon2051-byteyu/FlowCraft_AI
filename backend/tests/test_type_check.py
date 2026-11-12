"""形式の確認API（タスク1-2）のテスト。デモの架空データ（今月分）を使う。"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.demos.generate import DATA_DIR
from app.main import create_app


@pytest.fixture
def ctx():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
        name = "売上実績_2026-11.xlsx"
        fid = c.post("/api/files", headers=h, files={"file": (name, (DATA_DIR / name).read_bytes())}).json()["file_id"]
        yield c, h, fid


def check(ctx, columns, **kw):
    c, h, fid = ctx
    res = c.post(f"/api/files/{fid}/type-check", headers=h, json={"columns": columns, **kw})
    assert res.status_code == 200, res.text
    return {r["name"]: r for r in res.json()}


def test_suitable_types_convert_everything(ctx):
    r = check(ctx, [{"name": "金額", "type": "integer"}, {"name": "売上日", "type": "date"}, {"name": "商品コード", "type": "string"}])
    assert (r["金額"]["converted"], r["金額"]["failed"]) == (252, 0)
    assert r["売上日"]["failed"] == 0
    # 商品コードの空欄（仕込んだ3件）は「変換失敗」ではなく「空欄」として数える
    assert (r["商品コード"]["blank"], r["商品コード"]["failed"]) == (3, 0)


def test_unsuitable_type_reports_count_and_excel_rows(ctx):
    r = check(ctx, [{"name": "商品コード", "type": "integer"}])["商品コード"]
    assert r["failed"] == 252 - 3
    assert r["examples"][0]["row"] == 2  # 見出しが1行目なので、データの1行目はExcelの2行目
    assert r["examples"][0]["value"].startswith("P-")
    assert len(r["examples"]) == 5


def test_unknown_column_is_reported_not_crashed(ctx):
    r = check(ctx, [{"name": "存在しない列", "type": "string"}])
    assert r["存在しない列"]["found"] is False


def test_type_check_requires_own_session_file(ctx):
    c, _, fid = ctx
    other = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
    assert c.post(f"/api/files/{fid}/type-check", headers=other, json={"columns": [{"name": "金額", "type": "integer"}]}).status_code == 404


def test_invalid_type_is_rejected(ctx):
    c, h, fid = ctx
    res = c.post(f"/api/files/{fid}/type-check", headers=h, json={"columns": [{"name": "金額", "type": "money"}]})
    assert res.status_code == 422
