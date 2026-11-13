"""品質MVP QM-2：前回比較（共通の関数）と、12種類目の基準「前回からの変化」。

デモの架空データ（月次売上集計）を実際の処理エンジンで実行し、過去の記録として渡して確かめる。
指示書 §15 の前回比較の8ケース：正常・前月なし・前月0・同じ月の再実行・定義の変更・大幅な減少・異常件数の増加・不適切な記録。
"""

import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.flow.validate import parse_flow
from app.main import create_app
from app.quality.compare import compare_with_history, previous_period, ref_fingerprint, select_baseline
from app.quality.models import MetricRecord, OfficialOutputRecord, RunRecord

FLOW_FILE = Path(__file__).parent.parent / "app" / "demos" / "flows" / "demo_monthly_sales.json"


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def flow_12(change: dict | None = None) -> dict:
    """デモの作業手順を 1.2 にし、必要なら「前回からの変化」の基準を足す"""
    flow = parse_flow(json.loads(FLOW_FILE.read_text(encoding="utf-8"))).model_dump(mode="json", by_alias=True, exclude_none=False)
    if change is not None:
        flow["completion_criteria"]["items"].append(
            {"criterion_id": "c9", "rule_id": "r-change", "name": "売上の件数の変化", "kind": "change_from_previous", "target": {"ref": "sales_selected"}, "on_fail": "caution", **change}
        )
    return flow


def run(client, flow, month, history=(), file="売上実績_2026-10.xlsx"):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    data = Path(__file__).parent.parent / "app" / "demos" / "data"

    def up(name):
        return client.post("/api/files", headers=h, files={"file": (name, (data / name).read_bytes())}).json()["file_id"]

    bindings = [
        {"input_id": "sales", "file_id": up(file), "sheet": "売上"},
        {"input_id": "products", "file_id": up("商品マスタ.xlsx"), "sheet": "商品"},
        {"input_id": "depts", "file_id": up("部署マスタ.csv")},
    ]
    res = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings, "run_parameters": {"target_month": month}, "history": list(history)})
    assert res.status_code == 200, res.text
    return res.json()


def exported(record: dict) -> dict:
    """画面で正式に出力した後の記録（performed を True にする）"""
    r = copy.deepcopy(record)
    r["official_output"]["performed"] = True
    return r


def crit(body, cid):
    return next(c for c in body["criteria"] if c["criterion_id"] == cid)


def row(body, metric_id):
    return next(r for r in body["comparison"]["rows"] if r["metric_id"] == metric_id)


# ===================== 12種類目の基準 =====================


def test_first_run_has_nothing_to_compare(client):
    """前月の記録なし：比べる相手がないことを理由つきで示す（対象外。判定には影響しない）"""
    body = run(client, flow_12({"params": {"measure": "rows", "max_decrease_pct": 30}}), "2026-10")
    c = crit(body, "c9")
    assert c["status"] == "not_applicable" and c["summary"] == "比較できる前月（2026年9月）の正式な出力の記録がありません。"
    assert body["verdict"]["verdict"] == "normal"
    assert body["comparison"]["business_reason"] == "比較できる前月（2026年9月）の正式な出力の記録がありません。"
    assert all(r["status"] == "not_comparable" for r in body["comparison"]["rows"])


def test_display_only_by_default_and_judged_only_with_a_threshold(client):
    """閾値なし＝数値を示すだけ（記録）。閾値を超えたら「変化を検出」（初期の重さは注意。重大にしない）"""
    prev = run(client, flow_12({"params": {"measure": "rows"}}), "2026-09")["record"]
    prev["period"] = "2026-09"
    history = [exported(prev)]
    # 11月分のファイル（行数が違う）を、前月（9月とみなした10月分の記録）と比べる
    shown = run(client, flow_12({"params": {"measure": "rows"}}), "2026-10", history)
    c = crit(shown, "c9")
    assert c["status"] == "recorded" and "判定には使いません" in c["summary"]
    assert c["evidence"]["前回（2026年9月）"] == c["evidence"]["今回"] and c["evidence"]["増減率"] == "+0.0%"

    # 減少に閾値を設定：同じ件数なら範囲の中
    judged = run(client, flow_12({"params": {"measure": "rows", "max_decrease_pct": 30}}), "2026-10", [exported(_as_period(prev, "2026-09", flow_12({"params": {"measure": "rows", "max_decrease_pct": 30}})))])
    assert crit(judged, "c9")["status"] == "passed"


