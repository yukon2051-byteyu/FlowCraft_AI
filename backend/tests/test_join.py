"""データ結合ノードのテスト（タスク1-13・仕様17.5）。期待値はすべて手計算した小さな表で固定する。

売上（左）：
  行 伝票 商品コード 金額
  1  S1   A          1000
  2  S2   B           500
  3  S3   A          2000
  4  S4   C-3300      300   ← マスタは "C-3300 "（末尾に空白）
  5  S5   (空欄)      100   ← キーが空欄
  6  S6   Z           50    ← マスタにない
"""

import time
from decimal import Decimal

import pytest
from pydantic import TypeAdapter

from app.engine.registry import NodeContext, get_handler
from app.engine.result import NodeFailure
from app.engine.table import ColumnSpec, Table
from app.flow.schema import Node, ValidationRules

NODE = TypeAdapter(Node)


def ctx(tolerance="0"):
    return NodeContext(bindings={}, files={}, input_definitions={}, validation_rules=ValidationRules(amount_tolerance=Decimal(tolerance)), max_rows=500_000)


def make(cols: dict[str, tuple[str, list]]) -> Table:
    return Table(columns=list(cols), specs={k: ColumnSpec(t) for k, (t, _) in cols.items()}, data={k: list(v) for k, (_, v) in cols.items()})


def sales():
    return make(
        {
            "伝票": ("string", ["S1", "S2", "S3", "S4", "S5", "S6"]),
            "商品コード": ("string", ["A", "B", "A", "C-3300", None, "Z"]),
            "金額": ("decimal", [Decimal(x) for x in ("1000", "500", "2000", "300", "100", "50")]),
        }
    )


def products(extra_rows=()):
    rows = [("A", "ノートPC", "PC"), ("B", "マウス", "周辺"), ("C-3300 ", "ケーブル", "周辺"), ("D", "未使用品", "周辺"), *extra_rows]
    return make({"商品コード": ("string", [r[0] for r in rows]), "商品名": ("string", [r[1] for r in rows]), "分類": ("string", [r[2] for r in rows])})


def join(left, right, ctx_=None, **params):
    p = {"keys": [{"left": "商品コード", "right": "商品コード"}], "how": "left", "expected_relationship": "many_to_one"}
    p.update(params)
    node = NODE.validate_python(
        {"node_id": "j", "node_type": "join", "node_name": "商品マスタと結合", "parameters": p, "input_references": ["sales", "products"], "output_reference": "out"}
    )
    return get_handler("join")(node, [left, right], ctx_ or ctx())


def fails(left, right, **params):
    with pytest.raises(NodeFailure) as e:
        join(left, right, **params)
    return e.value.issue


def issue(out, code):
    return next(i for i in out.issues if i.code == code)


# ===================== 多対1（売上 × 商品マスタ）：最も一般的なケース =====================


def test_many_to_one_left_join_keeps_all_rows_and_order():
    out = join(sales(), products())
    t = out.table
    assert t.columns == ["伝票", "商品コード", "金額", "商品名", "分類"]
    assert t.data["伝票"] == ["S1", "S2", "S3", "S4", "S5", "S6"]  # 左の行数・順序をそのまま保つ
    assert t.data["商品名"] == ["ノートPC", "マウス", "ノートPC", None, None, None]
    j = issue(out, "JOINED").details
    assert (j["actual_relationship"], j["output_rows"], j["multiplied_rows"]) == ("many_to_one", 6, 0)
    assert (j["matched_left_rows"], j["left_unmatched_rows"], j["left_blank_key_rows"]) == (3, 3, 1)


def test_amount_is_preserved_in_left_join():
    out = join(sales(), products(), check_amount_columns=["金額"])
    a = issue(out, "AMOUNT_MATCHED").details
    assert a["before"] == a["after"] == "3950"


def test_unmatched_records_with_cause_candidates():
    out = join(sales(), products())
    w = issue(out, "UNMATCHED_RECORDS")
    assert w.severity == "warning"
    d = w.details
    assert d["side"] == "左" and d["unmatched_rows"] == 2  # C-3300 と Z（空欄は別に数える）
    assert d["unmatched_keys"] == ["C-3300", "Z"]
    assert d["blank_key_rows"] == 1
    assert [r["row"] for r in d["records"]] == [4, 6]
    # 「C-3300」は、マスタの「C-3300 」と前後の空白を除くと一致する
    assert d["cause_candidates"][0]["code"] == "TRIM" and d["cause_candidates"][0]["examples"] == ["C-3300"]
    assert "空白" in w.how_to_fix
    # マスタ側で使われなかった行（D と "C-3300 "）は情報として示す
    assert issue(out, "UNUSED_RECORDS").details["unmatched_rows"] == 2


def test_trim_normalization_matches_without_changing_data():
    out = join(sales(), products(), key_normalization="trim")
    t = out.table
    assert t.data["商品名"][3] == "ケーブル"
    assert t.data["商品コード"][3] == "C-3300"  # データ自体は変えない（左の値のまま）
    assert issue(out, "UNMATCHED_RECORDS").details["unmatched_keys"] == ["Z"]


