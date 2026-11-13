"""業務改善診断デモ Phase 4：利用者の判断から、改善後の作業手順を作る。

指示書の受入条件：
  5 採用した改善案に応じて改善後の手順が変わる   6 採用しなかった改善案は勝手に反映されない
  4 廃止候補は必要性の確認なしに採用されない     7 改善後の手順が既存の処理エンジンで実行できる
  8 品質検証ルール（合計の一致）が引き継がれる
"""

import itertools
import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.demos.catalog import DATA_DIR
from app.flow.validate import criteria_issues, parse_flow, validate_structure
from app.kaizen.build import DecisionIn, build_improvement, decision_problems
from app.kaizen.diagnose import diagnose
from app.kaizen.scenarios import load_scenario, read_file_facts
from app.main import create_app

MANIFEST = json.loads((DATA_DIR / "kaizen_manifest.json").read_text(encoding="utf-8"))
SC = load_scenario("monthly_report")
FACTS = read_file_facts(SC)
DIAG = diagnose(SC, FACTS)


def dec(a="adopt", b="adopt", c="adopt", d="adopt", confirm="none"):
    return {"A": DecisionIn(status=a, confirm=confirm), "B": DecisionIn(status=b), "C": DecisionIn(status=c), "D": DecisionIn(status=d)}


def build(**kw):
    return build_improvement(SC, FACTS, DIAG, dec(**kw))


def node_types(flow):
    return [n["node_type"] for n in flow["nodes"]]


# 判断の組み合わせ（簡素化は標準化が前提）
COMBOS = [
    (a, b, c, d)
    for a, b, c, d in itertools.product(["adopt", "hold", "reject"], ["adopt", "reject"], ["adopt", "reject"], ["adopt", "reject"])
    if not (b == "adopt" and c != "adopt")
]


def test_すべて採用_5工程20分_処理は読み込み_そろえる_まとめる_集計_出力():
    r = build()
    assert [s.name for s in r.after_steps] == [
        "各部署のExcelを受け取り、読み込む",
        "共通ルールでデータを整える（列名をそろえる）",
        "部署別に売上を集計する",
        "元データとの合計一致を検証する",
        "集計結果をExcelに出力し、共有する",
    ]
    assert (r.minutes_before, r.minutes_after) == (90, 20)
    assert node_types(r.flow) == ["load", "load", "rename_columns", "load", "rename_columns", "concat", "aggregate", "output"]
    assert r.unsupported == ["工程7「完成した報告資料を共有する」"]
    assert r.ai_used is False


@pytest.mark.parametrize("combo", COMBOS)
def test_どの判断でも作業手順は検証を通り_合計の一致は残る(combo):
    a, b, c, d = combo
    r = build(a=a, b=b, c=c, d=d)
    assert r.kept_rules == ["元データとの合計一致（必ず残す）"]
    if d != "adopt":
        assert r.flow is None and "作りません" in r.flow_note
        return
    flow = parse_flow(r.flow)
    assert [i.message for i in validate_structure(flow) + criteria_issues(flow) if i.severity == "error"] == []
    totals = [x for x in flow.completion_criteria.items if x.kind == "total_match"]
    assert totals and all(x.on_fail == "critical" for x in totals)
    assert any(s.name == "元データとの合計一致を検証する" for s in r.after_steps)


def test_廃止を採用しないと_会議資料への転記は手作業として残る():
    adopted, rejected, held = build(), build(a="reject"), build(a="hold")
    assert not any("会議用資料" in s.name for s in adopted.after_steps)
    for r, word in ((rejected, "採用しなかった"), (held, "保留した")):
        s = next(s for s in r.after_steps if s.name == "同じ集計結果を会議用資料に転記する")
        assert s.mode == "manual" and s.minutes == 15 and word in s.note and "手作業のまま" in s.note
        assert r.minutes_after == 35
        assert "工程5「同じ集計結果を会議用資料に転記する」" in r.unsupported


def test_簡素化を採用しないと_部署ごとに集計し_合計の一致も部署ごと():
    r = build(b="reject")
    assert node_types(r.flow).count("aggregate") == 3 and "concat" not in node_types(r.flow)
    names = [c["name"] for c in r.flow["completion_criteria"]["items"] if c["kind"] == "total_match"]
    assert names == ["営業1部：集計前後の売上金額が一致", "営業2部：集計前後の売上金額が一致", "法人営業部：集計前後の売上金額が一致"]
    assert [s["sheet_name"] for s in r.flow["nodes"][-1]["parameters"]["sheets"]] == ["営業1部の集計", "営業2部の集計", "法人営業部の集計"]


def test_標準化を採用しないと_列名をそろえず_部署ごとの列名で集計する():
    r = build(b="reject", c="reject")
    assert "rename_columns" not in node_types(r.flow)
    aggs = [n for n in r.flow["nodes"] if n["node_type"] == "aggregate"]
    assert [a["parameters"]["aggregations"][0]["column"] for a in aggs] == ["売上金額", "金額", "売上額"]
    periods = [c["target"]["column"] for c in r.flow["completion_criteria"]["items"] if c["kind"] == "period"]
    assert periods == ["売上日", "日付", "売上日"]