def _as_period(record: dict, period: str, flow: dict) -> dict:
    r = copy.deepcopy(record)
    r["period"] = period
    return r


def test_large_decrease_is_detected_as_caution(client):
    """前月より件数が大きく減った：変化を検出（注意）。正式な出力は確認してから"""
    flow = flow_12({"params": {"measure": "rows", "max_decrease_pct": 30}})
    prev = exported(run(client, flow, "2026-09")["record"])
    # 前月の件数を多くした記録（例：1,200件）として渡す
    m = next(x for x in prev["metrics"] if x["metric_id"] == "rule:r-change")
    cur_rows = int(m["value"])
    m["value"] = str(int(cur_rows / 0.6))  # 今回は前月の約60%（40%減）
    body = run(client, flow, "2026-10", [prev])
    c = crit(body, "c9")
    assert c["status"] == "failed" and "設定した範囲を超える変化を検出しました" in c["summary"]
    assert c["evidence"]["増減率"].startswith("-") and body["verdict"]["verdict"] == "caution"
    assert body["record"]["official_output"]["mode"] == "needs_confirmation"


def test_previous_zero_has_no_rate(client):
    flow = flow_12({"params": {"measure": "rows", "max_increase_pct": 50}})
    prev = exported(run(client, flow, "2026-09")["record"])
    next(x for x in prev["metrics"] if x["metric_id"] == "rule:r-change")["value"] = "0"
    body = run(client, flow, "2026-10", [prev])
    c = crit(body, "c9")
    assert c["evidence"]["増減率"] == "—（前回が0のため計算しません）"
    assert c["status"] == "failed"  # 0件から増えた：増加の閾値を超えたとみなす
    assert row(body, "rule:r-change")["rate"] is None and row(body, "rule:r-change")["previous"] == "0"


def test_definition_change_upstream_blocks_but_downstream_change_does_not(client):
    """数値の定義（上流のステップ）が変わったら比べない。関係のない下流のステップの変更では止めない"""
    flow = flow_12({"params": {"measure": "rows"}})
    prev = exported(run(client, flow, "2026-09")["record"])
    # 下流（部署別の集計）の設定を変える：売上の件数（sales_selected）の定義は変わらない
    down = copy.deepcopy(flow)
    n7 = next(n for n in down["nodes"] if n["node_id"] == "n8")
    n7["node_name"] = "名前だけ変更"
    assert ref_fingerprint(parse_flow(down), "sales_selected") == ref_fingerprint(parse_flow(flow), "sales_selected")
    assert crit(run(client, down, "2026-10", [prev]), "c9")["status"] == "recorded"
    # 上流（列の選択）を変える：比較できない
    up = copy.deepcopy(flow)
    n2 = next(n for n in up["nodes"] if n["node_id"] == "n2")
    n2["parameters"]["columns"] = list(reversed(n2["parameters"]["columns"]))
    body = run(client, up, "2026-10", [prev])
    assert crit(body, "c9")["summary"] == "前回から集計条件が変更されたため、比較できません。"
    assert row(body, "rule:r-change")["reason"] == "前回から集計条件が変更されたため、比較できません。"


# ===================== 比べる相手の選び方 =====================


def test_quality_counts_compare_with_a_stopped_run_but_business_numbers_do_not(client):
    """品質異常の件数は、正式な出力が止まった前月とも比べる。業務の数値は、正式に出力した前月とだけ比べる"""
    flow = flow_12()
    prev = run(client, flow, "2026-09")["record"]  # 正式な出力はしていない（performed=False）
    # 対象月を11月にして実行すると、10月の伝票はすべて対象期間外になる（異常件数が増える）
    body = run(client, flow, "2026-10", [prev], file="売上実績_2026-10.xlsx")
    assert body["comparison"]["business_baseline"] is None
    assert body["comparison"]["quality_baseline"]["run_id"] == prev["run_id"]
    failed = row(body, "quality:failed_rules")
    assert failed["status"] == "compared"
    assert row(body, "input_rows:sales")["status"] == "not_comparable"


