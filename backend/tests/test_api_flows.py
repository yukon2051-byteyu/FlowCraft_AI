"""フローの検証・プレビュー・実行APIのテスト（タスク1-15）。

画面と同じ使い方で確認する：セッション作成 → ファイルをアップロード → フロー（JSON）と割当を送る。
"""

import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

FLOW = json.loads((Path(__file__).parent / "fixtures" / "flows" / "monthly_sales.json").read_text(encoding="utf-8"))

SALES_CSV = "売上日,部署コード,商品コード,数量,金額,備考\r\n2026/10/01,001,A-1,2,3000,\r\n2026/10/02,002,B-1,1,980,\r\n2026/10/03,001,B-1,3,2940,架空\r\n2026/10/04,002,A-1,1,1500,\r\n"
PRODUCTS_CSV = "商品コード,商品名\r\nA-1,ノートPC\r\nB-1,マウス\r\n"
DEPTS_CSV = "部署コード,部署名\r\n001,営業1部\r\n002,営業2部\r\n"


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def setup_session(client, sales=SALES_CSV, products=PRODUCTS_CSV):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    ids = {}
    for key, name, text in (("sales", "売上.csv", sales), ("products", "商品.csv", products), ("depts", "部署.csv", DEPTS_CSV)):
        res = client.post("/api/files", headers=h, files={"file": (name, text.encode("utf-8"))})
        assert res.status_code == 201, res.text
        ids[key] = res.json()["file_id"]
    bindings = [{"input_id": k, "file_id": v} for k, v in ids.items()]
    return h, bindings


# ===================== 検証 =====================


def test_validate_ok(client):
    body = client.post("/api/flows/validate", json={"flow": FLOW}).json()
    assert body["valid"] is True and body["executable"] is True
    assert body["schema_errors"] == [] and body["issues"] == []
    assert {"node_id": "n4", "depends_on": ["n2", "n3"]} in body["dependencies"]


def test_validate_schema_error_is_listed_not_rejected(client):
    flow = copy.deepcopy(FLOW)
    flow["nodes"][3]["node_type"] = "python_exec"
    res = client.post("/api/flows/validate", json={"flow": flow})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is False
    assert any("対応していない処理" in e["message"] for e in body["schema_errors"])


def test_validate_reports_unconfirmed_and_structure(client):
    flow = copy.deepcopy(FLOW)
    flow["nodes"][3]["confirmation_status"] = "ai_proposed"
    flow["nodes"][6]["input_references"] = ["no_such"]
    body = client.post("/api/flows/validate", json={"flow": flow}).json()
    assert body["valid"] is False and body["executable"] is False
    assert {i["code"] for i in body["issues"]} >= {"UNKNOWN_REFERENCE"}
    assert {(b["code"], b["node_id"]) for b in body["blockers"]} >= {("NODE_NOT_CONFIRMED", "n4"), ("UNKNOWN_REFERENCE", "n7")}


# ===================== プレビュー =====================


