"""重複処理・欠損値処理・データ連結・計算ノードのテスト（タスク1-12）。"""

import time
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


def make(cols: dict[str, tuple[str, list]]) -> Table:
    return Table(columns=list(cols), specs={k: ColumnSpec(t) for k, (t, _) in cols.items()}, data={k: list(v) for k, (_, v) in cols.items()})


def sales() -> Table:
    return make(
        {
            "伝票No": ("string", ["S1", "S2", "S2", "S3", "S1", "S4", None, None]),
            "部署": ("string", ["営業1部", "営業2部", "営業2部", None, "営業1部", "営業1部", "営業2部", "営業2部"]),
            "数量": ("integer", [2, 1, 1, None, 3, 4, 1, 2]),
            "単価": ("decimal", [Decimal("1500"), Decimal("980"), Decimal("980"), Decimal("200"), Decimal("1500"), Decimal("0"), Decimal("10"), Decimal("10")]),
        }
    )


def run(node_type: str, params: dict, inputs: list[Table] | None = None, refs: list[str] | None = None):
    inputs = inputs or [sales()]
    refs = refs or [f"in{i}" for i in range(len(inputs))]
    node = NODE.validate_python(
        {"node_id": "x", "node_type": node_type, "node_name": "テスト", "parameters": params, "input_references": refs, "output_reference": "out"}
    )
    return get_handler(node_type)(node, inputs, CTX)


def failure(node_type: str, params: dict, inputs: list[Table] | None = None, refs: list[str] | None = None):
    with pytest.raises(NodeFailure) as e:
        run(node_type, params, inputs, refs)
    return e.value.issue


def issue(out, code):
    return next(i for i in out.issues if i.code == code)


# ===================== 重複処理 =====================


def test_duplicates_detect_does_not_change_data():
    t = sales()
    out = run("duplicates", {"key_columns": ["伝票No"], "mode": "detect"}, [t])
    assert out.table is t  # 検出だけならデータはそのまま
    w = issue(out, "DUPLICATES_FOUND")
    assert w.severity == "warning"
    # S1 2件・S2 2件・空欄 2件（空欄どうしは同じ値とみなす）
    assert w.details["duplicate_rows"] == 6 and w.details["duplicate_keys"] == 3
    assert w.details["examples"][0] == {"key": "S1", "count": 2, "rows": [1, 5]}
    assert issue(out, "BLANK_KEYS").details == {}


def test_duplicates_none_found():
    out = run("duplicates", {"key_columns": ["伝票No", "数量", "部署"], "mode": "detect"})
    assert out.issues[0].code == "DUPLICATES_FOUND"  # S2・営業2部・1 が2行
    t = make({"id": ("string", ["a", "b"])})
    assert run("duplicates", {"key_columns": ["id"], "mode": "detect"}, [t]).issues[0].code == "NO_DUPLICATES"


def test_duplicates_remove_keep_first_and_last():
    first = run("duplicates", {"key_columns": ["伝票No"], "mode": "remove", "keep": "first"})
    assert first.table.data["伝票No"] == ["S1", "S2", "S3", "S4", None]
    assert first.table.data["数量"] == [2, 1, None, 4, 1]  # S1は最初の行（数量2）
    i = issue(first, "DUPLICATES_REMOVED")
    assert i.details["removed"] == 3 and i.details["removed_rows"] == [3, 5, 8]

    last = run("duplicates", {"key_columns": ["伝票No"], "mode": "remove", "keep": "last"})
    assert last.table.data["数量"] == [1, None, 3, 4, 2]  # 残す行の並びは元の順序のまま（S2→S3→S1→S4→空欄）
    assert last.table.data["伝票No"] == ["S2", "S3", "S1", "S4", None]


def test_duplicates_is_fast_on_large_data():
    """10万行・重複キー5万種類でも、すぐに終わること（処理が極端に遅くなる書き方の再発防止）。"""
    n = 100_000
    t = make({"k": ("string", [f"K{i // 2}" for i in range(n)])})
    start = time.perf_counter()
    out = run("duplicates", {"key_columns": ["k"], "mode": "remove"}, [t])
    assert out.table.row_count == n // 2
    run("duplicates", {"key_columns": ["k"], "mode": "detect"}, [t])
    # 通常は1〜2秒。PCの負荷で揺れても落ちないよう余裕を持たせる。
    # 誤った書き方（行ごとに全体を探す）だと数分以上かかるため、この基準でも確実に検出できる
    assert time.perf_counter() - start < 20