def test_標準化の処理は_実際の列名の違いをそのまま反映する():
    r = build()
    renames = [n["parameters"]["renames"] for n in r.flow["nodes"] if n["node_type"] == "rename_columns"]
    assert renames == [
        [{"source": "日付", "target": "売上日"}, {"source": "伝票No", "target": "伝票番号"}, {"source": "金額", "target": "売上金額"}],
        [{"source": "商品CD", "target": "商品コード"}, {"source": "売上額", "target": "売上金額"}],
    ]


def test_自動化を採用しないと_作業手順は作らず_手作業の流れだけを見直す():
    r = build(d="reject")
    assert r.flow is None
    names = [s.name for s in r.after_steps]
    assert "同じ集計結果を会議用資料に転記する" not in names  # 廃止は採用している
    assert "部署別の売上を個別に集計する（3部署分を1つの表にまとめて1回で）" in names
    assert all(s.mode == "manual" for s in r.after_steps)


def test_改善後の作業手順は新しい作業手順_判断と理由を説明に残す():
    d = dec(a="reject")
    d["A"].reason = "監査で必要"
    r1 = build_improvement(SC, FACTS, DIAG, d)
    r2 = build()
    assert r1.flow["flow_id"] != r2.flow["flow_id"] and r1.flow["flow_version"] == 1
    assert r1.flow["flow_name"] == "月次報告資料の作成（改善後）"
    assert "反映していない：候補A「会議用資料への重複転記を廃止」＝採用しない（理由：監査で必要）" in r1.flow["description"]
    assert "AIは不使用" in r1.flow["description"]


def test_変化の一覧は_採用と不採用の違いを示す():
    texts = [c.text for c in build(a="reject", b="reject").changes]
    assert texts[0] == "候補A（採用しない）：工程5は手作業のまま残しました"
    assert texts[1] == "候補B（採用しない）：部署ごとに集計します"
    assert texts[2] == "候補C（採用）：列名を共通の列名にそろえる処理を入れました"


@pytest.mark.parametrize(
    ("decisions", "message"),
    [
        (lambda: {k: v for k, v in dec().items() if k != "D"}, "まだ判断していない候補があります（候補D）"),
        (lambda: dec(confirm="unknown"), "候補A：確認の問いに「要件はない」と答えたときだけ採用できます"),
        (lambda: dec(confirm=None), "候補A：確認の問いに"),
        (lambda: dec(c="hold"), "候補B：前提の候補Cを採用すると選べます"),
        (lambda: {**dec(), "Z": DecisionIn(status="adopt")}, "知らない候補があります（Z）"),
    ],
)
def test_判断の誤りはサーバーでも確かめる(decisions, message):
    assert any(message in p for p in decision_problems(DIAG, decisions()))


# ---------------------------------------------------------------- API・実行


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def payload(**kw):
    return {"decisions": {k: v.model_dump() for k, v in dec(**kw).items()}}


def run(client, flow):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    started = client.post("/api/kaizen/scenarios/monthly_report/start", headers=h)
    assert started.status_code == 200, started.text
    s = started.json()
    res = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": s["bindings"], "run_parameters": s["run_parameters"]})
    assert res.status_code == 200, res.text
    return res.json()


def test_API_確認なしの廃止は_作業手順を作らない(client):
    res = client.post("/api/kaizen/scenarios/monthly_report/build", json=payload(confirm="exists"))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "KAIZEN_DECISIONS_INVALID"
    assert "要件はない" in res.json()["error"]["cause"]


def test_API_すべて採用した作業手順を既存のエンジンで実行し_合計が正解値と一致(client):
    imp = client.post("/api/kaizen/scenarios/monthly_report/build", json=payload()).json()
    body = run(client, imp["flow"])
    assert body["status"] == "success"
    assert body["verdict"]["verdict"] == "normal" and body["can_export"] is True
    crit = {c["criterion_id"]: c for c in body["criteria"]}
    assert crit["c_total"]["status"] == "passed"
    assert f"{MANIFEST['total']['amount_total']:,}" in crit["c_total"]["summary"]
    assert crit["c_depts"]["status"] == "passed"


def test_API_部署ごとに集計する作業手順も実行でき_部署ごとの合計が正解値と一致(client):
    imp = client.post("/api/kaizen/scenarios/monthly_report/build", json=payload(b="reject", c="reject")).json()
    body = run(client, imp["flow"])
    assert body["verdict"]["verdict"] == "normal"
    crit = {c["criterion_id"]: c for c in body["criteria"]}
    for i, f in enumerate(MANIFEST["files"].values(), 1):
        assert crit[f"c_total{i}"]["status"] == "passed"
        assert f"{f['amount_total']:,}" in crit[f"c_total{i}"]["summary"]


def test_API_開始し直すと_前のデモのファイルは入れ替わる(client):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    first = client.post("/api/kaizen/scenarios/monthly_report/start", headers=h).json()
    second = client.post("/api/kaizen/scenarios/monthly_report/start", headers=h).json()
    files = client.get("/api/files", headers=h).json()
    assert len(files) == 3
    assert {b["file_id"] for b in first["bindings"]}.isdisjoint({b["file_id"] for b in second["bindings"]})
