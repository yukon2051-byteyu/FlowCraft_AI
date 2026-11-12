"""行の抽出・並べ替え・列編集・型変換ノードのテスト（タスク1-11）。"""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import TypeAdapter

from app.engine.registry import NodeContext, get_handler
from app.engine.result import NodeFailure
from app.engine.table import ColumnSpec, Table
from app.flow.schema import Node, ValidationRules

NODE = TypeAdapter(Node)
CTX = NodeContext(bindings={}, files={}, input_definitions={}, validation_rules=ValidationRules(), max_rows=500_000)


def table() -> Table:
    """架空の売上明細（空欄を含む）。"""
    cols = {
        "売上日": ("date", [date(2026, 10, 3), date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 1), None]),
        "部署": ("string", ["営業1部", "営業2部", None, "営業1部", "営業2部"]),
        "商品コード": ("string", ["00123", "A-2040", "00123", "B-0001", "A-2040"]),
        "数量": ("integer", [2, 1, 5, 3, None]),
        "金額": ("decimal", [Decimal("3000"), Decimal("980"), Decimal("7500"), Decimal("4500"), Decimal("1200")]),
        "返品": ("boolean", [False, False, True, False, False]),
    }
    return Table(columns=list(cols), specs={k: ColumnSpec(t) for k, (t, _) in cols.items()}, data={k: v for k, (_, v) in cols.items()})


def run(node_type: str, params: dict, t: Table | None = None, name: str = "テスト"):
    node = NODE.validate_python(
        {
            "node_id": "x",
            "node_type": node_type,
            "node_name": name,
            "parameters": params,
            "input_references": ["in"],
            "output_reference": "out",
        }
    )
    return get_handler(node_type)(node, [t or table()], CTX)


def failure(node_type: str, params: dict, t: Table | None = None):
    with pytest.raises(NodeFailure) as e:
        run(node_type, params, t)
    return e.value.issue


def cond(column, operator, value=None):
    c = {"kind": "condition", "column": column, "operator": operator}
    if value is not None:
        c["value"] = value
    return c


# ===================== 行の抽出 =====================


def rows_of(out, column):
    return out.table.data[column]


@pytest.mark.parametrize(
    ("condition", "expected_codes"),
    [
        (cond("金額", "gt", 1000), ["00123", "00123", "B-0001", "A-2040"]),
        (cond("金額", "ge", "4500"), ["00123", "B-0001"]),
        (cond("金額", "lt", 1000), ["A-2040"]),
        (cond("金額", "le", "980.0"), ["A-2040"]),
        (cond("数量", "eq", 5), ["00123"]),
        (cond("売上日", "ge", "2026/10/02"), ["00123", "00123"]),
        (cond("商品コード", "contains", "A-"), ["A-2040", "A-2040"]),
        (cond("商品コード", "not_contains", "A-"), ["00123", "00123", "B-0001"]),
        (cond("部署", "is_empty"), ["00123"]),
        (cond("数量", "is_not_empty"), ["00123", "A-2040", "00123", "B-0001"]),
        (cond("返品", "eq", True), ["00123"]),
    ],
)
def test_filter_operators(condition, expected_codes):
    out = run("filter", {"condition": condition})
    assert rows_of(out, "商品コード") == expected_codes


def test_numbers_are_compared_as_numbers_not_text():
    """文字の大小で比べると "980" > "1000" になってしまう。数値として比べること。"""
    out = run("filter", {"condition": cond("金額", "lt", "1000")})
    assert rows_of(out, "金額") == [Decimal("980")]


def test_and_or_groups():
    c = {
        "kind": "group",
        "logic": "or",
        "conditions": [
            {"kind": "group", "logic": "and", "conditions": [cond("部署", "eq", "営業1部"), cond("金額", "gt", 4000)]},
            cond("商品コード", "eq", "A-2040"),
        ],
    }
    out = run("filter", {"condition": c})
    assert rows_of(out, "商品コード") == ["A-2040", "B-0001", "A-2040"]


def test_blank_rows_excluded_by_not_equal_are_reported():
    """「部署 ≠ 営業1部」で、部署が空欄の行も除外される。そのことを必ず報告する。"""
    out = run("filter", {"condition": cond("部署", "ne", "営業1部")})
    assert rows_of(out, "部署") == ["営業2部", "営業2部"]
    blank = [i for i in out.issues if i.code == "BLANK_ROWS_EXCLUDED"]
    assert blank and blank[0].details["count"] == 1
    assert "5行のうち2行を抽出" in out.issues[0].message


def test_filter_invalid_value_for_type():
    issue = failure("filter", {"condition": cond("金額", "gt", "千円")})
    assert issue.code == "FILTER_VALUE_INVALID"


def test_filter_operator_not_allowed_for_type():
    assert failure("filter", {"condition": cond("売上日", "contains", "10")}).code == "OPERATOR_NOT_ALLOWED"
    assert failure("filter", {"condition": cond("部署", "gt", "営業")}).code == "OPERATOR_NOT_ALLOWED"


def test_filter_unknown_column_suggests():
    issue = failure("filter", {"condition": cond("売上金額", "gt", 1)})
    assert issue.code == "COLUMN_NOT_FOUND"
    assert "金額" in issue.details["candidates"]["売上金額"]


def test_filter_result_can_be_empty():
    out = run("filter", {"condition": cond("金額", "gt", 999999)})
    assert out.table.row_count == 0 and out.table.columns == table().columns


