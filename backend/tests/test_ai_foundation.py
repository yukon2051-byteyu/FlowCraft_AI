"""A-1：AIの土台（docs/ai-auth-design.md）のテスト。実際のAIは呼ばない（固定応答モードと、呼び出し口の差し替えで確かめる）。

- AIの状態：未設定なら使わない（固定応答へ黙って切り替えない）
- AI使用パスワード：ハッシュで照合・失敗回数の制限（セッション・接続元）・期限（最後の利用から／最長）・解除
- 上限：1時間あたりの回数・月の費用（呼ぶ前に確保。超えるならAIを呼ばない）
- 出力の検証：形が違う・回答を断った・途中で切れた応答は使わない（費用は記録する）。呼べなかったときは確保を戻す
- 応答にパスワード・APIキー・ハッシュを含めない
"""

from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

import app.ai.client as ai_client
from app.ai.password import hash_password, verify_password
from app.ai.usage import UsageLedger, cost_usd
from app.config import Settings, get_settings
from app.errors import AppError
from app.main import create_app

PASSWORD = "test-ai-password"
HASH = hash_password(PASSWORD, iterations=1_000)  # テストでは回数を減らして速くする


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):  # 2027年1月ごろ
        self.t = t

    def __call__(self) -> float:
        return self.t


def make(**overrides):
    settings = Settings(_env_file=None, **{"ai_mode": "fixed", "ai_password_hash": HASH, **overrides})
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    clock = Clock()
    app.state.ai.clock = clock
    app.state.ai.ledger.clock = clock
    client = TestClient(app)
    sid = client.post("/api/session").json()["session_id"]
    client.headers["X-Session-Id"] = sid
    return client, app, clock


def code(res) -> str:
    return res.json()["error"]["code"]


# ---------- パスワード ----------


def test_パスワードはハッシュで照合し_形の崩れたハッシュでは常に失敗():
    h = hash_password("合言葉123", iterations=1_000)
    assert "合言葉123" not in h
    assert verify_password("合言葉123", h) is True
    assert verify_password("ちがう", h) is False
    assert verify_password("合言葉123", "壊れた値") is False
    assert hash_password("x", iterations=1_000) != hash_password("x", iterations=1_000)  # 塩で毎回変わる
    with pytest.raises(ValueError):
        hash_password("")


# ---------- AIの状態 ----------


def test_未設定ならAIは使わず_認証もAIの操作も503で_AIなしの手順作成を案内する():
    client, _, _ = make(ai_mode="auto")  # APIキーがない
    assert client.get("/api/ai/status").json()["status"] == "off"
    for res in [client.post("/api/ai/auth", json={"password": PASSWORD}), client.post("/api/ai/check")]:
        assert res.status_code == 503 and code(res) == "AI_UNAVAILABLE"
        assert "改善診断をせずに手順を作る" in res.json()["error"]["how_to_fix"]


# ---------- 認証 ----------


def test_認証していなければ_AIの操作は401で_AIを呼ばない():
    client, app, _ = make()
    res = client.post("/api/ai/check")
    assert res.status_code == 401 and code(res) == "AI_AUTH_REQUIRED"
    assert app.state.ai.ledger.records == []


def test_正しいパスワードで認証すると_AIの操作が使え_解除するとまた求める():
    client, app, _ = make()
    assert client.post("/api/ai/auth", json={"password": "ちがう"}).status_code == 401
    res = client.post("/api/ai/auth", json={"password": PASSWORD})
    assert res.status_code == 200 and res.json()["authenticated"] is True
    check = client.post("/api/ai/check")
    assert check.status_code == 200
    assert check.json() == {"ok": True, "message": "固定応答モードで動いています（AIは呼んでいません）"}
    # 固定応答モードは費用0で記録する（業務データは記録しない）
    rec = app.state.ai.ledger.records[-1]
    assert (rec.feature, rec.cost_usd) == ("check", 0.0)
    assert client.get("/api/ai/status").json()["calls_left_this_hour"] == 19
    assert client.delete("/api/ai/auth").status_code == 204
    assert code(client.post("/api/ai/check")) == "AI_AUTH_REQUIRED"


def test_失敗が15分に5回を超えると_正しいパスワードでも受け付けない_接続元でも数える():
    client, app, clock = make()
    for _ in range(5):
        assert code(client.post("/api/ai/auth", json={"password": "ちがう"})) == "AI_AUTH_FAILED"
    res = client.post("/api/ai/auth", json={"password": PASSWORD})
    assert res.status_code == 429 and code(res) == "AI_AUTH_LOCKED"
    # 別のセッションでも、同じ接続元なら受け付けない（セッションを作り直して回避させない）
    other = TestClient(app)
    other.headers["X-Session-Id"] = other.post("/api/session").json()["session_id"]
    assert code(other.post("/api/ai/auth", json={"password": PASSWORD})) == "AI_AUTH_LOCKED"
    # 15分たてば受け付ける
    clock.t += 15 * 60
    assert client.post("/api/ai/auth", json={"password": PASSWORD}).status_code == 200


