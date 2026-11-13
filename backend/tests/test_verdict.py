"""タスク2-3：総合判定（正常／注意／重大／未検証）と出力の制御のテスト。

判定の規則（docs/completion-criteria.md §6）を、実行の状態 × 完了基準の結果の組み合わせで確かめる。
重点：**未検証を正常と判定しない**、**重大のときは確定した結果を出力しない**。
"""

import copy
import io
import json
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.criteria.evaluate import CriterionResult
from app.criteria.verdict import decide
from app.engine.result import NodeRun, OutputSheet, RunResult
from app.main import create_app

# ===================== 規則（関数を直接） =====================


def crit(status, on_fail="critical", name="基準"):
    return CriterionResult(criterion_id="c", name=name, kind="row_count", on_fail=on_fail, status=status, summary="")


def result(status="success", node_status="ok", criteria=()):
    nodes = [NodeRun("n1", "load", "読み込む", "ok"), NodeRun("n2", "aggregate", "集計する", node_status)]
    r = RunResult(status=status, engine_version="t", nodes=nodes, outputs=[OutputSheet("結果", "r")])
    r.criteria = list(criteria)
    return r


# (実行の状態, ステップ2の状態, 基準の一覧) → (総合判定, 出力の扱い, 標準の確認のみか)
CASES = [
    # 業務の基準がない
    ("success", "ok", [], "normal", "allowed", True),
    ("warning", "warning", [], "caution", "needs_confirmation", True),
    ("failed", "error", [], "critical", "report_only", True),
    # 基準をすべて満たす
    ("success", "ok", [crit("passed"), crit("passed", "caution")], "normal", "allowed", False),
    ("warning", "warning", [crit("passed")], "caution", "needs_confirmation", False),  # 標準の確認の警告は残る
    # 満たしていない（重さで変わる）
    ("success", "ok", [crit("failed", "critical")], "critical", "report_only", False),
    ("success", "ok", [crit("failed", "caution")], "caution", "needs_confirmation", False),
    ("success", "ok", [crit("failed", "record")], "normal", "allowed", True),  # 記録のみは判定に使わない
    # 未検証：正常にしない
    ("success", "ok", [crit("unverified", "critical")], "unverified", "needs_confirmation", False),
    ("success", "ok", [crit("unverified", "caution")], "unverified", "needs_confirmation", False),
    ("success", "ok", [crit("passed"), crit("unverified", "caution")], "unverified", "needs_confirmation", False),
    ("success", "ok", [crit("unverified", "record")], "normal", "allowed", True),  # 記録のみの未検証は判定に使わない
    # 優先順位：重大 ＞ 未検証 ＞ 注意
    ("success", "ok", [crit("failed", "critical"), crit("unverified")], "critical", "report_only", False),
    ("success", "ok", [crit("unverified"), crit("failed", "caution")], "unverified", "needs_confirmation", False),
    ("warning", "warning", [crit("unverified")], "unverified", "needs_confirmation", False),
    ("failed", "error", [crit("unverified")], "critical", "report_only", False),  # 止まったら重大
    # 一覧にするだけの基準（recorded）
    ("success", "ok", [CriterionResult("c", "一覧", "list_rows", "record", "recorded", "")], "normal", "allowed", True),
]


@pytest.mark.parametrize(("status", "node_status", "criteria", "verdict", "export", "standard_only"), CASES)
def test_rules(status, node_status, criteria, verdict, export, standard_only):
    v = decide(result(status, node_status, criteria))
    assert (v.verdict, v.export, v.standard_only) == (verdict, export, standard_only)


def test_unverified_is_never_normal():
    """未検証の基準が1つでもあれば（記録のみを除く）、ほかがすべて満たしていても正常にしない"""
    for on_fail in ("critical", "caution"):
        many = [crit("passed")] * 10 + [crit("unverified", on_fail)]
        assert decide(result(criteria=many)).verdict != "normal"


