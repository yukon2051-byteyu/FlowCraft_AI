"""稼働確認APIのテスト。"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


def make_client(**settings_overrides) -> TestClient:
    """設定を差し替えたテスト用クライアントを作る（実際の .env の影響を受けない）。"""
    settings = Settings(_env_file=None, **settings_overrides)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def test_health_returns_ok():
    res = make_client().get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["engine_version"] == "0.1.0"
    # 画面が起動時に確かめるAPIの版（画面の EXPECTED_API_REVISION と同じ値）
    from app import API_REVISION

    assert body["api_revision"] == API_REVISION
    expected = (Path(__file__).parents[2] / "frontend" / "src" / "api" / "serverVersion.ts").read_text(encoding="utf-8")
    assert f"EXPECTED_API_REVISION = {API_REVISION}" in expected


HASH = "pbkdf2_sha256$1000$c2FsdA==$ZHVtbXk="  # 形だけのハッシュ（状態の判定に使う。照合はしない）


def test_ai_mode_is_off_without_api_key():
    # APIキーがないときは、固定応答へ黙って切り替えず「使わない」（未完成・未設定のAIを使えるように見せない）
    res = make_client(anthropic_api_key=None, ai_password_hash=HASH).get("/api/health")
    assert res.json()["ai_mode"] == "off"


def test_ai_mode_is_off_with_empty_api_key():
    # .env に「ANTHROPIC_API_KEY=」と空で書いた場合も使わない
    res = make_client(anthropic_api_key="", ai_password_hash=HASH).get("/api/health")
    assert res.json()["ai_mode"] == "off"


def test_ai_mode_is_off_without_password_even_with_api_key():
    # AI使用パスワードがなければ認証できないので、APIキーがあっても使わない
    res = make_client(anthropic_api_key="sk-test-dummy").get("/api/health")
    assert res.json()["ai_mode"] == "off"


def test_ai_mode_is_live_with_api_key_and_password():
    res = make_client(anthropic_api_key="sk-test-dummy", ai_password_hash=HASH).get("/api/health")
    assert res.json()["ai_mode"] == "live"


def test_ai_mode_is_fixed_only_when_chosen():
    res = make_client(ai_mode="fixed", ai_password_hash=HASH).get("/api/health")
    assert res.json()["ai_mode"] == "fixed"


def test_api_key_is_not_exposed():
    # 稼働確認の応答にAPIキーが含まれないこと（セキュリティ）
    res = make_client(anthropic_api_key="sk-test-secret-value").get("/api/health")
    assert "sk-test-secret-value" not in res.text


def test_unknown_path_returns_404():
    res = make_client().get("/api/does-not-exist")
    assert res.status_code == 404
