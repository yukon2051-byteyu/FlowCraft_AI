"""セッション管理のテスト（タスク1-7）。

確認すること：
- セッションIDが推測できない・重複しない
- 他人のセッションのデータを取り出せない（ユーザー間の混在防止）
- 60分操作がなければデータごと削除される／操作すれば延長される
- 利用者が終了したら即座に削除される
- 同時セッション数の上限
- APIのエラーが共通形式（何が起きたか・直し方）で返る
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.errors import AppError
from app.main import _purge_loop, create_app
from app.sessions.store import SessionStore

TTL = 60 * 60  # 60分


class FakeClock:
    """テスト用の時計。advance() で時間を進める。"""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store(clock: FakeClock) -> SessionStore:
    return SessionStore(ttl_seconds=TTL, max_sessions=3, clock=clock)


# ===================== ストア単体 =====================


def test_session_ids_are_long_random_and_unique():
    s = SessionStore(ttl_seconds=TTL, max_sessions=1000)
    ids = {s.create().session_id for _ in range(500)}
    assert len(ids) == 500
    assert all(len(i) >= 40 for i in ids)


def test_data_is_isolated_between_sessions(store):
    a = store.create()
    b = store.create()
    a.files["f1"] = "Aさんの売上データ"
    assert store.get(b.session_id).files == {}
    assert "f1" not in store.get(b.session_id).files
    assert store.get(a.session_id).files["f1"] == "Aさんの売上データ"


@pytest.mark.parametrize("bad", [None, "", "not-a-real-session", "../../etc/passwd"])
def test_invalid_session_id_is_rejected(store, bad):
    with pytest.raises(AppError) as e:
        store.get(bad)
    assert e.value.status_code == 401


def test_expires_after_ttl_and_data_is_deleted(store, clock):
    s = store.create()
    s.files["f1"] = "data"
    clock.advance(TTL - 1)
    store.get(s.session_id)  # 59分59秒後：まだ有効（ここで最終操作時刻が更新される）
    clock.advance(TTL)
    with pytest.raises(AppError) as e:
        store.get(s.session_id)
    assert e.value.code == "SESSION_EXPIRED"
    assert len(store) == 0
    # 一度期限切れになったIDは、二度と使えない
    with pytest.raises(AppError) as e2:
        store.get(s.session_id)
    assert e2.value.code == "SESSION_NOT_FOUND"


def test_activity_extends_session(store, clock):
    s = store.create()
    for _ in range(5):  # 50分ごとに操作 → 合計250分でも有効
        clock.advance(50 * 60)
        store.get(s.session_id)
    assert store.remaining_seconds(s) == TTL


def test_purge_removes_only_expired(store, clock):
    old = store.create()
    clock.advance(TTL - 10)
    new = store.create()
    clock.advance(10)
    assert store.purge_expired() == 1
    assert len(store) == 1
    store.get(new.session_id)
    with pytest.raises(AppError):
        store.get(old.session_id)


def test_delete_removes_immediately(store):
    s = store.create()
    s.files["f1"] = "data"
    assert store.delete(s.session_id) is True
    assert store.delete(s.session_id) is False
    with pytest.raises(AppError):
        store.get(s.session_id)


def test_max_sessions_limit(store, clock):
    for _ in range(3):
        store.create()
    with pytest.raises(AppError) as e:
        store.create()
    assert e.value.status_code == 503
    # 期限切れのセッションがあれば、それを片付けてから新規発行できる
    clock.advance(TTL)
    store.create()
    assert len(store) == 1


def test_purge_loop_runs_periodically(clock):
    """定期削除の仕組みが、実際に期限切れセッションを削除すること。"""
    store = SessionStore(ttl_seconds=1, clock=clock)
    store.create()
    clock.advance(2)

    async def run() -> None:
        task = asyncio.create_task(_purge_loop(store, 0.01))
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(run())
    assert len(store) == 0


# ===================== API =====================


@pytest.fixture
def client():
    settings = Settings(_env_file=None, max_sessions=5)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def test_api_create_and_use_session(client):
    res = client.post("/api/session")
    assert res.status_code == 201
    body = res.json()
    assert body["expires_in_seconds"] == TTL
    info = client.get("/api/session", headers={"X-Session-Id": body["session_id"]})
    assert info.status_code == 200
    assert info.json() == {"expires_in_seconds": TTL, "file_count": 0}


def test_api_without_session_header(client):
    res = client.get("/api/session")
    assert res.status_code == 401
    err = res.json()["error"]
    assert err["code"] == "SESSION_REQUIRED"
    assert err["how_to_fix"]  # 直し方が必ず書かれている


def test_api_with_unknown_session(client):
    res = client.get("/api/session", headers={"X-Session-Id": "guessed-id"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "SESSION_NOT_FOUND"


def test_api_end_session(client):
    sid = client.post("/api/session").json()["session_id"]
    assert client.delete("/api/session", headers={"X-Session-Id": sid}).status_code == 204
    assert client.get("/api/session", headers={"X-Session-Id": sid}).status_code == 401


def test_api_server_busy(client):
    for _ in range(5):
        assert client.post("/api/session").status_code == 201
    res = client.post("/api/session")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "SERVER_BUSY"


def test_unexpected_error_hides_details():
    """想定外のエラーでも、内部の詳細（スタックトレース等）を画面に返さない。"""
    app = create_app(Settings(_env_file=None))

    @app.get("/api/_boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    with TestClient(app, raise_server_exceptions=False) as c:
        res = c.get("/api/_boom")
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "secret internal detail" not in res.text
    assert "エラー番号" in res.json()["error"]["message"]
