"""デモ用の架空データのテスト（タスク1-0）。

1. 何度生成しても同じ内容になり、リポジトリに保存したファイルが最新であること
2. 仕込んだ問題が、現在の処理エンジンで「毎回同じ件数で」検出されること
   （M1：先月の手順を今月のファイルで再実行 → 問題を検出 → 検証結果で判断、の土台）
"""

import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest

from app.demos.generate import DATA_DIR, generate
from app.engine.nodes.load import Binding
from app.engine.runner import run_flow
from app.files.detect import decode_csv
from app.files.parse import read_csv, read_xlsx
from app.files.service import UploadedFile
from app.flow.validate import parse_flow, validate_structure

FLOW_PATH = Path(__file__).parents[1] / "app" / "demos" / "flows" / "monthly_sales.json"
MANIFEST = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))


def cells(path: Path) -> dict[str, list[list]]:
    wb = openpyxl.load_workbook(path, data_only=True)
    return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}


# ===================== 再現性・保存したファイルが最新か =====================


def test_generation_is_deterministic_and_committed_files_are_up_to_date(tmp_path):
    fresh = generate(tmp_path)
    assert fresh == MANIFEST, "manifest.json が古い可能性があります。python -m app.demos.generate を実行してください"
    for name in MANIFEST["files"]:
        if name.endswith(".xlsx"):
            assert cells(tmp_path / name) == cells(DATA_DIR / name), name
        else:
            assert (tmp_path / name).read_bytes() == (DATA_DIR / name).read_bytes(), name


def test_data_is_fictional_and_documented():
    assert "架空" in MANIFEST["description"]
    assert MANIFEST["files"]["部署マスタ.csv"]["encoding"] == "cp932"


# ===================== 処理エンジンでの検出 =====================


def load_file(name: str, file_id: str) -> UploadedFile:
    data = (DATA_DIR / name).read_bytes()
    if name.endswith(".csv"):
        text, _ = decode_csv(data, name)
        sheets = [read_csv(text, name, 500, 100_000)]
        kind = "csv"
    else:
        sheets = read_xlsx(data, name, 500, 100_000)
        kind = "xlsx"
    return UploadedFile(file_id, name, kind, None, len(data), datetime.now(timezone.utc), {s.name: s for s in sheets})


def run_demo(sales_file: str, products_file: str = "商品マスタ.xlsx", mapping: dict | None = None):
    flow = parse_flow(json.loads(FLOW_PATH.read_text(encoding="utf-8")))
    files = {"f1": load_file(sales_file, "f1"), "f2": load_file(products_file, "f2"), "f3": load_file("部署マスタ.csv", "f3")}
    bindings = {
        "sales": Binding("sales", "f1", column_mapping=mapping or {}),
        "products": Binding("products", "f2"),
        "depts": Binding("depts", "f3"),
    }
    return run_flow(flow, bindings, files)


def node(result, node_id):
    return next(n for n in result.nodes if n.node_id == node_id)


def issue(run, code):
    return next(i for i in run.issues if i.code == code)


def test_demo_flow_is_valid():
    flow = parse_flow(json.loads(FLOW_PATH.read_text(encoding="utf-8")))
    assert validate_structure(flow) == []


def test_last_month_runs_cleanly_with_expected_totals():
    """デモ①の前提：先月のファイルでは問題なく実行でき、集計が正解値と一致する。"""
    ex = run_demo("売上実績_2026-10.xlsx")
    r = ex.result
    assert r.status == "success", [(n.node_id, [i.message for i in n.issues if i.severity != "info"]) for n in r.nodes]
    exp = MANIFEST["expected"]["2026-10"]
    by_dept = dict(zip(ex.tables["by_dept"].data["部署名"], ex.tables["by_dept"].data["売上合計"]))
    assert by_dept == {k: Decimal(v) for k, v in exp["dept_totals"].items()}
    assert sum(ex.tables["by_category"].data["売上合計"]) == exp["total_amount"]
    assert ex.tables["sales_full"].row_count == MANIFEST["files"]["売上実績_2026-10.xlsx"]["rows"]


def test_this_month_renamed_column_is_detected_with_candidate():
    """デモ②：今月のファイルでは「売上金額」が「金額」に変わっている → 実行前に止め、候補を示す。"""
    r = run_demo("売上実績_2026-11.xlsx").result
    assert r.status == "failed"
    i = node(r, "n1").issues[-1]
    assert i.code == "MISSING_COLUMNS"
    assert i.details["missing"] == ["売上金額"]
    assert "金額" in i.details["candidates"]["売上金額"]


def test_this_month_with_mapping_detects_planted_problems_every_time():
    """列の対応付け（金額→売上金額）を承認すると、列順の違いに関係なく再実行でき、
    仕込んだ問題（空欄・マスタにないコード・末尾の空白）が決まった件数で検出される。"""
    p = MANIFEST["planted_2026_11"]
    ex = run_demo("売上実績_2026-11.xlsx", mapping={"金額": "売上金額"})
    r = ex.result
    assert r.status == "warning"
    unmatched = issue(node(r, "n4"), "UNMATCHED_RECORDS").details
    # 結合の段階の行番号（データの何行目か）に1を足すと、Excel上の行番号になる
    rows = sorted(rec["row"] + 1 for rec in unmatched["records"])
    assert rows == sorted(p["unknown_product_rows"] + p["trailing_space_code"]["rows"])
    assert unmatched["blank_key_rows"] == len(p["blank_product_code_rows"])
    assert set(unmatched["unmatched_keys"]) == {*p["unknown_product_codes"], p["trailing_space_code"]["value"]}
    # 末尾の空白は「空白を除けば一致」と原因候補が示される
    assert unmatched["cause_candidates"][0]["code"] == "TRIM"
    # 追加された列（担当者）は処理を止めない。金額は結合の前後で一致する
    assert "AMOUNT_MATCHED" in {i.code for i in node(r, "n4").issues}
    total = sum(ex.tables["by_category"].data["売上合計"])
    assert total == MANIFEST["expected"]["2026-11"]["total_amount"]


def test_this_month_out_of_period_date_is_present_for_phase3():
    """対象期間外（12月）の日付が仕込まれていること（期間の検証は Phase 3 で追加する）。"""
    grid = read_xlsx((DATA_DIR / "売上実績_2026-11.xlsx").read_bytes(), "x", 500, 10_000)[0].grid
    row = MANIFEST["planted_2026_11"]["out_of_period_rows"][0]
    assert grid[row - 1][1] == datetime(2026, 12, 1)


def test_duplicate_master_is_critical():
    """重大の判定のデモ：商品マスタに同じ商品コードが2行あると、集計の前に止まる。"""
    r = run_demo("売上実績_2026-10.xlsx", products_file="商品マスタ_重複あり.xlsx").result
    assert r.status == "failed" and not r.can_export
    i = node(r, "n4").issues[-1]
    assert i.code == "RELATIONSHIP_MISMATCH"
    assert i.details["right_duplicates"] == [{"key": "P-1003", "count": 2}]


@pytest.mark.parametrize("name", ["売上実績_2026-10.xlsx", "売上実績_2026-11.xlsx", "商品マスタ.xlsx"])
def test_files_upload_through_the_real_validation(name):
    """デモのファイルが、利用者のファイルと同じ受け入れ検査（形式の判定）を通ること。"""
    from app.files.detect import detect_kind

    assert detect_kind((DATA_DIR / name).read_bytes(), name, 100 * 1024 * 1024) == "xlsx"
