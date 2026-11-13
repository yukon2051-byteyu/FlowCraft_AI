"""タスク2-1：作業手順の形の決まり 1.1（完了基準・実行時に指定する値）のテスト。

- 1.0 のファイルは、そのまま 1.1 として読める（完了基準は空）
- 1.1 のファイルを保存 → 読み込みしても、完了基準・実行時に指定する値・変更の記録が失われない
- 形の誤り（種類・値・重さ）と、参照の誤り（対象・実行時に指定する値）を拒否する
docs/completion-criteria.md §3・§4
"""

import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.flow.schema import SCHEMA_VERSION
from app.flow.validate import FlowSchemaError, criteria_issues, parse_flow, validate_structure
from app.main import create_app

FLOW_10 = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "monthly_sales.json").read_text(encoding="utf-8"))

# 11種類すべてを1つずつ使う（売上集計のテンプレートに近い例）
CRITERIA = [
    {"criterion_id": "c1", "name": "必要な列がそろっている", "kind": "required_columns", "target": {"ref": "sales"}, "on_fail": "critical", "origin": "template"},
    {"criterion_id": "c2", "name": "売上金額が数値", "kind": "data_type", "target": {"ref": "sales", "column": "売上金額"}, "on_fail": "critical"},
    {"criterion_id": "c3", "name": "商品コードに空欄がない", "kind": "no_blank", "target": {"ref": "sales_selected", "column": "商品コード"}, "params": {"max_count": 0}, "on_fail": "caution"},
    {"criterion_id": "c4", "name": "伝票番号が重複しない", "kind": "unique", "target": {"ref": "sales_selected"}, "params": {"columns": ["伝票番号"]}, "on_fail": "caution"},
    {"criterion_id": "c5", "name": "数量が1以上", "kind": "value_range", "target": {"ref": "sales_selected", "column": "数量"}, "params": {"min": 1}, "on_fail": "caution"},
    {"criterion_id": "c6", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales_selected", "column": "売上日"}, "params": {"month": {"$param": "target_month"}}, "on_fail": "critical"},
    {"criterion_id": "c7", "name": "集計前後の売上金額が一致", "kind": "total_match", "target": {"ref": "by_dept", "column": "売上合計"}, "params": {"compare_ref": "sales_full", "compare_column": "売上金額", "tolerance": 0}, "on_fail": "critical"},
    {"criterion_id": "c8", "name": "部署は4つ", "kind": "row_count", "target": {"ref": "by_dept"}, "params": {"min": 4, "max": 4}, "on_fail": "caution"},
    {"criterion_id": "c9", "name": "照合できない商品コードが0件", "kind": "all_matched", "target": {"ref": "sales_p"}, "params": {"max_count": 0}, "on_fail": "critical"},
    {"criterion_id": "c10", "name": "売上合計が確認用の値と一致", "kind": "expected_value", "target": {"ref": "by_dept", "column": "売上合計"}, "params": {"measure": "sum", "value": {"$param": "expected_total"}, "tolerance": "0"}, "on_fail": "critical"},
    {
        "criterion_id": "c11",
        "name": "高額の伝票を一覧にする",
        "kind": "list_rows",
        "target": {"ref": "sales_selected"},
        "params": {"condition": {"kind": "condition", "column": "売上金額", "operator": "ge", "value": "500000"}},
        "on_fail": "record",
    },
]
RUN_PARAMETERS = [
    {"param_id": "target_month", "label": "対象月", "type": "month"},
    {"param_id": "expected_total", "label": "確認用の売上合計", "type": "integer", "required": False},
]


def flow_11(**overrides):
    f = copy.deepcopy(FLOW_10)
    f["schema_version"] = "1.1"
    f["run_parameters"] = copy.deepcopy(RUN_PARAMETERS)
    f["completion_criteria"] = {
        "version": 2,
        "items": copy.deepcopy(CRITERIA),
        "changelog": [{"version": 2, "changed_at": "2026-12-01T09:00:00+09:00", "summary": "「部署は4つ」を追加"}],
    }
    f.update(overrides)
    return f


def with_criterion(**patch):
    """c1 を差し替えた作業手順（1つの基準だけを試す）"""
    f = flow_11()
    f["completion_criteria"]["items"] = [{**CRITERIA[0], **patch}]
    return f


def codes(flow) -> list[str]:
    return [i.code for i in criteria_issues(parse_flow(flow))]


# ===================== 1.0 からの移行 =====================


def test_current_version_is_13():
    assert SCHEMA_VERSION == "1.3"


def test_10_file_is_read_as_latest_with_empty_criteria():
    flow = parse_flow(FLOW_10)
    assert flow.schema_version == "1.3"
    assert flow.run_parameters == []
    assert flow.completion_criteria.items == [] and flow.completion_criteria.version == 1
    assert validate_structure(flow) == []


def test_10_file_with_11_items_is_rejected():
    f = copy.deepcopy(FLOW_10)
    f["completion_criteria"] = {"items": []}
    with pytest.raises(FlowSchemaError) as e:
        parse_flow(f)
    assert "1.1 の項目" in str(e.value.errors)


# ===================== 保存 → 読み込みで失われない =====================


def test_all_11_kinds_are_accepted_and_valid():
    flow = parse_flow(flow_11())
    assert [c.kind for c in flow.completion_criteria.items] == [c["kind"] for c in CRITERIA]
    assert criteria_issues(flow) == []
    assert validate_structure(flow) == []


def test_save_and_reload_keeps_everything():
    first = parse_flow(flow_11())
    # 保存（JSONに書き出す）→ 読み込み。「実行時に指定する値」は {"$param": …} の形で書き出す
    saved = json.dumps(first.model_dump(mode="json", by_alias=True), ensure_ascii=False)
    assert '"$param": "target_month"' in saved
    again = parse_flow(saved)
    assert again == first
    assert again.completion_criteria.version == 2
    assert again.completion_criteria.changelog[0].summary == "「部署は4つ」を追加"
    assert again.run_parameters[0].label == "対象月"
    # 数値で書いた値も文字列として保持する（小数の誤差を避ける）
    assert again.completion_criteria.items[4].params.min == "1"
    assert again.completion_criteria.items[6].params.tolerance == "0"


def test_defaults():
    flow = parse_flow(with_criterion())
    c = flow.completion_criteria.items[0]
    assert c.origin == "template" and c.confirmation_status == "confirmed" and c.note == ""
    assert c.params.columns == []  # 空 = 入力の定義で「必ずある列」すべて


# ===================== 形の誤りを拒否する =====================


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"kind": "python_exec"}, ""),
        ({"on_fail": "fatal"}, ""),
        ({"criterion_id": "c 1"}, ""),
        ({"name": ""}, ""),
        ({"surprise": 1}, ""),  # 定義にない項目
        ({"kind": "list_rows", "params": {"condition": {"kind": "condition", "column": "a", "operator": "eq", "value": "1"}}, "on_fail": "critical"}, "記録のみ"),
        ({"kind": "value_range", "target": {"ref": "sales", "column": "数量"}, "params": {}}, "最小・最大のどちらか"),
        ({"kind": "row_count", "params": {"min": 5, "max": 1}}, "最小が最大より大きく"),
        ({"kind": "unique", "params": {"columns": []}}, ""),
        ({"kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": "2026-10", "start": "2026-10-01"}}, "どちらか一方だけ"),
        ({"kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {}}, "対象の月、または開始日・終了日"),
        ({"kind": "total_match", "params": {"compare_ref": "by_dept", "compare_column": "売上合計", "tolerance": "-1"}}, "0以上"),
        ({"kind": "expected_value", "params": {"measure": "sum", "value": "1", "tolerance": "abc"}}, "数値"),
        ({"kind": "expected_value", "params": {"measure": "avg", "value": "1"}}, ""),
        ({"kind": "no_blank", "params": {"max_count": -1}}, ""),
    ],
)
def test_invalid_criteria_are_rejected(patch, message):
    with pytest.raises(FlowSchemaError) as e:
        parse_flow(with_criterion(**patch))
    assert message in " ".join(m for _, m in e.value.errors)


