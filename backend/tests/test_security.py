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
