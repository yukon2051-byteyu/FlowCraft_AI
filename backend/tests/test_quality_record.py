"""品質MVP QM-1：実行の記録（品質の履歴1件）と、正式な出力の判定（共通基盤）。

デモの架空データを、実際の処理エンジンで実行して確かめる。
- どのデータ：入力ファイルの SHA-256（読み込んだバイト列から計算）・件数・シート
- どの版のルール：ルールごとの識別・版・設定の写し。あとで作業手順を変えても、作った記録は変わらない
- 処理の状態と品質の判定を分けて残す（処理は完了・判定は重大、がありうる）
- 正式な出力の判定は1つの関数（画面の出力 API と同じ結論）
"""

import copy
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.criteria.verdict import VerdictResult
from app.engine.result import OutputSheet, RunResult
from app.main import create_app
from app.quality.output import decide_output
from app.quality.record import RunRecord, anomaly_count

DATA = Path(__file__).parent.parent / "app" / "demos" / "data"
MANIFEST = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def run_demo(client, pattern, demo="monthly_sales"):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    s = client.post(f"/api/demos/{demo}/start", headers=h, json={"pattern": pattern}).json()
    res = client.post("/api/runs", headers=h, json={"flow": s["flow"], "bindings": s["bindings"], "run_parameters": s["run_parameters"]})
    assert res.status_code == 200, res.text
    return h, s, res.json()


def test_record_identifies_data_rules_and_period(client):
    h, s, body = run_demo(client, "ok")
    rec = RunRecord.model_validate(body["record"])
    assert rec.run_id == body["run_id"] and rec.source == "manual" and rec.record_version == 1
    assert rec.flow_id == s["flow"]["flow_id"] and rec.flow_version == s["flow"]["flow_version"] and rec.flow_hash == body["flow_hash"]
    assert rec.period == "2026-10" and rec.run_parameters == {"target_month": "2026-10"}

    # どのデータ：読み込んだファイルの中身から計算した SHA-256 と、読み込んだ件数
    sales = next(i for i in rec.inputs if i.input_id == "sales")
    assert sales.filename == "売上実績_2026-10.xlsx" and sales.sheet == "売上"
    assert sales.sha256 == hashlib.sha256((DATA / "売上実績_2026-10.xlsx").read_bytes()).hexdigest()
    assert sales.rows is not None and sales.rows > 0
    assert all(i.sha256 and len(i.sha256) == 64 for i in rec.inputs)

    # どの版のルール：1.1 の作業手順でも、ルールの識別を毎回同じ規則で補い、設定の写しを残す
    by_id = {c["criterion_id"]: c for c in s["flow"]["completion_criteria"]["items"]}
    for r in rec.rules:
        assert r.rule_id == f"{rec.flow_id}:{r.criterion_id}" and r.rule_version == 1 and r.copied_from is None
        src = by_id[r.criterion_id]
        # 写しは省略された項目も初期値で補った完全な形（例：対象の列が空）
        assert {k: r.snapshot[k] for k in ("criterion_id", "kind", "on_fail")} == {k: src[k] for k in ("criterion_id", "kind", "on_fail")}
        assert r.snapshot["target"]["ref"] == src["target"]["ref"] and r.snapshot["rule_id"] == r.rule_id

    # 出力と判定
    assert rec.processing_status == "completed" and rec.verdict == "normal"
    assert rec.official_output.mode == "allowed" and rec.official_output.stop_reason is None and rec.official_output.performed is False
    assert [o.reference for o in rec.outputs] == [o["reference"] for o in body["outputs"]]
    assert all(o.rows is not None and o.fingerprint == body["fingerprints"][o.reference] for o in rec.outputs)


def test_critical_run_is_completed_but_official_output_stopped(client):
    """処理は最後まで終わった（完了）が、品質の判定は重大で、正式な出力を止めた。「処理の失敗」とは記録しない"""
    _, _, body = run_demo(client, "ng")
    rec = RunRecord.model_validate(body["record"])
    assert rec.processing_status == "completed" and rec.verdict == "critical"
    assert rec.official_output.mode == "report_only"
    assert rec.official_output.stop_reason.startswith("処理は完了しましたが、重大な品質異常を検出したため、正式な結果の出力を停止しました。")
    period = next(r for r in rec.rules if r.kind == "period")
    assert period.status == "failed" and period.anomaly_count == len(MANIFEST["demo_monthly_sales"]["out_of_period_rows"])
    assert len(period.examples) <= 5