def test_unmatched_policy_error():
    f = fails(sales(), products(), unmatched_policy="error")
    assert f.code == "UNMATCHED_RECORDS"


@pytest.mark.parametrize(
    ("left_code", "right_code", "cause"),
    [("ａ-１", "a-1", "WIDTH"), ("ABC", "abc", "CASE"), ("123", "00123", "LEADING_ZERO")],
)
def test_other_cause_candidates(left_code, right_code, cause):
    left = make({"商品コード": ("string", [left_code]), "金額": ("integer", [1])})
    right = make({"商品コード": ("string", [right_code]), "商品名": ("string", ["x"])})
    out = join(left, right)
    assert issue(out, "UNMATCHED_RECORDS").details["cause_candidates"][0]["code"] == cause


# ===================== 関係の検証（想定と違えば止める） =====================


def test_duplicate_master_key_is_detected_before_join():
    """商品マスタに同じコードが2行あると、売上が2倍に数えられてしまう → 結合前に止める。"""
    dup = products(extra_rows=[("A", "ノートPC（旧）", "PC")])
    f = fails(sales(), dup)
    assert f.code == "RELATIONSHIP_MISMATCH"
    assert (f.details["expected"], f.details["actual"]) == ("many_to_one", "many_to_many")
    assert f.details["right_duplicates"] == [{"key": "A", "count": 2}]
    assert "金額が重複" in f.cause


def test_one_to_one_requires_both_unique():
    left = make({"商品コード": ("string", ["A", "A"]), "金額": ("integer", [1, 2])})
    f = fails(left, products(), expected_relationship="one_to_one")
    assert f.details["actual"] == "many_to_one"
    assert f.details["left_duplicates"] == [{"key": "A", "count": 2}]


def test_one_to_one():
    left = make({"商品コード": ("string", ["A", "B"]), "在庫": ("integer", [5, 7])})
    out = join(left, products(), expected_relationship="one_to_one")
    assert out.table.data["商品名"] == ["ノートPC", "マウス"]
    assert issue(out, "JOINED").details["actual_relationship"] == "one_to_one"


def test_one_to_many_grows_rows_and_is_reported():
    """1対多（部署 × 売上明細）：行が増えるのは想定どおり。増えた行数を必ず示す。"""
    depts = make({"部署コード": ("string", ["D1", "D2"]), "予算": ("integer", [100, 200])})
    lines = make({"部署コード": ("string", ["D1", "D1", "D1", "D2"]), "金額": ("integer", [10, 20, 30, 40])})
    out = join(depts, lines, keys=[{"left": "部署コード", "right": "部署コード"}], expected_relationship="one_to_many", check_amount_columns=["予算"])
    assert out.table.row_count == 4
    assert out.table.data["予算"] == [100, 100, 100, 200]
    assert issue(out, "ROWS_MULTIPLIED").details["multiplied_rows"] == 2
    # 予算は複製されて合計が変わるのが正常 → 一致判定はせず、変化として示す
    a = issue(out, "AMOUNT_CHANGED").details
    assert (a["before"], a["after"]) == ("300", "500")


def test_many_to_many_only_when_explicitly_allowed():
    left = make({"k": ("string", ["x", "x"]), "l": ("integer", [1, 2])})
    right = make({"k": ("string", ["x", "x", "x"]), "r": ("integer", [7, 8, 9])})
    keys = [{"left": "k", "right": "k"}]
    assert fails(left, right, keys=keys, expected_relationship="many_to_one").code == "RELATIONSHIP_MISMATCH"
    out = join(left, right, keys=keys, expected_relationship="many_to_many")
    assert out.table.row_count == 6  # 2 × 3
    assert out.table.rows() == [["x", 1, 7], ["x", 1, 8], ["x", 1, 9], ["x", 2, 7], ["x", 2, 8], ["x", 2, 9]]
    assert issue(out, "JOINED").details["multiplied_rows"] == 4


# ===================== 結合方式 =====================


def test_inner_join_reports_excluded_amount():
    out = join(sales(), products(), how="inner", check_amount_columns=["金額"])
    assert out.table.data["伝票"] == ["S1", "S2", "S3"]
    w = issue(out, "AMOUNT_EXCLUDED_BY_INNER_JOIN")
    assert (w.details["before"], w.details["after"]) == ("3950", "3500")
    assert "450" in w.message  # 照合できなかった S4・S5・S6 の金額
    assert "結果に含まれません" in issue(out, "UNMATCHED_RECORDS").message


def test_right_join_keeps_master_rows_in_master_order():
    out = join(sales(), products(), how="right", expected_relationship="many_to_one")
    t = out.table
    # 右（商品マスタ）の順：A（S1,S3）→ B（S2）→ "C-3300 "（未照合）→ D（未照合）
    assert t.data["伝票"] == ["S1", "S3", "S2", None, None]
    assert t.data["商品コード"] == ["A", "A", "B", "C-3300 ", "D"]  # 右だけの行はキーを右の値で埋める
    assert issue(out, "UNMATCHED_RECORDS").details["side"] == "右"