def test_too_many_criteria_and_parameters_are_rejected():
    f = flow_11()
    f["completion_criteria"]["items"] = [{**CRITERIA[0], "criterion_id": f"c{i}"} for i in range(51)]
    with pytest.raises(FlowSchemaError):
        parse_flow(f)
    f = flow_11()
    f["run_parameters"] = [{"param_id": f"p{i}", "label": "値", "type": "string"} for i in range(21)]
    with pytest.raises(FlowSchemaError):
        parse_flow(f)


# ===================== 参照の誤りを見つける =====================


def test_unknown_target_and_compare_ref():
    assert codes(with_criterion(target={"ref": "nowhere"})) == ["UNKNOWN_CRITERION_TARGET"]
    tm = {"kind": "total_match", "target": {"ref": "by_dept", "column": "売上合計"}, "params": {"compare_ref": "ghost", "compare_column": "x"}}
    assert codes(with_criterion(**tm)) == ["UNKNOWN_CRITERION_TARGET"]


def test_kind_specific_targets():
    # 入力が対象の基準を、ステップの結果に付けた
    assert codes(with_criterion(target={"ref": "by_dept"})) == ["CRITERION_TARGET_NOT_INPUT"]
    # 照合の基準を、結合でないステップに付けた
    assert codes(with_criterion(kind="all_matched", target={"ref": "by_dept"})) == ["CRITERION_TARGET_NOT_JOIN"]
    # 列が必要な基準で列がない
    assert codes(with_criterion(kind="no_blank", target={"ref": "sales_selected"})) == ["CRITERION_COLUMN_REQUIRED"]
    assert codes(with_criterion(kind="expected_value", target={"ref": "by_dept"}, params={"measure": "sum", "value": "1"})) == ["CRITERION_COLUMN_REQUIRED"]
    # 件数の確認値は列がなくてよい
    assert codes(with_criterion(kind="expected_value", target={"ref": "by_dept"}, params={"measure": "count", "value": "4"})) == []


