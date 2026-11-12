"""フローJSONのスキーマ・構造検証のテスト（タスク1-6）。

正常系：見本フローが読み込める／保存→再読込で内容が変わらない
異常系：形の誤り、未対応の処理、AIが紛れ込ませそうな不正値、参照関係の誤り
"""

import copy
import json
from pathlib import Path

import pytest

from app.flow.schema import FlowDefinition
from app.flow.validate import (
    FlowSchemaError,
    check_move,
    compute_dependencies,
    execution_blockers,
    parse_flow,
    validate_structure,
)

FIXTURE = Path(__file__).parent / "fixtures" / "flows" / "monthly_sales.json"


@pytest.fixture
def flow_dict() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def node(d: dict, node_id: str) -> dict:
    return next(n for n in d["nodes"] if n["node_id"] == node_id)


def errors_of(d: dict) -> list[tuple[str, str]]:
    with pytest.raises(FlowSchemaError) as e:
        parse_flow(d)
    return e.value.errors


def codes(flow: FlowDefinition) -> set[str]:
    return {i.code for i in validate_structure(flow)}


# ===================== 正常系 =====================


def test_fixture_is_valid(flow_dict):
    flow = parse_flow(flow_dict)
    assert flow.flow_name == "月次売上集計"
    assert len(flow.nodes) == 9
    assert validate_structure(flow) == []
    assert execution_blockers(flow) == []


def test_parse_from_json_string():
    flow = parse_flow(FIXTURE.read_text(encoding="utf-8"))
    assert flow.nodes[3].node_type == "join"


def test_round_trip_keeps_everything(flow_dict):
    """保存（JSON化）→再読込で、ノードの順序・設定が1つも失われないこと（最優先①）。"""
    flow = parse_flow(flow_dict)
    saved = flow.model_dump_json()
    reloaded = parse_flow(saved)
    assert reloaded == flow
    assert [n.node_id for n in reloaded.nodes] == [f"n{i}" for i in range(1, 10)]
    assert reloaded.nodes[3].parameters.expected_relationship == "many_to_one"


def test_numbers_are_kept_as_text_to_avoid_float_error(flow_dict):
    """値は文字列で保持し、小数誤差を持ち込まない。"""
    flow_dict["nodes"].insert(
        2,
        {
            "node_id": "f1",
            "node_type": "filter",
            "node_name": "金額で絞り込み",
            "parameters": {"condition": {"kind": "condition", "column": "金額", "operator": "ge", "value": 0.1}},
            "input_references": ["sales_selected"],
            "output_reference": "sales_filtered",
        },
    )
    flow = parse_flow(flow_dict)
    assert flow.nodes[2].parameters.condition.value == "0.1"


def test_dependencies_are_computed_from_references(flow_dict):
    flow = parse_flow(flow_dict)
    deps = {d.node_id: d.depends_on for d in compute_dependencies(flow)}
    assert deps["n1"] == []
    assert deps["n4"] == ["n2", "n3"]
    assert deps["n9"] == ["n7", "n8", "n6"]


def test_correct_dependencies_are_accepted(flow_dict):
    flow = parse_flow(flow_dict)
    flow_dict["dependencies"] = [d.model_dump() for d in compute_dependencies(flow)]
    assert validate_structure(parse_flow(flow_dict)) == []


# ===================== 形の誤り =====================


def test_unsupported_schema_version(flow_dict):
    flow_dict["schema_version"] = "2.0"
    errs = errors_of(flow_dict)
    assert errs[0][0] == "schema_version"
    assert "未対応のスキーマバージョン" in errs[0][1]


def test_missing_schema_version(flow_dict):
    del flow_dict["schema_version"]
    assert "未対応のスキーマバージョン" in errors_of(flow_dict)[0][1]


def test_broken_json_text():
    with pytest.raises(FlowSchemaError) as e:
        parse_flow('{"schema_version": "1.0", ')
    assert "JSONとして読み込めません" in e.value.errors[0][1]