def test_outer_join_counts():
    out = join(sales(), products(), how="outer", check_amount_columns=["金額"])
    t = out.table
    assert t.row_count == 8  # 照合3 + 左だけ3 + 右だけ2
    assert t.data["商品コード"][-2:] == ["C-3300 ", "D"]
    assert issue(out, "AMOUNT_MATCHED").details["after"] == "3950"
    assert [i.details["side"] for i in out.issues if i.code == "UNMATCHED_RECORDS"] == ["左", "右"]


# ===================== キー・列 =====================


def test_null_keys_never_match_each_other():
    """空欄どうしを一致とみなさない（pandas の既定の結合では一致してしまう点に注意）。"""
    left = make({"k": ("string", [None, "a"]), "v": ("integer", [1, 2])})
    right = make({"k": ("string", [None, "a"]), "w": ("integer", [9, 8])})
    out = join(left, right, keys=[{"left": "k", "right": "k"}], expected_relationship="one_to_one")
    assert out.table.data["w"] == [None, 8]
    j = issue(out, "JOINED").details
    assert (j["left_blank_key_rows"], j["right_blank_key_rows"]) == (1, 1)


def test_multi_key_join():
    left = make({"年": ("integer", [2026, 2026, 2025]), "月": ("integer", [10, 11, 10]), "売上": ("integer", [1, 2, 3])})
    right = make({"年": ("integer", [2026, 2025]), "月": ("integer", [10, 10]), "目標": ("integer", [100, 90])})
    out = join(left, right, keys=[{"left": "年", "right": "年"}, {"left": "月", "right": "月"}])
    assert out.table.data["目標"] == [100, None, 90]
    assert issue(out, "UNMATCHED_RECORDS").details["unmatched_keys"] == ["2026 / 11"]


def test_key_type_mismatch_is_rejected():
    left = make({"商品コード": ("integer", [123])})
    right = make({"商品コード": ("string", ["00123"])})
    f = fails(left, right)
    assert f.code == "KEY_TYPE_MISMATCH" and "00123" in f.cause


def test_integer_and_decimal_keys_are_compatible():
    left = make({"k": ("integer", [1, 2])})
    right = make({"k": ("decimal", [Decimal("1"), Decimal("3")]), "v": ("string", ["a", "c"])})
    out = join(left, right, keys=[{"left": "k", "right": "k"}], how="outer")
    assert out.table.data["v"] == ["a", None, "c"]
    assert out.table.data["k"] == [Decimal(1), Decimal(2), Decimal(3)]
    assert out.table.specs["k"].type == "decimal"


def test_same_column_names_get_suffix_and_different_key_names():
    left = make({"コード": ("string", ["A"]), "名称": ("string", ["売上A"])})
    right = make({"商品CD": ("string", ["A"]), "名称": ("string", ["マスタA"])})
    out = join(left, right, keys=[{"left": "コード", "right": "商品CD"}])
    assert out.table.columns == ["コード", "名称", "名称_右"]
    assert out.table.rows() == [["A", "売上A", "マスタA"]]
    clash = make({"コード": ("string", ["A"]), "名称": ("string", ["x"]), "名称_右": ("string", ["y"])})
    assert fails(clash, right, keys=[{"left": "コード", "right": "商品CD"}]).code == "COLUMN_NAME_CONFLICT"


def test_missing_key_column():
    f = fails(sales(), products(), keys=[{"left": "商品CD", "right": "商品コード"}])
    assert f.code == "COLUMN_NOT_FOUND"


def test_amount_column_must_be_numeric():
    assert fails(sales(), products(), check_amount_columns=["伝票"]).code == "AMOUNT_COLUMN_NOT_NUMERIC"


def test_inputs_are_not_modified():
    left, right = sales(), products()
    lb, rb = {k: list(v) for k, v in left.data.items()}, {k: list(v) for k, v in right.data.items()}
    join(left, right, how="outer", key_normalization="trim")
    assert left.data == lb and right.data == rb


# ===================== 規模・再現性 =====================


def test_large_join_is_fast_and_deterministic():
    """10万行 × マスタ1万行（未照合を含む）でも、すぐに終わり、毎回同じ結果になる。"""
    n, m = 100_000, 10_000
    left = make({"k": ("string", [f"P{i % (m + 500):05d}" for i in range(n)]), "amt": ("integer", [i % 1000 for i in range(n)])})
    right = make({"k": ("string", [f"P{i:05d}" for i in range(m)]), "name": ("string", [f"商品{i}" for i in range(m)])})
    start = time.perf_counter()
    out1 = join(left, right, keys=[{"left": "k", "right": "k"}], check_amount_columns=["amt"])
    elapsed = time.perf_counter() - start
    assert out1.table.row_count == n
    assert issue(out1, "UNMATCHED_RECORDS").details["unmatched_key_count"] == 500
    assert elapsed < 20, f"{elapsed:.1f}秒"
    out2 = join(left, right, keys=[{"left": "k", "right": "k"}], check_amount_columns=["amt"])
    assert out1.table.fingerprint() == out2.table.fingerprint()