def test_run_parameter_references_and_value_formats():
    period = {"kind": "period", "target": {"ref": "sales", "column": "売上日"}}
    assert codes(with_criterion(**period, params={"month": {"$param": "missing"}})) == ["UNKNOWN_RUN_PARAMETER"]
    assert codes(with_criterion(**period, params={"month": {"$param": "expected_total"}})) == ["RUN_PARAMETER_TYPE"]
    assert codes(with_criterion(**period, params={"month": "2026-13"})) == ["INVALID_CRITERION_VALUE"]
    assert codes(with_criterion(**period, params={"start": "2026-02-30"})) == ["INVALID_CRITERION_VALUE"]
    assert codes(with_criterion(**period, params={"start": "2026-10-01", "end": "2026-10-31"})) == []
    ev = {"kind": "expected_value", "target": {"ref": "by_dept", "column": "売上合計"}}
    assert codes(with_criterion(**ev, params={"measure": "sum", "value": "二千万"})) == ["INVALID_CRITERION_VALUE"]
    assert codes(with_criterion(**ev, params={"measure": "sum", "value": {"$param": "target_month"}})) == ["RUN_PARAMETER_TYPE"]


def test_duplicate_ids_and_changelog():
    f = flow_11()
    f["completion_criteria"]["items"].append({**CRITERIA[0]})
    f["run_parameters"].append({**RUN_PARAMETERS[0]})
    assert sorted(codes(f)) == ["DUPLICATE_CRITERION_ID", "DUPLICATE_PARAM_ID"]
    f = flow_11()
    f["completion_criteria"]["changelog"][0]["version"] = 9
    assert codes(f) == ["INVALID_CRITERIA_CHANGELOG"]