# ===================== 並べ替え =====================


def test_sort_multi_keys_stable_and_blanks_last():
    out = run("sort", {"keys": [{"column": "部署"}, {"column": "金額", "ascending": False}]})
    assert rows_of(out, "部署") == ["営業1部", "営業1部", "営業2部", "営業2部", None]
    assert rows_of(out, "金額") == [Decimal("4500"), Decimal("3000"), Decimal("1200"), Decimal("980"), Decimal("7500")]


def test_sort_desc_keeps_original_order_for_ties_and_blank_last():
    out = run("sort", {"keys": [{"column": "売上日", "ascending": False}]})
    assert rows_of(out, "売上日") == [date(2026, 10, 3), date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 1), None]
    # 同じ日付（10/1）の2行は、元の順序（A-2040 → B-0001）のまま
    assert rows_of(out, "商品コード")[2:4] == ["A-2040", "B-0001"]


def test_sort_does_not_modify_input():
    t = table()
    before = {k: list(v) for k, v in t.data.items()}
    run("sort", {"keys": [{"column": "金額"}]}, t)
    assert t.data == before


# ===================== 列編集 =====================


def test_select_columns_order():
    out = run("select_columns", {"columns": ["金額", "商品コード"]})
    assert out.table.columns == ["金額", "商品コード"]
    assert out.issues[0].details["dropped"] == ["売上日", "部署", "数量", "返品"]


def test_select_columns_errors():
    assert failure("select_columns", {"columns": ["金額", "金額"]}).code == "DUPLICATE_COLUMN"
    assert failure("select_columns", {"columns": ["存在しない"]}).code == "COLUMN_NOT_FOUND"


def test_rename_columns():
    out = run("rename_columns", {"renames": [{"source": "金額", "target": "売上金額"}]})
    assert out.table.columns == ["売上日", "部署", "商品コード", "数量", "売上金額", "返品"]
    assert out.table.specs["売上金額"].type == "decimal"


def test_rename_swap_is_allowed_but_clash_is_not():
    out = run("rename_columns", {"renames": [{"source": "部署", "target": "商品コード"}, {"source": "商品コード", "target": "部署"}]})
    assert out.table.data["部署"][0] == "00123"
    assert failure("rename_columns", {"renames": [{"source": "部署", "target": "金額"}]}).code == "COLUMN_NAME_CONFLICT"


def test_drop_columns():
    out = run("drop_columns", {"columns": ["返品", "数量"]})
    assert out.table.columns == ["売上日", "部署", "商品コード", "金額"]
    all_cols = table().columns
    assert failure("drop_columns", {"columns": all_cols}).code == "NO_COLUMNS_LEFT"


def test_add_constant():
    out = run("add_constant", {"column": "対象月", "value": "2026/10/01", "value_type": "date"})
    assert out.table.data["対象月"] == [date(2026, 10, 1)] * 5
    assert failure("add_constant", {"column": "金額", "value": "1"}).code == "COLUMN_ALREADY_EXISTS"
    assert failure("add_constant", {"column": "率", "value": "abc", "value_type": "decimal"}).code == "CONSTANT_VALUE_INVALID"


# ===================== 型変換 =====================


def text_table(values: list) -> Table:
    return Table(columns=["値"], specs={"値": ColumnSpec("string")}, data={"値": values})


def test_cast_success_with_scale_and_rounding():
    t = text_table(["1,234.565", "10", None])
    out = run("cast", {"casts": [{"column": "値", "to": "decimal", "scale": 2, "rounding": "down"}]}, t)
    assert out.table.data["値"] == [Decimal("1234.56"), Decimal("10.00"), None]
    assert out.table.specs["値"] == ColumnSpec("decimal", 2)
    assert "切り捨て" in out.issues[0].message


def test_cast_failure_stops_by_default_with_row_numbers():
    t = text_table(["100", "百", "200", "N/A"])
    issue = failure("cast", {"casts": [{"column": "値", "to": "integer"}]}, t)
    assert issue.code == "TYPE_CONVERSION_FAILED"
    assert issue.details["failures"]["値"]["count"] == 2
    assert issue.details["failures"]["値"]["examples"] == [{"row": 2, "value": "百"}, {"row": 4, "value": "N/A"}]


def test_cast_failure_warn_blanks_and_reports():
    t = text_table(["100", "百"])
    out = run("cast", {"casts": [{"column": "値", "to": "integer"}], "on_failure": "warn"}, t)
    assert out.table.data["値"] == [100, None]
    w = [i for i in out.issues if i.code == "TYPE_CONVERSION_BLANKED"]
    assert w and w[0].severity == "warning" and "1件" in w[0].message


def test_cast_typed_to_string_and_decimal_to_integer():
    out = run("cast", {"casts": [{"column": "売上日", "to": "string"}, {"column": "金額", "to": "integer"}]})
    assert out.table.data["売上日"][0] == "2026/10/03"
    assert out.table.data["金額"][0] == 3000
    t = Table(columns=["v"], specs={"v": ColumnSpec("decimal")}, data={"v": [Decimal("3.5")]})
    assert failure("cast", {"casts": [{"column": "v", "to": "integer"}]}, t).code == "TYPE_CONVERSION_FAILED"  # 切り捨てない


def test_cast_duplicate_column():
    assert failure("cast", {"casts": [{"column": "金額", "to": "integer"}, {"column": "金額", "to": "string"}]}).code == "DUPLICATE_COLUMN"
