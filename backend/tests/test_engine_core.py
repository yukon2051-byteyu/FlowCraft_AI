"""処理エンジン本体のテスト（タスク1-10）。

数値・丸め／型変換／計算式（evalを使わない）／読込ノード／実行の流れ・停止・再現性
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from app.engine.convert import convert_value
from app.engine.expression import ExpressionError, evaluate
from app.engine.nodes.load import Binding
from app.engine.numeric import from_float, quantize
from app.engine.registry import registered_types
from app.engine.runner import RunLimits, run_flow
from app.engine.table import ColumnSpec, Table
from app.files.parse import RawSheet
from app.files.service import UploadedFile
from app.flow.schema import BinaryOperation, ColumnOperand, ConstantOperand
from app.flow.validate import parse_flow

# ===================== 数値・丸め =====================


def test_float_error_does_not_leak():
    """0.1 + 0.2 が 0.3 ちょうどになること（float だと 0.30000000000000004）。"""
    assert from_float(0.1) + from_float(0.2) == Decimal("0.3")
    assert 0.1 + 0.2 != 0.3  # 参考：floatでは一致しない


@pytest.mark.parametrize(
    ("value", "mode", "expected"),
    [
        ("2.5", "half_up", "3"),
        ("-2.5", "half_up", "-3"),
        ("2.5", "half_even", "2"),
        ("3.5", "half_even", "4"),
        ("2.7", "down", "2"),
        ("-2.7", "down", "-2"),
        ("2.1", "up", "3"),
        ("-2.1", "up", "-3"),
        ("2.0", "up", "2"),
    ],
)
def test_rounding_modes(value, mode, expected):
    assert quantize(Decimal(value), 0, mode) == Decimal(expected)


def test_quantize_scale():
    assert str(quantize(Decimal("1234.5678"), 2)) == "1234.57"
    assert str(quantize(Decimal("1"), 2)) == "1.00"


# ===================== 型変換 =====================


@pytest.mark.parametrize(
    ("raw", "to", "expected", "ok"),
    [
        ("00123", "string", "00123", True),
        (123, "string", "123", True),
        (100.0, "string", "100", True),
        ("00123", "integer", 123, True),  # 利用者が整数を選んだ場合のみ
        ("1,234,567", "integer", 1234567, True),
        ("1,23", "integer", None, False),  # 桁区切りの位置が不正
        (12.5, "integer", None, False),  # 小数を黙って切り捨てない
        (True, "integer", None, False),  # TRUE を 1 にしない
        ("１２３", "integer", None, False),  # 全角数字は変換しない（報告する）
        ("1,234.50", "decimal", Decimal("1234.50"), True),
        (0.1, "decimal", Decimal("0.1"), True),
        ("¥1,000", "decimal", None, False),  # 通貨記号を黙って取り除かない
        ("12%", "decimal", None, False),
        ("NaN", "decimal", None, False),
        ("Infinity", "decimal", None, False),
        (float("nan"), "decimal", None, False),
        ("2026/10/01", "date", date(2026, 10, 1), True),
        ("2026-10-01", "date", date(2026, 10, 1), True),
        (datetime(2026, 10, 1, 9, 30), "date", date(2026, 10, 1), True),
        ("2026/02/30", "date", None, False),  # 存在しない日付
        ("10/01/2026", "date", None, False),  # 既定にない書式
        ("TRUE", "boolean", True, True),
        ("いいえ", "boolean", False, True),
        ("maybe", "boolean", None, False),
        (None, "integer", None, True),  # 欠損は欠損のまま（失敗ではない）
        ("   ", "decimal", None, True),
    ],
)
def test_convert_value(raw, to, expected, ok):
    assert convert_value(raw, to) == (expected, ok)


def test_convert_with_scale_and_rounding():
    assert convert_value("10.125", "decimal", scale=2) == (Decimal("10.13"), True)
    assert convert_value("10.125", "decimal", scale=2, rounding="half_even") == (Decimal("10.12"), True)


def test_convert_with_custom_date_format():
    assert convert_value("01.10.2026", "date", date_format="%d.%m.%Y") == (date(2026, 10, 1), True)


# ===================== 計算式 =====================


def col(name):
    return ColumnOperand(column=name)


def const(v):
    return ConstantOperand(value=v)


def op(o, left, right):
    return BinaryOperation(op=o, left=left, right=right)


DATA = {"数量": [2, 3, None, 4], "単価": [Decimal("100.5"), Decimal("200"), Decimal("10"), Decimal("0")], "商品名": ["A", "B", "C", "D"]}
NUMERIC = {"数量", "単価"}


def test_expression_arithmetic():
    r = evaluate(op("multiply", col("数量"), col("単価")), DATA, NUMERIC)
    assert r.values == [Decimal("201.0"), Decimal("600"), None, Decimal("0")]
    assert r.null_rows == 1  # 空欄は0とみなさず、結果も空欄


def test_expression_nested_and_constants():
    # (数量 + 1) × 単価 − 10
    expr = op("subtract", op("multiply", op("add", col("数量"), const(1)), col("単価")), const(10))
    assert evaluate(expr, DATA, NUMERIC).values[:2] == [Decimal("291.5"), Decimal("790")]


def test_ratio_percent():
    r = evaluate(op("ratio_percent", const(1), const(3)), {"x": [0]}, {"x"})
    assert str(r.values[0])[:8] == "33.33333"


def test_zero_division_is_recorded_not_crashed():
    r = evaluate(op("divide", col("数量"), col("単価")), DATA, NUMERIC)
    assert r.values[3] is None
    assert r.zero_division_rows == [3]


def test_expression_rejects_text_column():
    with pytest.raises(ExpressionError, match="数値ではない列"):
        evaluate(op("add", col("商品名"), const(1)), DATA, NUMERIC)


def test_expression_rejects_unknown_column():
    with pytest.raises(ExpressionError, match="列がありません"):
        evaluate(op("add", col("存在しない"), const(1)), DATA, NUMERIC)


def test_expression_depth_guard():
    e = col("数量")
    for _ in range(6):
        e = op("add", e, const(1))
    with pytest.raises(ExpressionError, match="5段まで"):
        evaluate(e, DATA, NUMERIC)


def test_engine_source_does_not_use_eval_or_exec():
    """エンジンのソースコードに eval / exec / compile（組み込み関数）や外部コマンド実行がないことを、
    文字列検索ではなく構文解析（ast）で確認する（re.compile などの誤検出を避けるため）。"""
    import ast

    root = Path(__file__).parents[1] / "app" / "engine"
    for path in root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in ("eval", "exec", "compile", "__import__"), f"{path.name}:{node.lineno} {node.func.id}"
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                assert (node.value.id, node.attr) not in (("os", "system"), ("os", "popen")), f"{path.name}:{node.lineno}"
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] + ([node.module] if isinstance(node, ast.ImportFrom) and node.module else [])
                assert not {"subprocess", "pickle", "marshal"} & set(names), f"{path.name}:{node.lineno}"


def test_full_width_digits_are_reported_not_converted():
    """全角数字「１２３」を黙って 123 にしない（正規表現の数字記号や int() は全角も受け付けるため要注意）。"""
    assert convert_value("１２３", "decimal") == (None, False)
    assert convert_value("１,２３４", "integer") == (None, False)
    from app.files.profile import _classify

    assert _classify("１２３") == "string"


# ===================== 表 =====================


def test_table_rejects_inconsistent_columns():
    with pytest.raises(ValueError):
        Table(columns=["a"], specs={"a": ColumnSpec("string")}, data={"a": [1], "b": [2]})
    with pytest.raises(ValueError):
        Table(columns=["a", "b"], specs={"a": ColumnSpec("string"), "b": ColumnSpec("string")}, data={"a": [1], "b": [1, 2]})


def test_fingerprint_distinguishes_types_and_values():
    def t(v, typ="string"):
        return Table(columns=["a"], specs={"a": ColumnSpec(typ)}, data={"a": [v]})

    assert t("1").fingerprint() == t("1").fingerprint()
    assert t("1").fingerprint() != t(1, "integer").fingerprint()  # 文字列"1"と整数1は別物
    assert t(Decimal("1.0"), "decimal").fingerprint() != t(Decimal("1.00"), "decimal").fingerprint()
    assert t(None).fingerprint() != t("").fingerprint()


# ===================== 読込ノード・実行 =====================

SALES_GRID = [
    ["売上日", "商品コード", "数量", "金額", "備考", "担当者"],
    [datetime(2026, 10, 1), "00123", 2, 3000.5, None, "山田"],
    [datetime(2026, 10, 2), "A-2040", 1, 980, "架空", "佐藤"],
    ["2026/10/03", "00123", "5", "7,500", None, "鈴木"],
]


def make_file(grid, file_id="f1", name="売上.xlsx", sheet="売上", kind="xlsx"):
    return UploadedFile(
        file_id=file_id,
        filename=name,
        kind=kind,
        encoding=None,
        size_bytes=1,
        uploaded_at=datetime.now(timezone.utc),
        sheets={sheet: RawSheet(name=sheet, hidden=False, grid=grid)},
    )


def make_flow(columns=None, extra_nodes=None, statuses="confirmed"):
    columns = columns or [
        {"name": "売上日", "type": "date"},
        {"name": "商品コード", "type": "string"},
        {"name": "数量", "type": "integer"},
        {"name": "金額", "type": "decimal", "scale": 1},
        {"name": "備考", "type": "string", "required": False},
    ]
    nodes = [
        {"node_id": "n1", "node_type": "load", "node_name": "売上を読む", "parameters": {"input_id": "sales"}, "output_reference": "sales", "confirmation_status": statuses},
        *(extra_nodes or []),
        {
            "node_id": "out",
            "node_type": "output",
            "node_name": "出力",
            "parameters": {"sheets": [{"reference": "sales", "sheet_name": "明細"}]},
            "input_references": ["sales"],
            "confirmation_status": "confirmed",
        },
    ]
    return parse_flow(
        {
            "schema_version": "1.0",
            "engine_version": "0.1.0",
            "flow_id": "6f1c2b9e-3d4a-4c1e-9a8b-2f6e5d4c3b2a",
            "flow_version": 1,
            "flow_name": "テスト",
            "created_at": "2026-11-12T10:00:00+09:00",
            "updated_at": "2026-11-12T10:00:00+09:00",
            "input_definitions": [{"input_id": "sales", "label": "売上実績", "file_kind": "xlsx", "columns": columns}],
            "nodes": nodes,
        }
    )


def run(flow, grid=SALES_GRID, mapping=None, **kw):
    files = {"f1": make_file(grid)}
    bindings = {"sales": Binding(input_id="sales", file_id="f1", column_mapping=mapping or {})}
    return run_flow(flow, bindings, files, **kw)


def test_registered_nodes_are_whitelisted():
    assert set(registered_types()) >= {"load", "output"}


def test_load_converts_types_without_losing_codes():
    ex = run(make_flow())
    r = ex.result
    assert r.status == "success", [i.message for n in r.nodes for i in n.issues]
    t = ex.tables["sales"]
    assert t.data["商品コード"] == ["00123", "A-2040", "00123"]
    assert t.data["売上日"] == [date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)]
    assert t.data["数量"] == [2, 1, 5]
    assert t.data["金額"] == [Decimal("3000.5"), Decimal("980.0"), Decimal("7500.0")]
    # 入力定義にない列（使わない列）は読み込まず、読み込まなかったことを記録する
    assert "担当者" not in t.columns
    assert any(i.code == "COLUMNS_NOT_LOADED" and i.details["columns"] == ["担当者"] for i in r.nodes[0].issues)
    assert r.nodes[0].output_rows == 3
    assert r.can_export
    assert [(o.sheet_name, o.reference) for o in r.outputs] == [("明細", "sales")]


def test_conversion_failure_stops_with_row_numbers():
    grid = [row[:] for row in SALES_GRID] + [["2026/10/04", "B-1", "三個", "¥500", None, "高橋"]]
    ex = run(make_flow(), grid=grid)
    r = ex.result
    assert r.status == "failed"
    assert not r.can_export
    issue = r.nodes[0].issues[-1]
    assert issue.code == "TYPE_CONVERSION_FAILED"
    f = issue.details["failures"]
    assert f["数量"]["count"] == 1 and f["数量"]["examples"] == [{"row": 5, "value": "三個"}]  # Excelの5行目
    assert f["金額"]["examples"][0]["value"] == "¥500"
    assert "5行目「三個」" in issue.cause
    assert r.nodes[1].status == "skipped"  # 以降は実行しない


def test_missing_required_column_suggests_similar_name():
    grid = [["売上日", "商品コード", "数量", "売上金額"], [datetime(2026, 10, 1), "A", 1, 100]]
    r = run(make_flow(), grid=grid).result
    issue = r.nodes[0].issues[-1]
    assert issue.code == "MISSING_COLUMNS"
    assert issue.details["missing"] == ["金額"]
    assert "売上金額" in issue.details["candidates"]["金額"]


def test_column_mapping_fixes_renamed_column():
    grid = [["売上日", "商品コード", "数量", "売上金額"], [datetime(2026, 10, 1), "A", 1, 100]]
    ex = run(make_flow(), grid=grid, mapping={"売上金額": "金額"})
    assert ex.result.status == "success"
    t = ex.tables["sales"]
    assert t.data["金額"] == [Decimal("100.0")]
    assert t.data["備考"] == [None]  # 任意列はファイルになくても空欄の列として追加
    assert any(i.code == "OPTIONAL_COLUMN_ADDED" for i in ex.result.nodes[0].issues)


def test_mapping_to_existing_column_is_rejected():
    r = run(make_flow(), mapping={"担当者": "商品コード"}).result
    assert r.nodes[0].issues[-1].code == "MAPPING_CONFLICT"


def test_unassigned_input():
    flow = make_flow()
    r = run_flow(flow, {}, {"f1": make_file(SALES_GRID)}).result
    assert r.nodes[0].issues[-1].code == "INPUT_NOT_ASSIGNED"


def test_unconfirmed_flow_is_not_executed_but_preview_runs():
    flow = make_flow(statuses="ai_proposed")
    r = run(flow).result
    assert r.status == "failed"
    assert [i.code for i in r.flow_issues] == ["NODE_NOT_CONFIRMED"]
    assert all(n.status == "skipped" for n in r.nodes)
    # プレビューでは未確定でも実行できる（成果物にはしない）
    assert run(flow, require_confirmed=False).result.status == "success"


def test_unregistered_node_stops_safely(monkeypatch):
    """ホワイトリストに登録されていない処理は実行せず、明確なエラーで止まる（二重の安全装置）。"""
    import app.engine.runner as runner_mod

    real = runner_mod.get_handler
    monkeypatch.setattr(runner_mod, "get_handler", lambda t: None if t == "sort" else real(t))
    extra = [
        {
            "node_id": "s1",
            "node_type": "sort",
            "node_name": "並べ替え",
            "parameters": {"keys": [{"column": "金額"}]},
            "input_references": ["sales"],
            "output_reference": "sorted",
            "confirmation_status": "confirmed",
        }
    ]
    r = run(make_flow(extra_nodes=extra)).result
    assert r.status == "failed"
    assert r.nodes[1].issues[-1].code == "NODE_NOT_AVAILABLE"
    assert r.nodes[2].status == "skipped"


def test_row_limit_stops_execution():
    grid = [SALES_GRID[0]] + [[datetime(2026, 10, 1), f"C{i}", 1, 1, None, "x"] for i in range(20)]
    r = run(make_flow(), grid=grid, limits=RunLimits(max_rows=10)).result
    assert r.status == "failed"
    assert r.nodes[0].issues[-1].code == "TOO_MANY_ROWS"


def test_same_input_same_flow_same_fingerprint():
    """同じ入力・同じフロー・同じエンジンなら、何度実行しても同じ結果（最優先①）。"""
    a = run(make_flow()).result.fingerprints
    b = run(make_flow()).result.fingerprints
    assert a == b and a["sales"]
    grid = [row[:] for row in SALES_GRID]
    grid[1][3] = 3000.6  # 1つでも値が違えば指紋も変わる
    assert run(make_flow(), grid=grid).result.fingerprints["sales"] != a["sales"]


def test_input_tables_are_not_modified():
    """読込に使った元データ（アップロードされたファイル）を書き換えないこと。"""
    files = {"f1": make_file([row[:] for row in SALES_GRID])}
    before = [row[:] for row in files["f1"].sheets["売上"].grid]
    run_flow(make_flow(), {"sales": Binding(input_id="sales", file_id="f1")}, files)
    assert files["f1"].sheets["売上"].grid == before


def test_pipeline_load_filter_sort_select_output():
    """読込 → 抽出 → 並べ替え → 列の抽出 → 出力 を通しで実行する。"""

    def step(node_id, node_type, params, src, dst):
        return {
            "node_id": node_id,
            "node_type": node_type,
            "node_name": node_id,
            "parameters": params,
            "input_references": [src],
            "output_reference": dst,
            "confirmation_status": "confirmed",
        }

    extra = [
        step("f", "filter", {"condition": {"kind": "condition", "column": "金額", "operator": "ge", "value": 1000}}, "sales", "big"),
        step("s", "sort", {"keys": [{"column": "金額", "ascending": False}]}, "big", "sorted"),
        step("c", "select_columns", {"columns": ["商品コード", "金額"]}, "sorted", "final"),
    ]
    flow = make_flow(extra_nodes=extra)
    out = flow.nodes[-1]
    out.input_references = ["final"]
    out.parameters.sheets[0].reference = "final"
    ex = run(flow)
    r = ex.result
    assert r.status == "success", [i.message for n in r.nodes for i in n.issues]
    assert ex.tables["final"].rows() == [["00123", Decimal("7500.0")], ["00123", Decimal("3000.5")]]
    assert [n.output_rows for n in r.nodes[:4]] == [3, 2, 2, 2]
    # 「担当者」は入力定義にないため、読み込み時点で除かれている
    assert r.nodes[3].removed_columns == ["売上日", "数量", "備考"]
    # 同じ入力なら最終結果の指紋も毎回同じ
    assert run(flow).result.fingerprints["final"] == r.fingerprints["final"]
