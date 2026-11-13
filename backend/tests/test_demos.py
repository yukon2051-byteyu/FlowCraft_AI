"""M1-1：デモの一覧と開始。デモのデータを実際の処理エンジンで実行し、意図した結果になることを確かめる。

- 正常終了：完了基準をすべて満たし「正常」。合計は正解値（manifest）と一致
- 品質異常：仕込んだ原因（対象期間外の伝票の混入）だけで「重大」。件数・行・日付は manifest と一致
  ほかの基準（合計の一致・照合・部署の数）は満たしている（＝原因を1つに絞ったデータになっている）
- 判定は実際の評価から出る（デモのために判定を作り込んでいない）
"""

import io
import json
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

MANIFEST = json.loads((Path(__file__).parent.parent / "app" / "demos" / "data" / "manifest.json").read_text(encoding="utf-8"))
DEMO = MANIFEST["demo_monthly_sales"]
PM = MANIFEST["demo_product_match"]
INV = MANIFEST["demo_inventory"]


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def session(client):
    return {"X-Session-Id": client.post("/api/session").json()["session_id"]}


def start_and_run(client, h, pattern, demo="monthly_sales"):
    started = client.post(f"/api/demos/{demo}/start", headers=h, json={"pattern": pattern})
    assert started.status_code == 200, started.text
    s = started.json()
    run = client.post("/api/runs", headers=h, json={"flow": s["flow"], "bindings": s["bindings"], "run_parameters": s["run_parameters"]})
    assert run.status_code == 200, run.text
    body = run.json()
    return s, body, {c["criterion_id"]: c for c in body["criteria"]}


def test_list_demos(client):
    demos = client.get("/api/demos").json()
    assert [d["demo_id"] for d in demos] == ["monthly_sales", "product_match", "inventory"]
    assert [d["available"] for d in demos] == [True, True, True]
    assert demos[0]["patterns"]["ok"]["label"] == "正常終了" and demos[0]["patterns"]["ng"]["label"] == "品質異常"


def test_ok_pattern_is_normal(client):
    h = session(client)
    s, body, c = start_and_run(client, h, "ok")
    assert s["pattern_label"] == "正常終了" and s["run_parameters"] == {"target_month": "2026-10"}
    assert body["verdict"]["verdict"] == "normal" and body["verdict"]["standard_only"] is False
    assert all(x["status"] == "passed" for x in c.values())
    assert c["c2"]["evidence"]["差額"] == "0"
    assert f"{MANIFEST['expected']['2026-10']['total_amount']:,}" in c["c2"]["summary"]
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    assert res.status_code == 200 and "部署別売上" in openpyxl.load_workbook(io.BytesIO(res.content), read_only=True).sheetnames


def test_ng_pattern_detects_only_the_planted_cause(client):
    h = session(client)
    s, body, c = start_and_run(client, h, "ng")
    assert s["pattern_label"] == "品質異常"
    assert body["status"] == "success"  # 処理は最後まで終わる
    assert body["verdict"]["verdict"] == "critical" and body["can_export"] is False  # しかし業務としては重大
    # 原因は「対象期間外」だけ
    assert c["c1"]["status"] == "failed"
    assert c["c1"]["evidence"]["期間外の件数"] == str(len(DEMO["out_of_period_rows"]))
    assert [e["結果の行"] for e in c["c1"]["examples"]] == [r - 1 for r in DEMO["out_of_period_rows"]]
    assert sorted(e["日付"] for e in c["c1"]["examples"]) == DEMO["out_of_period_dates"]
    assert {k: v["status"] for k, v in c.items() if k != "c1"} == {"c2": "passed", "c3": "passed", "c4": "passed"}
    # 金額は失われていない（混入した伝票の分だけ合計が多い）＝合計の一致だけでは気づけない
    assert f"{DEMO['ng_total_amount']:,}" in c["c2"]["summary"]
    # 調査用の確認結果は出力できる
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    assert res.status_code == 200 and openpyxl.load_workbook(io.BytesIO(res.content), read_only=True).sheetnames == ["確認結果", "処理の記録"]