def test_preview_join_node_shows_inputs_and_output(client):
    h, bindings = setup_session(client)
    flow = copy.deepcopy(FLOW)
    flow["nodes"][3]["confirmation_status"] = "ai_proposed"  # 未確定でもプレビューはできる
    res = client.post("/api/flows/preview", headers=h, json={"flow": flow, "bindings": bindings, "node_id": "n4"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [i["reference"] for i in body["inputs"]] == ["sales_selected", "products"]
    assert body["inputs"][0]["total"] == 4
    out = body["output"]
    assert out["columns"] == ["売上日", "部署コード", "商品コード", "数量", "金額", "商品名"]
    assert out["types"][0] == "date" and out["types"][4] == "decimal"
    assert out["rows"][0] == ["2026/10/01", "001", "A-1", "2", "3000", "ノートPC"]
    node = body["node"]
    assert node["status"] == "ok" and node["input_rows"] == [4, 2] and node["output_rows"] == 4
    assert "AMOUNT_MATCHED" in {i["code"] for i in node["issues"]}
    assert body["stopped_at"] is None


def test_preview_limit(client):
    h, bindings = setup_session(client)
    body = client.post("/api/flows/preview", headers=h, json={"flow": FLOW, "bindings": bindings, "node_id": "n1", "limit": 2}).json()
    assert body["output"]["shown"] == 2 and body["output"]["total"] == 4


def test_preview_stops_at_failing_earlier_node(client):
    h, bindings = setup_session(client, sales=SALES_CSV.replace("2,3000", "二,3000"))
    body = client.post("/api/flows/preview", headers=h, json={"flow": FLOW, "bindings": bindings, "node_id": "n7"}).json()
    assert body["stopped_at"] == "n1"
    assert body["node"] is None and body["output"] is None


def test_preview_unknown_node_and_bad_flow(client):
    h, bindings = setup_session(client)
    res = client.post("/api/flows/preview", headers=h, json={"flow": FLOW, "bindings": bindings, "node_id": "zzz"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "NODE_NOT_FOUND"
    bad = copy.deepcopy(FLOW)
    bad["schema_version"] = "9.9"
    res = client.post("/api/flows/preview", headers=h, json={"flow": bad, "bindings": bindings, "node_id": "n1"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "FLOW_SCHEMA_INVALID"


def test_bindings_are_validated(client):
    h, bindings = setup_session(client)
    res = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": [*bindings, {"input_id": "nope", "file_id": "x"}]})
    assert res.status_code == 422 and res.json()["error"]["code"] == "UNKNOWN_INPUT"
    res = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": [*bindings, bindings[0]]})
    assert res.json()["error"]["code"] == "DUPLICATE_BINDING"


def test_preview_requires_session(client):
    assert client.post("/api/flows/preview", json={"flow": FLOW, "bindings": [], "node_id": "n1"}).status_code == 401


# ===================== 実行 =====================


def test_run_and_get_result(client):
    h, bindings = setup_session(client)
    run = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": bindings}).json()
    assert run["status"] == "success" and run["can_export"] is True
    assert [n["status"] for n in run["nodes"]] == ["ok"] * 9
    assert [o["sheet_name"] for o in run["outputs"]] == ["部署別売上", "商品別売上", "明細"]
    assert len(run["flow_hash"]) == 64 and run["fingerprints"]["by_dept"]

    detail = client.get(f"/api/runs/{run['run_id']}", headers=h).json()
    by_dept = next(p for p in detail["output_previews"] if p["reference"] == "by_dept")
    assert by_dept["rows"] == [["営業1部", "5940", "2"], ["営業2部", "2480", "2"]]

    # 同じフロー・同じファイルでもう一度実行すると、同じ指紋・同じフローの指紋になる
    again = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": bindings}).json()
    assert again["fingerprints"] == run["fingerprints"] and again["flow_hash"] == run["flow_hash"]
    assert again["run_id"] != run["run_id"]


def test_run_refuses_unconfirmed_flow(client):
    h, bindings = setup_session(client)
    flow = copy.deepcopy(FLOW)
    flow["nodes"][3]["confirmation_status"] = "pending"
    run = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings}).json()
    assert run["status"] == "failed" and run["can_export"] is False
    assert [i["code"] for i in run["flow_issues"]] == ["NODE_NOT_CONFIRMED"]
    assert all(n["status"] == "skipped" for n in run["nodes"])


def test_run_failure_details_reach_the_screen(client):
    h, bindings = setup_session(client, products=PRODUCTS_CSV + "A-1,ノートPC（旧）\r\n")
    run = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": bindings}).json()
    assert run["status"] == "failed" and not run["can_export"] and run["outputs"] == []
    failed = next(n for n in run["nodes"] if n["status"] == "error")
    issue = failed["issues"][-1]
    assert failed["node_id"] == "n4" and issue["code"] == "RELATIONSHIP_MISMATCH"
    assert issue["how_to_fix"] and issue["details"]["right_duplicates"] == [{"key": "A-1", "count": 2}]


def test_run_with_deleted_file(client):
    h, bindings = setup_session(client)
    client.delete(f"/api/files/{bindings[1]['file_id']}", headers=h)
    run = client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": bindings}).json()
    n3 = next(n for n in run["nodes"] if n["node_id"] == "n3")
    assert n3["issues"][-1]["code"] == "FILE_NOT_FOUND"


def test_runs_are_isolated_and_limited(client):
    h, bindings = setup_session(client)
    other = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    ids = [client.post("/api/runs", headers=h, json={"flow": FLOW, "bindings": bindings}).json()["run_id"] for _ in range(7)]
    assert client.get(f"/api/runs/{ids[-1]}", headers=other).status_code == 404  # 他のセッションからは見えない
    assert client.get(f"/api/runs/{ids[0]}", headers=h).status_code == 404  # 古い実行結果は削除（直近5回のみ保持）
    assert client.get(f"/api/runs/{ids[2]}", headers=h).status_code == 200


def test_files_of_other_session_cannot_be_used(client):
    _, bindings = setup_session(client)
    other = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    run = client.post("/api/runs", headers=other, json={"flow": FLOW, "bindings": bindings}).json()
    assert run["status"] == "failed"
    assert run["nodes"][0]["issues"][-1]["code"] == "FILE_NOT_FOUND"
