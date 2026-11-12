"""稼働確認APIのテスト。"""

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


def make_client(**settings_overrides) -> TestClient:
    """設定を差し替えたテスト用クライアントを作る（実際の .env の影響を受けない）。"""
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, **settings_overrides)
    return TestClient(app)


def test_health_returns_ok():
    res = make_client().get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["engine_version"] == "0.1.0"


def test_ai_mode_is_fixed_without_api_key():
    res = make_client(anthropic_api_key=None).get("/api/health")
    assert res.json()["ai_mode"] == "fixed"


def test_ai_mode_is_fixed_with_empty_api_key():
    # .env に「ANTHROPIC_API_KEY=」と空で書いた場合も固定応答モードになること
    res = make_client(anthropic_api_key="").get("/api/health")
    assert res.json()["ai_mode"] == "fixed"


def test_ai_mode_is_live_with_api_key():
    res = make_client(anthropic_api_key="sk-test-dummy").get("/api/health")
    assert res.json()["ai_mode"] == "live"


def test_api_key_is_not_exposed():
    # 稼働確認の応答にAPIキーが含まれないこと（セキュリティ）
    res = make_client(anthropic_api_key="sk-test-secret-value").get("/api/health")
    assert "sk-test-secret-value" not in res.text


def test_unknown_path_returns_404():
    res = make_client().get("/api/does-not-exist")
    assert res.status_code == 404
