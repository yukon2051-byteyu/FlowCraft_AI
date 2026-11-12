"""グループ別集計ノードと、デモA相当フローの通し実行のテスト（タスク1-14・仕様7.5）。

明細（期待値は手計算）：
  部署   商品  数量  金額     日付
  営業1  A     2     1000.50  10/01
  営業2  B     1      500     10/03
  営業1  A     1      300.25  10/05
  (空欄) C     4      200     10/02
  営業2  A     -      (空欄)  10/04
  営業1  B     3      700     10/02
"""

import json
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.engine.nodes.load import Binding
from app.engine.registry import NodeContext, get_handler, registered_types
from app.engine.result import NodeFailure
from app.engine.runner import run_flow
from app.engine.table import ColumnSpec, Table
from app.files.parse import RawSheet
from app.files.service import UploadedFile
from app.flow.schema import NODE_TYPES, Node, ValidationRules
from app.flow.validate import parse_flow

NODE = TypeAdapter(Node)
CTX = NodeContext(bindings={}, files={}, input_definitions={}, validation_rules=ValidationRules(), max_rows=500_000)


def make(cols):
    return Table(columns=list(cols), specs={k: ColumnSpec(t) for k, (t, _) in cols.items()}, data={k: list(v) for k, (_, v) in cols.items()})


def detail():
    return make(
        {
            "部署": ("string", ["営業1", "営業2", "営業1", None, "営業2", "営業1"]),
            "商品": ("string", ["A", "B", "A", "C", "A", "B"]),
            "数量": ("integer", [2, 1, 1, 4, None, 3]),
            "金額": ("decimal", [Decimal("1000.50"), Decimal("500"), Decimal("300.25"), Decimal("200"), None, Decimal("700")]),
            "日付": ("date", [date(2026, 10, d) for d in (1, 3, 5, 2, 4, 2)]),
        }
    )


def agg(group_by, aggregations, t=None):
    node = NODE.validate_python(
        {
            "node_id": "a",
            "node_type": "aggregate",
            "node_name": "集計",
            "parameters": {"group_by": group_by, "aggregations": aggregations},
            "input_references": ["in"],
            "output_reference": "out",
        }
    )
    return get_handler("aggregate")(node, [t or detail()], CTX)


def fails(group_by, aggregations, t=None):
    with pytest.raises(NodeFailure) as e:
        agg(group_by, aggregations, t)
    return e.value.issue


def issue(out, code):
    return next(i for i in out.issues if i.code == code)


def test_all_node_types_are_registered():
    """フローJSONで定義した処理の種類と、実行できる処理の一覧が一致していること。"""
    assert set(registered_types()) == set(NODE_TYPES)


# ===================== グループ別集計 =====================


def test_group_sum_count_and_order():
    out = agg(
        ["部署"],
        [
            {"function": "sum", "column": "金額", "output_column": "売上合計"},
            {"function": "count", "output_column": "件数"},
            {"function": "count", "column": "金額", "output_column": "金額件数"},
        ],
    )
    t = out.table
    assert t.columns == ["部署", "売上合計", "件数", "金額件数"]
    # 昇順・空欄のグループは最後（削除しない）
    assert t.data["部署"] == ["営業1", "営業2", None]
    assert t.data["売上合計"] == [Decimal("2000.75"), Decimal("500"), Decimal("200")]
    assert t.data["件数"] == [3, 2, 1]
    assert t.data["金額件数"] == [3, 1, 1]  # 営業2の金額は1件が空欄
    assert issue(out, "BLANK_GROUP_KEYS").details["rows"] == 1
    assert issue(out, "TOTAL_VERIFIED").details["after"] == "2700.75"  # 全体合計と一致
    assert "6件" in issue(out, "COUNT_VERIFIED").message
    assert issue(out, "NULLS_EXCLUDED").details["count"] == 1