# ===================== 欠損値処理 =====================


def test_missing_detect():
    out = run("missing", {"columns": ["伝票No", "部署", "数量"], "mode": "detect"})
    w = issue(out, "MISSING_FOUND")
    assert w.details["columns"]["伝票No"] == {"count": 2, "rows": [7, 8]}
    assert w.details["columns"]["数量"]["rows"] == [4]
    assert "「部署」1件" in w.message
    t = make({"a": ("string", ["x"])})
    assert run("missing", {"columns": ["a"], "mode": "detect"}, [t]).issues[0].code == "NO_MISSING"


def test_missing_fill_uses_column_type():
    out = run("missing", {"columns": ["数量"], "mode": "fill", "fill_value": 0})
    assert out.table.data["数量"] == [2, 1, 1, 0, 3, 4, 1, 2]
    assert isinstance(out.table.data["数量"][3], int)
    assert issue(out, "MISSING_FILLED").details["columns"]["数量"]["count"] == 1
    assert failure("missing", {"columns": ["数量"], "mode": "fill", "fill_value": "不明"}).code == "FILL_VALUE_INVALID"


def test_missing_drop_rows_any_column():
    out = run("missing", {"columns": ["伝票No", "部署"], "mode": "drop_rows"})
    assert out.table.row_count == 5  # 4行目（部署空欄）・7,8行目（伝票No空欄）を除外
    assert issue(out, "MISSING_ROWS_DROPPED").details["removed"] == 3


# ===================== データ連結 =====================


def branch(rows, cols):
    return make({c: (t, [r[i] for r in rows]) for i, (c, t) in enumerate(cols)})


TOKYO = branch([["2026/10/01", "A-1", Decimal("1000")]], [("日付", "string"), ("商品コード", "string"), ("金額", "decimal")])
OSAKA = branch([["B-2", "2026/10/02", 500], ["C-3", "2026/10/03", 700]], [("商品CD", "string"), ("売上日", "string"), ("売上金額", "integer")])


def concat_params(**kw):
    p = {
        "sources": [
            {"reference": "tokyo", "label": "東京"},
            {"reference": "osaka", "label": "大阪", "renames": [{"source": "商品CD", "target": "商品コード"}, {"source": "売上日", "target": "日付"}, {"source": "売上金額", "target": "金額"}]},
        ]
    }
    p.update(kw)
    return p


def test_concat_with_mapping_and_source_column():
    out = run("concat", concat_params(source_column="支店"), [TOKYO, OSAKA], ["tokyo", "osaka"])
    t = out.table
    assert t.columns == ["支店", "日付", "商品コード", "金額"]
    assert t.data["支店"] == ["東京", "大阪", "大阪"]
    assert t.data["商品コード"] == ["A-1", "B-2", "C-3"]
    # 整数と小数は小数にそろえる（値は変わらない）
    assert t.data["金額"] == [Decimal("1000"), Decimal("500"), Decimal("700")]
    assert t.specs["金額"].type == "decimal"
    assert any(i.code == "TYPES_UNIFIED" for i in out.issues)
    assert issue(out, "CONCATENATED").details["rows"] == {"東京": 1, "大阪": 2}


def test_concat_missing_columns_error_by_default_and_allow():
    p = concat_params()
    p["sources"][1]["renames"] = [{"source": "商品CD", "target": "商品コード"}]
    f = failure("concat", p, [TOKYO, OSAKA], ["tokyo", "osaka"])
    assert f.code == "MISSING_COLUMNS_IN_SOURCE"
    assert f.details["lacking"]["大阪"] == ["日付", "金額"]

    p["missing_columns"] = "allow"
    out = run("concat", p, [TOKYO, OSAKA], ["tokyo", "osaka"])
    assert out.table.columns == ["日付", "商品コード", "金額", "売上日", "売上金額"]
    assert out.table.data["日付"] == ["2026/10/01", None, None]
    assert issue(out, "MISSING_COLUMNS_FILLED_BLANK").severity == "warning"