def test_top_level_must_be_object():
    with pytest.raises(FlowSchemaError):
        parse_flow("[1, 2, 3]")


def test_unknown_node_type_is_rejected(flow_dict):
    """ホワイトリストにない処理（例：任意のPython実行）は通さない。"""
    node(flow_dict, "n2")["node_type"] = "python_exec"
    errs = errors_of(flow_dict)
    assert any("対応していない処理の種類です: python_exec" in m for _, m in errs)


def test_extra_field_is_rejected(flow_dict):
    """AIが勝手に足した項目（例：code）は拒否する。"""
    node(flow_dict, "n4")["parameters"]["code"] = "import os"
    errs = errors_of(flow_dict)
    assert ("nodes[3].parameters.code", "定義されていない項目です") in errs


def test_missing_required_parameter(flow_dict):
    del node(flow_dict, "n4")["parameters"]["expected_relationship"]
    errs = errors_of(flow_dict)
    assert ("nodes[3].parameters.expected_relationship", "必須の項目がありません") in errs


def test_invalid_enum_value(flow_dict):
    node(flow_dict, "n4")["parameters"]["how"] = "cross"
    assert ("nodes[3].parameters.how", "使用できない値です") in errors_of(flow_dict)


@pytest.mark.parametrize("bad_id", ["../etc", "n 1", "", "ノード1", "a" * 65])
def test_invalid_node_id(flow_dict, bad_id):
    node(flow_dict, "n1")["node_id"] = bad_id
    errors_of(flow_dict)


def test_join_needs_exactly_two_inputs(flow_dict):
    node(flow_dict, "n4")["input_references"] = ["sales_selected"]
    errs = errors_of(flow_dict)
    assert any("join の input_references は2個です" in m for _, m in errs)


def test_load_cannot_have_inputs(flow_dict):
    node(flow_dict, "n1")["input_references"] = ["products"]
    assert any("load の input_references は0個です" in m for _, m in errors_of(flow_dict))


def test_output_reference_required(flow_dict):
    del node(flow_dict, "n7")["output_reference"]
    assert any("output_reference が必要です" in m for _, m in errors_of(flow_dict))


def test_output_sheets_must_match_references(flow_dict):
    node(flow_dict, "n9")["input_references"] = ["by_product", "by_dept", "sales_full"]
    assert any("同じ順序" in m for _, m in errors_of(flow_dict))


@pytest.mark.parametrize("name", ["売上/集計", "a" * 32, "[明細]"])
def test_invalid_sheet_name(flow_dict, name):
    node(flow_dict, "n9")["parameters"]["sheets"][0]["sheet_name"] = name
    errors_of(flow_dict)


def test_duplicate_column_in_input_definition(flow_dict):
    flow_dict["input_definitions"][1]["columns"].append({"name": "商品名", "type": "string"})
    assert any("列名が重複しています: 商品名" in m for _, m in errors_of(flow_dict))


def test_fill_requires_fill_value():
    from pydantic import ValidationError

    from app.flow.schema import MissingParams

    with pytest.raises(ValidationError):
        MissingParams(columns=["金額"], mode="fill")
    with pytest.raises(ValidationError):
        MissingParams(columns=["金額"], mode="detect", fill_value="0")
    assert MissingParams(columns=["金額"], mode="fill", fill_value=0).fill_value == "0"


def test_aggregate_sum_requires_column():
    from pydantic import ValidationError

    from app.flow.schema import Aggregation

    with pytest.raises(ValidationError):
        Aggregation(function="sum", output_column="合計")
    assert Aggregation(function="count", output_column="件数").column is None


def test_condition_value_rules():
    from pydantic import ValidationError

    from app.flow.schema import Condition

    with pytest.raises(ValidationError):
        Condition(column="金額", operator="gt")  # 比較には値が必要
    with pytest.raises(ValidationError):
        Condition(column="備考", operator="is_empty", value="x")  # 空欄判定に値は不要


# ===================== 計算式（eval を使わない安全な式） =====================