def test_mean_excludes_blanks_and_rounding():
    out = agg(["部署"], [{"function": "mean", "column": "数量", "output_column": "平均数量", "scale": 2}])
    # 営業1：(2+1+3)/3=2.00、営業2：空欄を除いて 1/1=1.00（空欄を0として分母に入れない）
    assert out.table.data["平均数量"] == [Decimal("2.00"), Decimal("1.00"), Decimal("4.00")]
    out2 = agg(["部署"], [{"function": "mean", "column": "金額", "output_column": "平均", "scale": 1, "rounding": "half_even"}])
    # 営業1：2000.75/3 = 666.9166… → 666.9
    assert out2.table.data["平均"][0] == Decimal("666.9")
    out3 = agg([], [{"function": "mean", "column": "数量", "output_column": "平均"}])
    assert out3.table.data["平均"] == [Decimal("11") / Decimal("5")]
    assert issue(out3, "MEAN_NOT_ROUNDED")


def test_max_min_dates_and_nunique():
    out = agg(
        ["商品"],
        [
            {"function": "min", "column": "日付", "output_column": "初回"},
            {"function": "max", "column": "日付", "output_column": "最終"},
            {"function": "nunique", "column": "部署", "output_column": "部署数"},
            {"function": "max", "column": "数量", "output_column": "最大数量"},
        ],
    )
    t = out.table
    assert t.data["商品"] == ["A", "B", "C"]
    assert t.data["初回"] == [date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 2)]
    assert t.data["最終"] == [date(2026, 10, 5), date(2026, 10, 3), date(2026, 10, 2)]
    assert t.data["部署数"] == [2, 2, 0]  # C は部署が空欄のみ → 0（空欄は数えない）
    assert t.data["最大数量"] == [2, 3, 4]
    assert t.specs["最大数量"].type == "integer"


def test_all_blank_group_sum_is_blank_not_zero():
    t = make({"g": ("string", ["x", "y"]), "v": ("decimal", [None, Decimal("5")])})
    out = agg(["g"], [{"function": "sum", "column": "v", "output_column": "合計"}], t)
    assert out.table.data["合計"] == [None, Decimal("5")]


def test_multiple_keys_and_integer_sum_type():
    out = agg(["部署", "商品"], [{"function": "sum", "column": "数量", "output_column": "数量計"}])
    t = out.table
    assert t.rows() == [["営業1", "A", 3], ["営業1", "B", 3], ["営業2", "A", None], ["営業2", "B", 1], [None, "C", 4]]
    assert t.specs["数量計"].type == "integer"


def test_overall_total_without_keys_and_empty_input():
    out = agg([], [{"function": "sum", "column": "金額", "output_column": "総額"}, {"function": "count", "output_column": "件数"}])
    assert out.table.rows() == [[Decimal("2700.75"), 6]]
    empty = make({"金額": ("decimal", []), "部署": ("string", [])})
    out2 = agg([], [{"function": "sum", "column": "金額", "output_column": "総額"}, {"function": "count", "output_column": "件数"}], empty)
    assert out2.table.rows() == [[None, 0]]
    out3 = agg(["部署"], [{"function": "count", "output_column": "件数"}], empty)
    assert out3.table.row_count == 0


def test_rounded_sum_is_verified_within_rounding_error():
    t = make({"g": ("string", ["a", "a", "b"]), "v": ("decimal", [Decimal("0.4"), Decimal("0.4"), Decimal("0.4")])})
    out = agg(["g"], [{"function": "sum", "column": "v", "output_column": "s", "scale": 0}], t)
    assert out.table.data["s"] == [Decimal("1"), Decimal("0")]
    assert issue(out, "TOTAL_VERIFIED")
    assert issue(out, "ROUNDED")


def test_float_like_values_sum_exactly():
    """0.1 を3回足して 0.3 ちょうど（floatなら 0.30000000000000004）。"""
    t = make({"v": ("decimal", [Decimal("0.1")] * 3)})
    assert agg([], [{"function": "sum", "column": "v", "output_column": "s"}], t).table.data["s"] == [Decimal("0.3")]


def test_aggregate_errors():
    assert fails(["部署"], [{"function": "sum", "column": "商品", "output_column": "x"}]).code == "AGGREGATION_TYPE_INVALID"
    assert fails(["部署"], [{"function": "mean", "column": "日付", "output_column": "x"}]).code == "AGGREGATION_TYPE_INVALID"
    assert fails(["部署"], [{"function": "count", "output_column": "部署"}]).code == "DUPLICATE_COLUMN"
    assert fails(["存在しない"], [{"function": "count", "output_column": "n"}]).code == "COLUMN_NOT_FOUND"