# ===================== API（画面からの確認）=====================


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def test_validate_api_accepts_10_and_11(client):
    for f in (FLOW_10, flow_11()):
        body = client.post("/api/flows/validate", json={"flow": f}).json()
        assert body["valid"] and body["executable"], body


def test_validate_api_reports_criteria_problems_and_blocks_run(client):
    body = client.post("/api/flows/validate", json={"flow": with_criterion(target={"ref": "nowhere"})}).json()
    assert body["schema_errors"] == []  # 1つ1つの項目の形は正しい
    assert body["valid"] is False and body["executable"] is False  # 参照の誤りがあるので、保存も実行もできない
    assert any(i["code"] == "UNKNOWN_CRITERION_TARGET" and "完了基準「必要な列がそろっている」" in i["message"] for i in body["issues"])


# ===================== 1.1 → 1.2：品質ルールの識別（品質MVP） =====================


def _flow_11_with_criteria():
    return flow_11()


def test_11_file_gets_rule_identity_that_is_the_same_every_time():
    """1.1 の完了基準には、作業手順の識別と基準の識別から、毎回同じルールの識別を補う（画面の normalizeFlow と同じ規則）"""
    a = parse_flow(_flow_11_with_criteria())
    b = parse_flow(_flow_11_with_criteria())
    item = a.completion_criteria.items[0]
    assert a.schema_version == "1.3"
    assert item.rule_id == f"{FLOW_10['flow_id']}:{item.criterion_id}"
    assert item.rule_version == 1 and item.copied_from is None
    assert b.completion_criteria.items[0].rule_id == item.rule_id


def test_11_file_with_12_items_is_rejected():
    f = _flow_11_with_criteria()
    f["completion_criteria"]["items"][0]["rule_version"] = 3
    with pytest.raises(FlowSchemaError) as e:
        parse_flow(f)
    assert "1.2 の項目" in str(e.value.errors)


def test_12_requires_rule_id_and_keeps_version_and_copy_source():
    f = _flow_11_with_criteria()
    f["schema_version"] = "1.2"
    item = f["completion_criteria"]["items"][0]
    with pytest.raises(FlowSchemaError):
        parse_flow(f)  # 1.2 では rule_id が必須
    for i, other in enumerate(f["completion_criteria"]["items"]):
        other["rule_id"] = f"r-{i}"
    item.update({"rule_id": "r-new", "rule_version": 4, "copied_from": {"rule_id": "r-origin", "rule_version": 2}})
    got = parse_flow(f).completion_criteria.items[0]
    assert (got.rule_id, got.rule_version, got.copied_from.rule_id, got.copied_from.rule_version) == ("r-new", 4, "r-origin", 2)


# ===================== 1.2 → 1.3：空白の扱い（Phase Q） =====================


def test_12_file_gets_default_blank_rules_and_13_keeps_them():
    f = flow_11()
    flow = parse_flow(f)
    d = flow.input_definitions[0]
    assert (d.blank_rules.blank_rows, d.blank_rules.whitespace_is_blank, d.blank_rules.last_row) == ("unset", True, "unset")
    assert all(c.blank is None for c in d.columns)
    g = flow.model_dump(mode="json", by_alias=True)
    g["input_definitions"][0]["blank_rules"] = {"blank_rows": "skip", "whitespace_is_blank": True, "last_row": "exclude"}
    g["input_definitions"][0]["columns"][0]["blank"] = {"action": "critical"}
    again = parse_flow(g)
    assert again.input_definitions[0].blank_rules.blank_rows == "skip"
    assert again.input_definitions[0].columns[0].blank.action == "critical"


def test_12_file_with_13_items_is_rejected():
    g = parse_flow(flow_11()).model_dump(mode="json", by_alias=True)
    g["schema_version"] = "1.2"
    g["input_definitions"][0]["columns"][0]["blank"] = {"action": "allow"}
    with pytest.raises(FlowSchemaError) as e:
        parse_flow(g)
    assert "1.3 の項目" in str(e.value.errors)