def test_concat_type_mismatch_is_not_silently_converted():
    a = make({"日付": ("date", [date(2026, 10, 1)])})
    b = make({"日付": ("string", ["10月2日"])})
    f = failure("concat", {"sources": [{"reference": "a"}, {"reference": "b"}]}, [a, b], ["a", "b"])
    assert f.code == "TYPE_MISMATCH"


def test_concat_source_column_conflict():
    p = concat_params(source_column="金額")
    assert failure("concat", p, [TOKYO, OSAKA], ["tokyo", "osaka"]).code == "COLUMN_ALREADY_EXISTS"


# ===================== 計算 =====================


def expr_mul():
    return {"kind": "operation", "op": "multiply", "left": {"kind": "column", "column": "数量"}, "right": {"kind": "column", "column": "単価"}}


def test_calculate_basic_and_nulls():
    out = run("calculate", {"output_column": "金額", "expression": expr_mul()})
    assert out.table.data["金額"][:3] == [Decimal("3000"), Decimal("980"), Decimal("980")]
    assert out.table.data["金額"][3] is None  # 数量が空欄 → 結果も空欄（0にしない）
    assert issue(out, "NULL_IN_CALCULATION").details["count"] == 1
    assert out.table.specs["金額"].type == "decimal"


def test_calculate_scale_and_rounding():
    t = make({"a": ("decimal", [Decimal("10")]), "b": ("decimal", [Decimal("3")])})
    e = {"kind": "operation", "op": "divide", "left": {"kind": "column", "column": "a"}, "right": {"kind": "column", "column": "b"}}
    assert run("calculate", {"output_column": "c", "expression": e, "scale": 2}, [t]).table.data["c"] == [Decimal("3.33")]
    assert run("calculate", {"output_column": "c", "expression": e, "scale": 0, "rounding": "up"}, [t]).table.data["c"] == [Decimal("4")]


def test_calculate_zero_division_warn_and_error():
    e = {"kind": "operation", "op": "divide", "left": {"kind": "column", "column": "数量"}, "right": {"kind": "column", "column": "単価"}}
    out = run("calculate", {"output_column": "比", "expression": e})
    w = issue(out, "ZERO_DIVISION_BLANKED")
    assert w.severity == "warning" and w.details["rows"] == [6]
    assert out.table.data["比"][5] is None
    f = failure("calculate", {"output_column": "比", "expression": e, "on_zero_division": "error"})
    assert f.code == "ZERO_DIVISION" and "6行目" in f.cause


def test_calculate_errors():
    assert failure("calculate", {"output_column": "単価", "expression": expr_mul()}).code == "COLUMN_ALREADY_EXISTS"
    bad = {"kind": "operation", "op": "add", "left": {"kind": "column", "column": "部署"}, "right": {"kind": "constant", "value": 1}}
    f = failure("calculate", {"output_column": "x", "expression": bad})
    assert f.code == "EXPRESSION_INVALID" and "数値ではない列" in f.message


def test_inventory_formula_example():
    """デモB相当：理論在庫 ＝ 期首在庫 ＋ 入庫数 − 出庫数、差異 ＝ 理論在庫 − 台帳在庫"""
    t = make(
        {
            "期首在庫": ("integer", [100, 50]),
            "入庫数": ("integer", [30, 0]),
            "出庫数": ("integer", [20, 10]),
            "台帳在庫": ("integer", [110, 45]),
        }
    )
    theory = {
        "kind": "operation",
        "op": "subtract",
        "left": {"kind": "operation", "op": "add", "left": {"kind": "column", "column": "期首在庫"}, "right": {"kind": "column", "column": "入庫数"}},
        "right": {"kind": "column", "column": "出庫数"},
    }
    t2 = run("calculate", {"output_column": "理論在庫", "expression": theory}, [t]).table
    diff = {"kind": "operation", "op": "subtract", "left": {"kind": "column", "column": "理論在庫"}, "right": {"kind": "column", "column": "台帳在庫"}}
    t3 = run("calculate", {"output_column": "差異", "expression": diff}, [t2]).table
    assert t3.data["理論在庫"] == [Decimal("110"), Decimal("40")]
    assert t3.data["差異"] == [Decimal("0"), Decimal("-5")]