def test_headlines_and_reasons():
    v = decide(result(criteria=[]))
    assert v.headline == "標準の確認で問題は見つかりませんでした（業務の完了基準は設定されていません）。"
    v = decide(result(criteria=[crit("passed"), crit("passed")]))
    assert v.headline == "完了基準（2件）をすべて満たしています。"
    assert v.counts == {"passed": 2, "failed": 0, "unverified": 0, "not_applicable": 0, "recorded": 0}
    v = decide(result(criteria=[crit("failed", name="部署は4つ"), crit("unverified", name="対象月の伝票だけ")]))
    assert v.reasons == ["重大とした完了基準を満たしていません：「部署は4つ」", "確かめられなかった完了基準があります：「対象月の伝票だけ」"]
    v = decide(result("failed", "error"))
    assert v.reasons[0] == "ステップ2「集計する」で処理が止まりました。"
    v = decide(result("warning", "warning"))
    assert "ステップ2「集計する」" in v.reasons[0]


def test_can_export_follows_verdict():
    r = result(criteria=[crit("failed", "critical")])
    r.verdict = decide(r)
    assert r.can_export is False  # 重大：確定した結果は出さない
    for crits in ([crit("failed", "caution")], [crit("unverified")], [crit("passed")]):
        r = result(criteria=crits)
        r.verdict = decide(r)
        assert r.can_export is True  # 注意・未検証は、確認したうえで出力できる（確認は出力のAPIで求める）


# ===================== API（実行 → 出力） =====================

DATA = Path(__file__).parent.parent / "app" / "demos" / "data"
FLOW = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "monthly_sales.json").read_text(encoding="utf-8"))


def flow_with(criteria):
    f = copy.deepcopy(FLOW)
    f["schema_version"] = "1.1"
    f["completion_criteria"] = {"version": 1, "items": criteria, "changelog": []}
    return f


ROWS_4 = {"criterion_id": "c_rows", "name": "部署は4つ", "kind": "row_count", "target": {"ref": "by_dept"}, "params": {"min": 4, "max": 4}, "on_fail": "critical"}


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def run(client, flow, sales="売上実績_2026-10.xlsx", mapping=None):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}

    def up(name):
        return client.post("/api/files", headers=h, files={"file": (name, (DATA / name).read_bytes())}).json()["file_id"]

    bindings = [
        {"input_id": "sales", "file_id": up(sales), "sheet": "売上", "column_mapping": mapping or {}},
        {"input_id": "products", "file_id": up("商品マスタ.xlsx"), "sheet": "商品"},
        {"input_id": "depts", "file_id": up("部署マスタ.csv")},
    ]
    body = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings}).json()
    return h, body


def sheets(res) -> list[str]:
    return openpyxl.load_workbook(io.BytesIO(res.content), read_only=True).sheetnames


def test_normal_exports_without_confirmation(client):
    h, body = run(client, flow_with([ROWS_4]))
    assert body["verdict"]["verdict"] == "normal" and body["verdict"]["export"] == "allowed"
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    assert res.status_code == 200
    assert "部署別売上" in sheets(res)
    assert "_%E7%B5%90%E6%9E%9C_" in res.headers["content-disposition"]  # 「結果」


def test_standard_only_is_not_called_complete(client):
    h, body = run(client, FLOW)
    assert body["verdict"]["standard_only"] is True
    assert "業務の完了基準は設定されていません" in body["verdict"]["headline"]


def test_caution_requires_confirmation_before_export(client):
    # 11月分：照合できない商品コードなど、標準の確認の警告がある
    h, body = run(client, FLOW, sales="売上実績_2026-11.xlsx", mapping={"金額": "売上金額"})
    assert body["verdict"]["verdict"] == "caution" and body["can_export"] is True
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "EXPORT_CONFIRMATION_REQUIRED"
    assert "照合" in (res.json()["error"]["cause"] or "") or "ステップ" in (res.json()["error"]["cause"] or "")
    res = client.get(f"/api/runs/{body['run_id']}/export?confirmed=true", headers=h)
    assert res.status_code == 200 and "部署別売上" in sheets(res)


