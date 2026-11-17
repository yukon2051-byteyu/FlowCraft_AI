"""アプリ自体のセキュリティ（9-3）。送信の大きさの上限と、ブラウザ向けの安全設定。すべて架空のデータ。"""

import json

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make(**overrides) -> tuple[TestClient, str]:
    client = TestClient(create_app(Settings(_env_file=None, **overrides)))
    sid = client.post("/api/session").json()["session_id"]
    return client, sid


def test_ファイル以外の送信も上限を超えたら_本文を処理せずに断る():
    client, sid = make(max_request_mb=1)
    big = json.dumps({"flow": {"flow_name": "x" * (1024 * 1024 + 10)}})
    res = client.post("/api/flows/validate", content=big, headers={"X-Session-Id": sid, "Content-Type": "application/json"})
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "REQUEST_TOO_LARGE"
    assert "上限 1MB" in res.json()["error"]["message"]


def test_上限以内の送信と_本文のない送信は_これまでどおり受け付ける():
    client, sid = make(max_request_mb=1)
    res = client.post("/api/flows/validate", json={"flow": {"flow_name": "架空の作業"}}, headers={"X-Session-Id": sid})
    assert res.status_code != 413
    assert client.post("/api/session").status_code == 201  # 本文がない


def test_大きさが分からない送信は受け付けない():
    client, sid = make()
    def chunks():
        yield b'{"flow": {}}'
    res = client.post("/api/flows/validate", content=chunks(), headers={"X-Session-Id": sid, "Content-Type": "application/json"})
    assert res.status_code == 411
    assert res.json()["error"]["code"] == "LENGTH_REQUIRED"


def test_ファイルの送信は_これまでどおりファイルの上限で確かめる():
    client, sid = make(max_request_mb=1, max_file_size_mb=2)
    data = b"a,b\n" + (b"x" * 38 + b",2\n") * 40_000  # 約1.6MB・4万行（JSONの上限1MBより大きく、ファイルの上限2MBより小さい）
    res = client.post("/api/files", files={"file": ("架空.csv", data)}, headers={"X-Session-Id": sid})
    assert res.status_code != 413, res.text


def test_応答にブラウザ向けの安全設定を付ける():
    client, _ = make()
    res = client.get("/api/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["Referrer-Policy"] == "no-referrer"
    # エラーの応答にも付く
    err = client.get("/api/session", headers={"X-Session-Id": "unknown-session-id"})
    assert err.headers["X-Content-Type-Options"] == "nosniff"


# ===== セッションの作り過ぎ（同じIPアドレスから同時に持てる数） =====

from app.sessions.store import SessionStore  # noqa: E402
from app.errors import AppError  # noqa: E402


def test_同じ所から同時に持てるセッションは上限まで_終えればまた作れる():
    client, first = make(max_sessions_per_ip=3)  # make で1つ作っている
    client.post("/api/session")
    client.post("/api/session")
    over = client.post("/api/session")
    assert over.status_code == 429
    body = over.json()["error"]
    assert body["code"] == "TOO_MANY_SESSIONS"
    assert "使っていないタブを閉じる" in body["how_to_fix"]
    # 1つ終えれば、また作れる
    assert client.delete("/api/session", headers={"X-Session-Id": first}).status_code == 204
    assert client.post("/api/session").status_code == 201


def test_別の所や_期限が切れたセッションは数えない():
    now = [0.0]
    store = SessionStore(ttl_seconds=60, max_sessions=100, clock=lambda: now[0], max_per_ip=2)
    store.create("192.0.2.1")
    store.create("192.0.2.1")
    store.create("198.51.100.7")  # 別の所からは作れる
    try:
        store.create("192.0.2.1")
        raise AssertionError("上限を超えて作れてしまった")
    except AppError as e:
        assert e.status_code == 429
    now[0] = 61  # 期限切れ
    store.create("192.0.2.1")  # 期限が切れたものは数えない