def test_認証は最後の利用から60分で切れ_使い続けても最長8時間で切れる():
    client, _, clock = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    clock.t += 59 * 60
    assert client.post("/api/ai/check").status_code == 200  # 使うと延びる
    clock.t += 59 * 60
    assert client.get("/api/ai/status").json()["authenticated"] is True
    clock.t += 2 * 60
    assert client.get("/api/ai/status").json()["authenticated"] is False
    # 最長8時間
    client.post("/api/ai/auth", json={"password": PASSWORD})
    for _ in range(10):  # 50分ごとに使い続けて、8時間20分
        clock.t += 50 * 60
        client.post("/api/ai/check")
    assert client.get("/api/ai/status").json()["authenticated"] is False


# ---------- 上限 ----------


def test_1時間あたりの回数を超えると_AIを呼ばずに429():
    client, app, clock = make(ai_calls_per_hour=2)
    client.post("/api/ai/auth", json={"password": PASSWORD})
    assert client.post("/api/ai/check").status_code == 200
    assert client.post("/api/ai/check").status_code == 200
    res = client.post("/api/ai/check")
    assert res.status_code == 429 and code(res) == "AI_LIMIT_REACHED"
    assert len(app.state.ai.ledger.records) == 2
    # 1時間たてば、また呼べる（最後の利用から60分で認証も切れるので、認証し直す）
    clock.t += 3600
    client.post("/api/ai/auth", json={"password": PASSWORD})
    assert client.post("/api/ai/check").status_code == 200


def test_月の予算_呼ぶ前に最大の費用を確保し_超えるなら呼ばない_月が変わると0から():
    clock = Clock()
    ledger = UsageLedger(monthly_budget_usd=0.05, calls_per_hour=100, clock=clock)
    a = ledger.reserve("s1", 0.03)
    with pytest.raises(AppError) as e:
        ledger.reserve("s2", 0.03)  # 確保中の分も数える（同時の呼び出しで上限を超えない）
    assert e.value.code == "AI_BUDGET_REACHED"
    ledger.commit(a, "check", "claude-opus-5-5", 1000, 500)  # 実際の費用に直す
    assert ledger.spent_usd == pytest.approx(cost_usd("claude-opus-5-5", 1000, 500)) == pytest.approx(0.014)
    ledger.reserve("s2", 0.03)  # 0.014 + 0.03 <= 0.05
    clock.t += 40 * 24 * 3600
    assert ledger.spent_usd == 0.0


# ---------- 実際のAI（呼び出し口を偽物に差し替える） ----------


class FakeMessages:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, []

    def parse(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def live(monkeypatch):
    def setup(result=None, error=None):
        msgs = FakeMessages(result, error)
        monkeypatch.setattr(ai_client, "make_client", lambda settings: SimpleNamespace(messages=msgs))
        client, app, _ = make(ai_mode="auto", anthropic_api_key="sk-test-secret-value")
        client.post("/api/ai/auth", json={"password": PASSWORD})
        return client, app, msgs

    return setup


def usage(i, o):
    return SimpleNamespace(input_tokens=i, output_tokens=o)


def test_実際のAI_決めた形で受け取り_実際の費用を記録する(live):
    from app.api.ai import CheckResult

    client, app, msgs = live(SimpleNamespace(stop_reason="end_turn", parsed_output=CheckResult(ok=True, message="接続できました"), usage=usage(1000, 500)))
    res = client.post("/api/ai/check")
    assert res.json() == {"ok": True, "message": "接続できました"}
    assert msgs.calls[0]["model"] == "claude-opus-5-5" and msgs.calls[0]["output_format"] is CheckResult
    assert app.state.ai.ledger.spent_usd == pytest.approx(0.014)


@pytest.mark.parametrize(
    "stop, parsed, cause",
    [("refusal", None, "回答を断りました"), ("max_tokens", None, "途中で切れました"), ("end_turn", None, "取り出せませんでした")],
)
def test_実際のAI_使えない応答は使わず502_費用は記録する(live, stop, parsed, cause):
    client, app, _ = live(SimpleNamespace(stop_reason=stop, parsed_output=parsed, usage=usage(800, 200)))
    res = client.post("/api/ai/check")
    assert res.status_code == 502 and code(res) == "AI_BAD_OUTPUT"
    assert cause in res.json()["error"]["cause"]
    assert app.state.ai.ledger.spent_usd == pytest.approx(cost_usd("claude-opus-5-5", 800, 200))


def test_実際のAI_呼べなかったときは503で_確保した費用を戻す(live):
    err = anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    client, app, _ = live(error=err)
    res = client.post("/api/ai/check")
    assert res.status_code == 503 and code(res) == "AI_CALL_FAILED"
    assert app.state.ai.ledger.spent_usd == 0.0
    assert app.state.ai.ledger._reserved == {}


def test_応答にパスワード_APIキー_ハッシュを含めない(live):
    client, _, _ = live(SimpleNamespace(stop_reason="end_turn", parsed_output=None, usage=usage(1, 1)))
    texts = [client.get("/api/ai/status").text, client.get("/api/health").text, client.post("/api/ai/check").text]
    for t in texts:
        for secret in ["sk-test-secret-value", PASSWORD, HASH]:
            assert secret not in t