def test_restart_replaces_demo_files_but_keeps_users_own_files(client):
    h = session(client)
    own = client.post("/api/files", headers=h, files={"file": ("自分の表.csv", "a,b\r\n1,2\r\n".encode())}).json()["file_id"]
    start_and_run(client, h, "ok")
    start_and_run(client, h, "ng")
    files = client.get("/api/files", headers=h).json()
    names = sorted(f["filename"] for f in files)
    assert names == sorted(["自分の表.csv", "デモ_月次売上_期間外あり.xlsx", "商品マスタ.xlsx", "部署マスタ.csv"])
    assert any(f["file_id"] == own for f in files)


def test_too_many_files_and_unknown_demo(client):
    h = session(client)
    for i in range(3):
        client.post("/api/files", headers=h, files={"file": (f"表{i}.csv", "a\r\n1\r\n".encode())})
    res = client.post("/api/demos/monthly_sales/start", headers=h, json={"pattern": "ok"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "TOO_MANY_FILES_FOR_DEMO"
    assert client.post("/api/demos/nothing/start", headers=h, json={"pattern": "ok"}).status_code == 404
    assert client.post("/api/demos/monthly_sales/start", headers=h, json={"pattern": "bad"}).status_code == 422


def test_same_result_every_time(client):
    """何度実行しても同じ条件で再現できる"""
    results = []
    for _ in range(2):
        h = session(client)
        _, body, c = start_and_run(client, h, "ng")
        results.append((body["verdict"]["verdict"], {k: (v["status"], v["evidence"]) for k, v in c.items()}, body["fingerprints"]))
    assert results[0] == results[1]


# ===================== M1-2：商品マスタ照合・在庫差異検出 =====================


@pytest.mark.parametrize("demo", ["product_match", "inventory"])
def test_other_demos_ok_is_normal(client, demo):
    h = session(client)
    _, body, c = start_and_run(client, h, "ok", demo)
    assert body["verdict"]["verdict"] == "normal", body["verdict"]
    assert all(x["status"] in ("passed", "recorded") for x in c.values())


def test_product_match_ng_breaks_down_causes(client):
    h = session(client)
    _, body, c = start_and_run(client, h, "ng", "product_match")
    assert body["verdict"]["verdict"] == "critical"
    rows = PM["unmatched_rows"]
    ev = c["c1"]["evidence"]
    assert c["c1"]["status"] == "failed"
    assert ev["照合できない行"] == str(sum(len(v) for v in rows.values()))
    assert ev["原因：前後の空白（取り除けば一致）"] == f"{len(rows['trailing_space'])}行"
    assert ev["原因：全角・半角の違い（そろえれば一致）"] == f"{len(rows['full_width'])}行"
    assert ev["原因：相手の表（マスタ）にない値"] == f"{len(rows['unknown'])}行"
    # 原因は照合だけ。金額は失われていない（左結合で行は残る）
    assert {k: v["status"] for k, v in c.items() if k != "c1"} == {"c2": "passed", "c3": "passed"}
    assert f"{PM['total_amount']:,}" in c["c2"]["summary"]


def test_inventory_ng_detects_double_counting(client):
    h = session(client)
    _, ok_body, ok_c = start_and_run(client, h, "ok", "inventory")
    h2 = session(client)
    _, body, c = start_and_run(client, h2, "ng", "inventory")
    assert body["verdict"]["verdict"] == "critical" and body["can_export"] is False
    assert c["c1"]["status"] == "failed"
    assert c["c1"]["evidence"]["重複したキー"] == f"{len(INV['duplicated_slips'])}種類"
    assert {e["キー"] for e in c["c1"]["examples"]} == set(INV["duplicated_slips"])
    assert {k: v["status"] for k, v in c.items() if k != "c1"} == {"c2": "passed", "c3": "passed", "c4": "recorded"}
    # 差異の一覧（記録）：正常は実際の棚卸差異の商品、二重計上では差異が増える（＝二重計上が在庫の計算を狂わせる）
    assert ok_c["c4"]["evidence"]["該当件数"] == str(len(INV["ok_gap_products"]))
    assert c["c4"]["evidence"]["該当件数"] == str(len(INV["ng_gap_products"]))
    gaps = {e["商品コード"]: e for e in ok_c["c4"]["examples"]}
    assert set(gaps) == set(INV["genuine_gaps"])