def test_anomaly_count_increase_is_shown(client):
    flow = flow_12()
    # 前月（10月分を10月として実行）は対象期間外が0件。今月（同じファイルを11月として実行）はすべて対象期間外
    prev = run(client, flow, "2026-10")["record"]
    rule = next(m for m in prev["metrics"] if m["metric_id"].startswith("anomaly:") and "対象月" in m["label"])
    assert rule["value"] == "0"
    body = run(client, flow, "2026-11", [prev])
    r = row(body, rule["metric_id"])
    assert r["status"] == "compared" and r["previous"] == "0" and r["diff"].startswith("+") and r["rate"] is None


def _rec(**kw) -> RunRecord:
    base = dict(
        run_id="r1",
        source="manual",
        executed_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        duration_ms=1,
        flow_id="F",
        flow_name="n",
        flow_version=1,
        flow_hash="h",
        criteria_version=1,
        period="2026-10",
        run_parameters={},
        inputs=[],
        outputs=[],
        processing_status="completed",
        steps=1,
        verdict="normal",
        verdict_headline=None,
        verdict_reasons=[],
        rules=[],
        official_output=OfficialOutputRecord(mode="allowed", performed=True),
        metrics=[MetricRecord(metric_id="m", label="件数", category="business", value="100", fingerprint="fp")],
    )
    base.update(kw)
    return RunRecord(**base)


def test_select_baseline_ignores_inappropriate_records():
    good = _rec(run_id="good")
    history = [
        good,
        _rec(run_id="other_flow", flow_id="G", executed_at=good.executed_at + timedelta(days=1)),
        _rec(run_id="failed", processing_status="failed", executed_at=good.executed_at + timedelta(days=1)),
        _rec(run_id="demo", source="demo", executed_at=good.executed_at + timedelta(days=1)),
        _rec(run_id="same_month", period="2026-11", executed_at=good.executed_at + timedelta(days=2)),
        _rec(run_id="two_months_ago", period="2026-09"),
        _rec(run_id="not_exported", official_output=OfficialOutputRecord(mode="allowed", performed=False), executed_at=good.executed_at + timedelta(days=1)),
    ]
    base, reason = select_baseline("F", "2026-11", history, "business")
    assert base.run_id == "good" and reason is None
    # 品質の件数は、正式に出力していない記録も相手にする（最新のもの）
    assert select_baseline("F", "2026-11", history, "quality")[0].run_id == "not_exported"
    # 前月がなければ、前々月には飛ばさない
    base, reason = select_baseline("F", "2026-11", [h for h in history if h.period != "2026-10"], "business")
    assert base is None and reason == "比較できる前月（2026年10月）の正式な出力の記録がありません。"
    # 対象期間が分からない
    assert select_baseline("F", None, history, "business") == (None, "対象期間（対象月）が分からないため、前回と比べていません。")
    # デモの記録は、デモどうしでだけ比べる
    assert select_baseline("F", "2026-11", history, "business", source="demo")[0].run_id == "demo"


def test_same_month_rerun_is_not_the_previous_one():
    """同じ11月分を何度もテストした記録は、11月分の前回にしない"""
    history = [_rec(run_id=f"nov{i}", period="2026-11") for i in range(3)]
    base, reason = select_baseline("F", "2026-11", history, "business")
    assert base is None and "2026年10月" in reason


def test_compare_rows_and_month_boundary():
    assert previous_period("2026-01") == "2025-12"
    cur = _rec(run_id="cur", period="2026-11", metrics=[MetricRecord(metric_id="m", label="件数", category="business", value="850", fingerprint="fp")])
    prev = _rec(run_id="prev", period="2026-10", metrics=[MetricRecord(metric_id="m", label="件数", category="business", value="1200", fingerprint="fp")])
    rep = compare_with_history(cur, [prev])
    (r,) = rep.rows
    assert (r.previous, r.current, r.diff, r.rate, r.status) == ("1,200", "850", "-350", "-29.2%", "compared")
    assert rep.business_baseline.run_id == "prev" and rep.previous_period == "2026-10"
    # 履歴の形が合わないものは使わない
    from app.quality.compare import parse_history

    assert parse_history([{"bad": 1}, prev.model_dump(mode="json")])[0].run_id == "prev"