def test_anomaly_counts_by_kind(client):
    _, _, body = run_demo(client, "ng", "inventory")
    rec = RunRecord.model_validate(body["record"])
    dup = next(r for r in rec.rules if r.kind == "unique")
    assert dup.status == "failed" and dup.anomaly_count is not None and dup.anomaly_count > 0
    # 件数で表せない種類（合計の一致など）は None
    assert all(r.anomaly_count is None for r in rec.rules if r.kind in ("total_match", "row_count", "expected_value"))
    assert anomaly_count("period", {"期間外の件数": "1,234"}) == 1234
    assert anomaly_count("period", {}) is None and anomaly_count("total_match", {"差額": "0"}) is None


def test_record_does_not_change_when_the_flow_changes_later(client):
    """記録には実行した時点のルールの写しが入る。あとで作業手順（の dict）を変えても、作った記録は変わらない"""
    h, s, body = run_demo(client, "ok")
    before = copy.deepcopy(body["record"])
    flow = s["flow"]
    flow["completion_criteria"]["items"][0]["on_fail"] = "record"
    flow["flow_name"] = "名前を変えた"
    assert body["record"] == before
    # 同じ作業手順を実行し直すと、別の実行IDの記録になる
    again = client.post("/api/runs", headers=h, json={"flow": s["flow"], "bindings": s["bindings"], "run_parameters": s["run_parameters"]}).json()
    assert again["record"]["run_id"] != body["record"]["run_id"]
    assert again["record"]["rules"][0]["snapshot"]["on_fail"] == "record" and before["rules"][0]["snapshot"]["on_fail"] != "record"


def test_record_contains_no_full_business_data(client):
    """記録は小さく、業務データの表そのものを含まない（根拠の例は最大5件）"""
    _, _, body = run_demo(client, "ng", "product_match")
    text = json.dumps(body["record"], ensure_ascii=False)
    assert len(text.encode()) < 60_000
    assert all(isinstance(o["rows"], int) for o in body["record"]["outputs"])


# ===================== 正式な出力の判定（共通の関数） =====================


def _result(status="success", verdict=None, export="allowed", outputs=True):
    v = None if verdict is None else VerdictResult(verdict=verdict, standard_only=False, headline="h", reasons=["理由1", "理由2"], export=export)
    return RunResult(status=status, engine_version="0", nodes=[], outputs=[OutputSheet("結果", "out")] if outputs else [], verdict=v)


@pytest.mark.parametrize(
    ("result", "confirmed", "expected"),
    [
        (_result(verdict="normal"), False, ("allowed", True, False)),
        (_result(verdict="caution", export="needs_confirmation"), False, ("needs_confirmation", False, True)),
        (_result(verdict="caution", export="needs_confirmation"), True, ("needs_confirmation", True, False)),
        (_result(verdict="unverified", export="needs_confirmation"), False, ("needs_confirmation", False, True)),
        (_result(verdict="critical", export="report_only"), True, ("report_only", False, False)),
        (_result(status="failed", verdict="critical", export="report_only"), True, ("report_only", False, False)),
        (_result(verdict="normal", outputs=False), True, ("report_only", False, False)),
    ],
)
def test_decide_output(result, confirmed, expected):
    d = decide_output(result, confirmed)
    assert (d.mode, d.official, d.needs_confirmation) == expected
    assert (d.stop_reason is None) == d.official
    # Excel の処理結果のシートの有無（RunResult.can_export）と食い違わない（確認したうえでの出力）
    if confirmed:
        assert d.official == result.can_export


def test_critical_stop_reason_names_the_main_reason():
    d = decide_output(_result(verdict="critical", export="report_only"))
    assert d.stop_reason == "処理は完了しましたが、重大な品質異常を検出したため、正式な結果の出力を停止しました。（理由1）"


def test_export_api_uses_the_same_decision(client):
    h, _, body = run_demo(client, "ng")
    res = client.get(f"/api/runs/{body['run_id']}/export", headers=h)
    # 重大：調査用の確認結果だけ（正式な結果ではない）
    assert res.status_code == 200 and "%E7%A2%BA%E8%AA%8D%E7%B5%90%E6%9E%9C" in res.headers["content-disposition"]