def _calc_node(expr: dict) -> dict:
    return {
        "node_id": "c1",
        "node_type": "calculate",
        "node_name": "単価を計算",
        "parameters": {"output_column": "単価", "expression": expr},
        "input_references": ["sales_selected"],
        "output_reference": "sales_calc",
    }


def test_valid_expression(flow_dict):
    expr = {
        "kind": "operation",
        "op": "divide",
        "left": {"kind": "column", "column": "金額"},
        "right": {"kind": "column", "column": "数量"},
    }
    flow_dict["nodes"].insert(2, _calc_node(expr))
    assert parse_flow(flow_dict).nodes[2].parameters.expression.op == "divide"


def test_expression_rejects_code_string(flow_dict):
    """式に文字列のコードを入れても実行対象にならない（型として拒否）。"""
    flow_dict["nodes"].insert(2, _calc_node("__import__('os').system('dir')"))
    errors_of(flow_dict)


def test_expression_rejects_unknown_operator(flow_dict):
    expr = {"kind": "operation", "op": "power", "left": {"kind": "constant", "value": 2}, "right": {"kind": "constant", "value": 3}}
    flow_dict["nodes"].insert(2, _calc_node(expr))
    errors_of(flow_dict)


@pytest.mark.parametrize("value", ["abc", "NaN", "Infinity"])
def test_expression_constant_must_be_finite_number(flow_dict, value):
    expr = {"kind": "operation", "op": "add", "left": {"kind": "column", "column": "金額"}, "right": {"kind": "constant", "value": value}}
    flow_dict["nodes"].insert(2, _calc_node(expr))
    errors_of(flow_dict)


def _nested_expression(depth: int) -> dict:
    expr: dict = {"kind": "column", "column": "金額"}
    for _ in range(depth):
        expr = {"kind": "operation", "op": "add", "left": expr, "right": {"kind": "constant", "value": 1}}
    return expr


def test_expression_depth_limit(flow_dict):
    ok = copy.deepcopy(flow_dict)
    ok["nodes"].insert(2, _calc_node(_nested_expression(5)))
    parse_flow(ok)  # 5段まではOK

    ng = copy.deepcopy(flow_dict)
    ng["nodes"].insert(2, _calc_node(_nested_expression(6)))
    assert any("5段まで" in m for _, m in errors_of(ng))


def test_extremely_deep_input_does_not_crash(flow_dict):
    """悪意のある極端な入れ子でもサーバーが落ちず、検証エラーとして返る。"""
    flow_dict["nodes"].insert(2, _calc_node(_nested_expression(3000)))
    errors_of(flow_dict)


# ===================== 参照関係（構造検証） =====================


def test_reference_to_later_node(flow_dict):
    """R1：下にあるノードの結果を使うとエラー。"""
    flow_dict["nodes"][1], flow_dict["nodes"][3] = flow_dict["nodes"][3], flow_dict["nodes"][1]
    issues = validate_structure(parse_flow(flow_dict))
    hit = [i for i in issues if i.code == "REFERENCE_NOT_YET_DEFINED"]
    assert hit and hit[0].node_id == "n4"
    assert "より下にあるノード" in hit[0].message


def test_unknown_reference(flow_dict):
    node(flow_dict, "n7")["input_references"] = ["no_such_data"]
    assert "UNKNOWN_REFERENCE" in codes(parse_flow(flow_dict))


def test_duplicate_output_reference(flow_dict):
    node(flow_dict, "n8")["output_reference"] = "by_dept"
    assert "DUPLICATE_OUTPUT_REFERENCE" in codes(parse_flow(flow_dict))


def test_duplicate_node_id(flow_dict):
    node(flow_dict, "n8")["node_id"] = "n7"
    assert "DUPLICATE_NODE_ID" in codes(parse_flow(flow_dict))


def test_unknown_input_id(flow_dict):
    node(flow_dict, "n3")["parameters"]["input_id"] = "missing_input"
    assert "UNKNOWN_INPUT_ID" in codes(parse_flow(flow_dict))


