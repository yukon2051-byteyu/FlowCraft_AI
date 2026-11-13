"""Phase Q-3：空白のルールの適用と、総合判定への反映（案A）。

実際の Excel で作ったサンプル（blank_title_total_sample.xlsx。見出しは3行目）を、読み込んで出力するだけの作業手順で実行する。
- ルールがないとき：必ずある列の空欄・途中の空白行は「扱いが決まっていない」＝未検証（確認すれば出力できる）、合計・メモの行の可能性は注意
- 任意の列の空欄は、ルールがなくても許可とみなす
- ルールを決めたとき：空白行を除外・最後の行を除外・空白文字を空欄として扱う、が適用され、件数が変わる
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

SAMPLE = Path(__file__).parent / "fixtures" / "blank_title_total_sample.xlsx"


@pytest.fixture
def ctx():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
        fid = c.post("/api/files", headers=h, files={"file": (SAMPLE.name, SAMPLE.read_bytes())}).json()["file_id"]
        cols = [x["name"] for x in c.get(f"/api/files/{fid}", headers=h, params={"header_row": 3}).json()["columns"]]
        yield c, h, fid, cols


def flow(cols, required=None, blank=None, rules=None):
    """読み込んで出力するだけの作業手順。required：必ずある列の名前（省略時はすべて）"""
    required = set(cols if required is None else required)
    columns = []
    for name in cols:
        col = {"name": name, "type": "string", "required": name in required}
        if blank and name in blank:
            col["blank"] = {"action": blank[name]}
        columns.append(col)
    d = {"input_id": "sample", "label": "検証用", "file_kind": "xlsx", "header_row": 3, "columns": columns}
    if rules:
        d["blank_rules"] = rules
    return {
        "schema_version": "1.3",
        "engine_version": "0.1.0",
        "flow_id": "11111111-2222-4333-8444-555555555555",
        "flow_version": 1,
        "flow_name": "空白の検証",
        "created_at": "2026-11-13T10:00:00+09:00",
        "updated_at": "2026-11-13T10:00:00+09:00",
        "input_definitions": [d],
        "nodes": [
            {"node_id": "n1", "node_type": "load", "node_name": "読み込む", "parameters": {"input_id": "sample"}, "output_reference": "sample", "confirmation_status": "confirmed"},
            {
                "node_id": "n2",
                "node_type": "output",
                "node_name": "出力する",
                "parameters": {"sheets": [{"reference": "sample", "sheet_name": "結果"}]},
                "input_references": ["sample"],
                "confirmation_status": "confirmed",
            },
        ],
    }


def run(ctx, f):
    c, h, fid, _ = ctx
    res = c.post("/api/runs", headers=h, json={"flow": f, "bindings": [{"input_id": "sample", "file_id": fid, "header_row": 3}]})
    assert res.status_code == 200, res.text
    body = res.json()
    return body, {x["criterion_id"]: x for x in body["criteria"]}


def test_undefined_blanks_are_unverified_and_need_confirmation(ctx):
    cols = ctx[3]
    body, crit = run(ctx, flow(cols))
    assert body["status"] != "failed"
    assert body["verdict"]["verdict"] == "unverified" and body["verdict"]["export"] == "needs_confirmation"
    # 途中の空白行（7行目）・最後の行（9行目＝集計メモ）・必ずある列の空欄（D6・E5 の空白文字・F9 の数式・C9）
    assert crit["blank__sample__rows"]["status"] == "unverified" and "7" in crit["blank__sample__rows"]["summary"]
    assert crit["blank__sample__last"]["status"] == "failed" and crit["blank__sample__last"]["on_fail"] == "caution"
    sales = crit["blank__sample__c3"]
    assert sales["status"] == "unverified" and sales["evidence"]["Excelの行"] == "6"
    note = crit["blank__sample__c4"]
    assert note["evidence"]["うち空白文字だけ"] == "1"
    formula = crit["blank__sample__c5"]
    assert formula["evidence"]["うち空の文字列を返す数式"] == "1"
    # 結合セルの続き（B9）は欠損として数えない
    assert "blank__sample__c1" not in crit
    # 記録にも「空欄の件数」として残る（前回比較の品質異常の件数に使う）
    rec = {r["criterion_id"]: r for r in body["record"]["rules"]}
    assert rec["blank__sample__c3"]["anomaly_count"] == 1 and rec["blank__sample__c3"]["snapshot"]["blank_rules"]["blank_rows"] == "unset"


def test_optional_columns_allow_blanks_without_a_rule(ctx):
    cols = ctx[3]
    body, crit = run(ctx, flow(cols, required=[cols[0]], rules={"blank_rows": "skip", "last_row": "exclude"}))
    assert not any(k.startswith("blank__sample__c") for k in crit)
    assert body["verdict"]["verdict"] == "normal"


def test_decided_rules_are_applied_to_the_loaded_copy(ctx):
    cols = ctx[3]
    allow = {n: "allow" for n in cols}
    body, crit = run(ctx, flow(cols, blank=allow, rules={"blank_rows": "skip", "last_row": "exclude", "whitespace_is_blank": True}))
    assert body["verdict"]["verdict"] == "normal" and not crit
    load = body["nodes"][0]
    # 6行のデータのうち、途中の空白行（7行目）と集計メモの行（9行目）を除いた4行
    assert load["output_rows"] == 4
    summary = next(i for i in load["issues"] if i["code"] == "BLANK_SUMMARY")
    assert "区切りとして除外しました" in summary["message"] and "除外しました" in summary["message"]


def test_blank_rows_error_stops_loading(ctx):
    cols = ctx[3]
    body, _ = run(ctx, flow(cols, rules={"blank_rows": "error"}))
    assert body["status"] == "failed"
    assert body["nodes"][0]["issues"][0]["code"] == "BLANK_ROWS_FOUND"
    assert body["verdict"]["verdict"] == "critical"


def test_critical_blank_rule_stops_official_output(ctx):
    cols = ctx[3]
    body, crit = run(ctx, flow(cols, blank={n: "allow" for n in cols} | {cols[3]: "critical"}, rules={"blank_rows": "skip", "last_row": "data"}))
    assert crit["blank__sample__c3"]["status"] == "failed" and crit["blank__sample__c3"]["on_fail"] == "critical"
    assert body["verdict"]["verdict"] == "critical" and body["can_export"] is False
    assert body["record"]["official_output"]["mode"] == "report_only"