def test_unverified_requires_confirmation(client):
    period = {"criterion_id": "c_p", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": {"$param": "m"}}, "on_fail": "critical"}
    f = flow_with([period])
    f["run_parameters"] = [{"param_id": "m", "label": "対象月", "type": "month"}]
    h, body = run(client, f)  # 対象月を入力しない
    assert body["verdict"]["verdict"] == "unverified"
    assert client.get(f"/api/runs/{body['run_id']}/export", headers=h).status_code == 409


def test_critical_criterion_blocks_result_sheets(client):
    five = {**ROWS_4, "params": {"min": 5}}
    h, body = run(client, flow_with([five]))
    assert body["status"] == "success"  # 処理は最後まで終わった
    assert body["verdict"]["verdict"] == "critical"  # しかし業務としては重大
    assert body["can_export"] is False
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    assert res.status_code == 200  # 調査用の確認結果は出せる
    names = sheets(res)
    assert "部署別売上" not in names and "確認結果" in names
    assert "%E8%AA%BF%E6%9F%BB%E7%94%A8" in res.headers["content-disposition"]  # 「調査用」
    ws = openpyxl.load_workbook(io.BytesIO(res.content), read_only=True)["確認結果"]
    flat = [str(v) for row in ws.iter_rows(values_only=True) for v in row if v is not None]
    assert "最後まで実行しましたが、総合判定が「重大」のため、処理結果は出力していません（調査用）。" in flat
    assert any(v.startswith("重大（完了基準と標準の確認）") for v in flat)
    assert "重大とした完了基準を満たしていません：「部署は4つ」" in flat


# ===================== 1枚レポート（Excelの確認結果シート。タスク2-5） =====================


def check_rows(res) -> list[list[str]]:
    ws = openpyxl.load_workbook(io.BytesIO(res.content), read_only=True)["確認結果"]
    return [[str(v) if v is not None else "" for v in row] for row in ws.iter_rows(values_only=True)]


def test_report_lists_criteria_with_evidence_in_importance_order(client):
    unverified = {"criterion_id": "c_p", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": {"$param": "m"}}, "on_fail": "critical"}
    caution = {**ROWS_4, "criterion_id": "c_5", "name": "部署は5つ", "params": {"min": 5}, "on_fail": "caution"}
    f = flow_with([ROWS_4, caution, unverified])
    f["run_parameters"] = [{"param_id": "m", "label": "対象月", "type": "month"}]
    h, body = run(client, f)
    assert body["verdict"]["verdict"] == "unverified"
    res = client.get(f"/api/runs/{body['run_id']}/export?confirmed=true", headers=h)
    rows = check_rows(res)
    start = next(i for i, r in enumerate(rows) if r[0] == "完了基準")
    assert rows[start][:8] == ["完了基準", "種類", "満たさないとき", "判定", "理由", "根拠", "対応", "該当する例"]
    table = rows[start + 1 : start + 4]
    # 重要な順：未検証 → 注意で満たさない → 満たしている
    assert [r[0] for r in table] == ["対象月の伝票だけ", "部署は5つ", "部署は4つ"]
    assert table[0][3] == "未検証" and "「対象月」が入力されていません" in table[0][4]
    assert table[1][3] == "満たしていない（注意）" and table[1][5] == "件数：4 ／ 範囲：5〜" and table[1][6]
    assert table[2][1:4] == ["件数が範囲内にある", "重大", "満たしている"]
    assert table[2][5] == "件数：4 ／ 範囲：4〜4" and table[2][6] == ""  # 満たしているものに対応は書かない


def test_report_without_criteria_has_no_criteria_table(client):
    h, body = run(client, FLOW)
    rows = check_rows(client.get(f"/api/runs/{body['run_id']}/export", headers=h))
    assert not any(r[0] == "完了基準" for r in rows)
    assert any(r[0] == "総合判定" and "標準の確認のみ" in r[1] for r in rows)
