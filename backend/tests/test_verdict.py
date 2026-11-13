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
    # 未検証：正常にしない。重大とした基準（必須のルール）の未検証は、確認しても出力させない（U-1）
    ("success", "ok", [crit("unverified", "critical")], "unverified", "report_only", False),
    ("success", "ok", [crit("unverified", "caution")], "unverified", "needs_confirmation", False),
    ("success", "ok", [crit("passed"), crit("unverified", "caution")], "unverified", "needs_confirmation", False),
    ("success", "ok", [crit("unverified", "record")], "normal", "allowed", True),  # 記録のみの未検証は判定に使わない
    # 優先順位：重大 ＞ 未検証 ＞ 注意
    ("success", "ok", [crit("failed", "critical"), crit("unverified")], "critical", "report_only", False),
    ("success", "ok", [crit("unverified"), crit("failed", "caution")], "unverified", "report_only", False),
    ("success", "ok", [crit("unverified", "caution"), crit("failed", "caution")], "unverified", "needs_confirmation", False),
    ("warning", "warning", [crit("unverified")], "unverified", "report_only", False),
    ("warning", "warning", [crit("unverified", "caution")], "unverified", "needs_confirmation", False),
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
    for crits in ([crit("failed", "caution")], [crit("unverified", "caution")], [crit("passed")]):
        r = result(criteria=crits)
        r.verdict = decide(r)
        assert r.can_export is True  # 注意・未検証（注意とした基準）は、確認したうえで出力できる（確認は出力のAPIで求める）
    r = result(criteria=[crit("unverified", "critical")])
    r.verdict = decide(r)
    assert r.can_export is False  # 重大とした基準の未検証：確認しても確定した結果は出さない（U-1）


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


def test_unverified_caution_rule_requires_confirmation(client):
    period = {"criterion_id": "c_p", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": {"$param": "m"}}, "on_fail": "caution"}
    f = flow_with([period])
    f["run_parameters"] = [{"param_id": "m", "label": "対象月", "type": "month"}]
    h, body = run(client, f)  # 対象月を入力しない
    assert body["verdict"]["verdict"] == "unverified" and body["verdict"]["export"] == "needs_confirmation"
    assert client.get(f"/api/runs/{body['run_id']}/export", headers=h).status_code == 409
    res = client.get(f"/api/runs/{body['run_id']}/export?confirmed=true", headers=h)
    assert res.status_code == 200 and "部署別売上" in sheets(res)


def test_unverified_critical_rule_stops_official_output_even_if_confirmed(client):
    """重大とした基準（必須のルール）が確かめられなかった：確認のチェックを入れても、正式な結果は出さない（U-1）"""
    period = {"criterion_id": "c_p", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": {"$param": "m"}}, "on_fail": "critical"}
    f = flow_with([period])
    f["run_parameters"] = [{"param_id": "m", "label": "対象月", "type": "month"}]
    h, body = run(client, f)  # 対象月を入力しない
    assert body["verdict"]["verdict"] == "unverified" and body["verdict"]["export"] == "report_only"
    assert body["can_export"] is False
    assert body["record"]["official_output"]["stop_reason"].startswith("処理は完了しましたが、重大とした完了基準を確かめられなかったため")
    res = client.get(f"/api/runs/{body['run_id']}/export?confirmed=true", headers=h)
    assert res.status_code == 200
    assert "部署別売上" not in sheets(res) and "%E8%AA%BF%E6%9F%BB%E7%94%A8" in res.headers["content-disposition"]  # 調査用だけ


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
    rows = check_rows(res)
    first = {r[0]: r[1] for r in rows if r[0]}
    assert any(r[0] == "総合判定：重大" for r in rows)
    # 処理と検証は完了しているが、正式な集計結果は出力していない（2つを分けて示す）
    assert first["処理・検証"].startswith("完了")
    assert first["正式な集計結果"].startswith("出力停止（重大な問題があるため")
    assert first["判定の根拠"] == "完了基準 1件 と、処理の中で自動で行う確認（標準の確認）"
    assert any(r[1] == "・重大とした完了基準を満たしていません：「部署は4つ」" for r in rows)


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
    # 第2階層：確認すべき問題（重要な順：未検証 → 注意で満たさない → 満たしている）
    start = next(i for i, r in enumerate(rows) if r[0] == "重要度")
    assert rows[start][:5] == ["重要度", "確認項目", "結果", "問題件数", "対応の要点"]
    table = [r for r in rows[start + 1 :] if r[0] in ("重大", "未検証", "注意", "正常", "記録のみ")][:3]
    assert [r[1] for r in table] == ["対象月の伝票だけ", "部署は5つ", "部署は4つ"]
    assert table[0][0] == "未検証" and table[0][2] == "確かめられませんでした"
    assert table[1][0] == "注意" and table[1][2] == "4件" and table[1][4]
    assert table[2][0] == "正常" and table[2][4] == "対応不要"
    # 第3階層：完了基準の詳細（判定理由・根拠の値・推奨対応）。満たしているものに推奨対応は書かない
    detail = next(i for i, r in enumerate(rows) if r[1] == "部署は5つ　―　満たしていない")
    block = rows[detail : detail + 8]
    labels = {r[0]: r for r in block if r[0]}
    assert labels["判定理由"][1] == "件数が4件で、範囲（5〜）の外です。"
    assert [(r[1], r[3]) for r in block if r[1] in ("件数", "範囲")] == [("件数", "4"), ("範囲", "5〜")]
    assert "推奨対応" in labels
    ok = next(i for i, r in enumerate(rows) if r[1] == "部署は4つ　―　満たしている")
    assert not any(r[0] == "推奨対応" for r in rows[ok : ok + 6])
    unv = next(i for i, r in enumerate(rows) if r[1] == "対象月の伝票だけ　―　未検証")
    assert "「対象月」が入力されていません" in rows[unv + 2][1]


def test_report_without_criteria_has_no_criteria_table(client):
    h, body = run(client, FLOW)
    rows = check_rows(client.get(f"/api/runs/{body['run_id']}/export", headers=h))
    assert not any(str(r[0]).startswith("2. 完了基準の詳細") for r in rows)
    assert any(r[0] == "判定の根拠" and r[1].startswith("標準の確認のみ") for r in rows)