def test_aggregate_large_data_is_fast():
    n = 100_000
    t = make({"g": ("string", [f"G{i % 1000}" for i in range(n)]), "v": ("integer", [i % 97 for i in range(n)])})
    start = time.perf_counter()
    out = agg(["g"], [{"function": "sum", "column": "v", "output_column": "s"}, {"function": "mean", "column": "v", "output_column": "m", "scale": 2}], t)
    assert out.table.row_count == 1000
    assert time.perf_counter() - start < 20


# ===================== デモA相当フローの通し実行 =====================

FIXTURE = Path(__file__).parent / "fixtures" / "flows" / "monthly_sales.json"


def file(file_id, name, grid, kind="xlsx"):
    return UploadedFile(file_id, name, kind, None, 1, datetime.now(timezone.utc), {"S": RawSheet("S", False, grid)})


SALES = [
    ["売上日", "部署コード", "商品コード", "数量", "金額", "備考"],
    [datetime(2026, 10, 1), "001", "A-1", 2, 3000, None],
    [datetime(2026, 10, 2), "002", "B-1", 1, 980, None],
    [datetime(2026, 10, 3), "001", "B-1", 3, 2940, "架空"],
    [datetime(2026, 10, 4), "002", "A-1", 1, 1500, None],
]
PRODUCTS = [["商品コード", "商品名"], ["A-1", "ノートPC"], ["B-1", "マウス"]]
DEPTS = [["部署コード", "部署名"], ["001", "営業1部"], ["002", "営業2部"]]


def run_demo(sales=SALES):
    flow = parse_flow(json.loads(FIXTURE.read_text(encoding="utf-8")))
    files = {"f1": file("f1", "売上.xlsx", sales), "f2": file("f2", "商品.xlsx", PRODUCTS), "f3": file("f3", "部署.csv", DEPTS, "csv")}
    bindings = {"sales": Binding("sales", "f1"), "products": Binding("products", "f2"), "depts": Binding("depts", "f3")}
    return run_flow(flow, bindings, files)


def test_demo_a_flow_end_to_end():
    ex = run_demo()
    r = ex.result
    assert r.status == "success", [(n.node_id, i.message) for n in r.nodes for i in n.issues if i.severity != "info"]
    by_dept = ex.tables["by_dept"]
    assert by_dept.rows() == [["営業1部", Decimal("5940"), 2], ["営業2部", Decimal("2480"), 2]]
    by_product = ex.tables["by_product"]
    assert by_product.rows() == [["A-1", "ノートPC", Decimal("4500")], ["B-1", "マウス", Decimal("3920")]]
    # 部署別・商品別のどちらの合計も、元の売上合計 8,420 と一致する
    assert sum(by_dept.data["売上合計"]) == sum(by_product.data["売上合計"]) == Decimal("8420")
    assert [o.sheet_name for o in r.outputs] == ["部署別売上", "商品別売上", "明細"]
    assert r.can_export
    # 結合ノードでは金額照合が行われている
    join_issues = {i.code for i in r.nodes[3].issues}
    assert "AMOUNT_MATCHED" in join_issues
    # 同じ入力 → 同じ結果（指紋が一致）
    assert run_demo().result.fingerprints == r.fingerprints


def test_demo_a_flow_stops_on_duplicate_master():
    """商品マスタに同じコードが2行あると、集計の前に止まり、Excelを出力できない。"""
    global PRODUCTS
    original = PRODUCTS
    PRODUCTS = [*original, ["A-1", "ノートPC（旧）"]]
    try:
        r = run_demo().result
    finally:
        PRODUCTS = original
    assert r.status == "failed" and not r.can_export
    join_run = next(n for n in r.nodes if n.node_id == "n4")
    assert join_run.status == "error" and join_run.issues[-1].code == "RELATIONSHIP_MISMATCH"
    assert all(n.status == "skipped" for n in r.nodes[4:])