def test_duplicate_input_id(flow_dict):
    flow_dict["input_definitions"][2]["input_id"] = "products"
    assert "DUPLICATE_INPUT_ID" in codes(parse_flow(flow_dict))


def test_output_must_be_last(flow_dict):
    out = flow_dict["nodes"].pop()
    flow_dict["nodes"].insert(7, out)
    assert "OUTPUT_NOT_LAST" in codes(parse_flow(flow_dict))


def test_no_output_is_warning_only(flow_dict):
    flow_dict["nodes"].pop()
    issues = validate_structure(parse_flow(flow_dict))
    assert [(i.code, i.severity) for i in issues] == [("NO_OUTPUT_NODE", "warning")]


def test_unused_reference_warning(flow_dict):
    out = node(flow_dict, "n9")
    out["input_references"] = ["by_dept", "sales_full"]
    out["parameters"]["sheets"] = [s for s in out["parameters"]["sheets"] if s["reference"] != "by_product"]
    issues = validate_structure(parse_flow(flow_dict))
    assert [(i.code, i.node_id, i.severity) for i in issues] == [("UNUSED_REFERENCE", "n8", "warning")]


def test_tampered_dependencies(flow_dict):
    flow = parse_flow(flow_dict)
    deps = [d.model_dump() for d in compute_dependencies(flow)]
    deps[3]["depends_on"] = ["n1"]  # 手で書き換えた
    flow_dict["dependencies"] = deps
    assert "DEPENDENCIES_MISMATCH" in codes(parse_flow(flow_dict))


# ===================== 並べ替え（R5） =====================


def test_move_allowed(flow_dict):
    flow = parse_flow(flow_dict)
    # 「商品マスタを読み込む」(3番目) を先頭へ：誰の参照も壊さない
    assert check_move(flow, "n3", 0) == (True, None)
    # 「商品別に集計」と「部署別に集計」の入れ替え
    assert check_move(flow, "n8", 6) == (True, None)


def test_move_blocked_when_breaking_reference(flow_dict):
    flow = parse_flow(flow_dict)
    ok, reason = check_move(flow, "n4", 1)  # 結合を、使うデータの読込より上へ
    assert ok is False
    assert reason and "より下にあるノード" in reason


def test_move_blocked_for_output_and_below_output(flow_dict):
    flow = parse_flow(flow_dict)
    assert check_move(flow, "n9", 3)[0] is False
    assert check_move(flow, "n1", 8)[0] is False


def test_move_unknown_node_or_out_of_range(flow_dict):
    flow = parse_flow(flow_dict)
    assert check_move(flow, "zzz", 0)[0] is False
    assert check_move(flow, "n1", 99)[0] is False


# ===================== 実行可否 =====================


def test_unconfirmed_node_blocks_execution(flow_dict):
    node(flow_dict, "n4")["confirmation_status"] = "ai_proposed"
    node(flow_dict, "n7")["confirmation_status"] = "pending"
    blockers = execution_blockers(parse_flow(flow_dict))
    assert {(b.code, b.node_id) for b in blockers} == {("NODE_NOT_CONFIRMED", "n4"), ("NODE_NOT_CONFIRMED", "n7")}
    assert "AI提案のまま" in next(b.message for b in blockers if b.node_id == "n4")


def test_open_question_blocks_execution(flow_dict):
    node(flow_dict, "n4")["open_questions"] = [{"param": "expected_relationship", "question": "重複しませんか？"}]
    assert [b.code for b in execution_blockers(parse_flow(flow_dict))] == ["OPEN_QUESTIONS"]


def test_empty_flow_is_not_executable(flow_dict):
    flow_dict["nodes"] = []
    assert [b.code for b in execution_blockers(parse_flow(flow_dict))] == ["EMPTY_FLOW"]


def test_structure_error_blocks_execution(flow_dict):
    node(flow_dict, "n7")["input_references"] = ["no_such_data"]
    assert "UNKNOWN_REFERENCE" in {b.code for b in execution_blockers(parse_flow(flow_dict))}
