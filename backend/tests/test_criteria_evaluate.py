"""タスク2-2：完了基準の評価のテスト。

期待値は、エンジンを通さずに openpyxl で元のファイルを読んで数えた値と、manifest.json の正解値（手計算と同じ扱い）を使う。
重点：**確かめられなかった基準を「満たしている」にしない**（未検証のテスト）。
デモ用の架空データ（app/demos/data）を使う。
"""

import copy
import io
import json
from collections import Counter
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

DATA = Path(__file__).parent.parent / "app" / "demos" / "data"
MANIFEST = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
FLOW = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "monthly_sales.json").read_text(encoding="utf-8"))
PLANTED = MANIFEST["planted_2026_11"]

CRITERIA = [
    {"criterion_id": "c_cols", "name": "必要な列がそろっている", "kind": "required_columns", "target": {"ref": "sales"}, "on_fail": "critical"},
    {"criterion_id": "c_type", "name": "売上金額が整数", "kind": "data_type", "target": {"ref": "sales", "column": "売上金額"}, "on_fail": "critical"},
    {"criterion_id": "c_blank", "name": "商品コードに空欄がない", "kind": "no_blank", "target": {"ref": "sales_selected", "column": "商品コード"}, "on_fail": "caution"},
    {"criterion_id": "c_unique", "name": "伝票番号が重複しない", "kind": "unique", "target": {"ref": "sales"}, "params": {"columns": ["伝票番号"]}, "on_fail": "caution"},
    {"criterion_id": "c_range", "name": "数量が1〜10", "kind": "value_range", "target": {"ref": "sales", "column": "数量"}, "params": {"min": 1, "max": 10}, "on_fail": "caution"},
    {"criterion_id": "c_period", "name": "対象月の伝票だけ", "kind": "period", "target": {"ref": "sales", "column": "売上日"}, "params": {"month": {"$param": "target_month"}}, "on_fail": "critical"},
    {"criterion_id": "c_total", "name": "集計前後の売上金額が一致", "kind": "total_match", "target": {"ref": "by_dept", "column": "売上合計"}, "params": {"compare_ref": "sales_full", "compare_column": "売上金額"}, "on_fail": "critical"},
    {"criterion_id": "c_rows", "name": "部署は4つ", "kind": "row_count", "target": {"ref": "by_dept"}, "params": {"min": 4, "max": 4}, "on_fail": "caution"},
    {"criterion_id": "c_match", "name": "照合できない商品コードが0件", "kind": "all_matched", "target": {"ref": "sales_p"}, "params": {"max_count": 0}, "on_fail": "critical"},
    {"criterion_id": "c_expected", "name": "売上合計が確認用の値と一致", "kind": "expected_value", "target": {"ref": "by_dept", "column": "売上合計"}, "params": {"measure": "sum", "value": {"$param": "expected_total"}}, "on_fail": "critical"},
    {"criterion_id": "c_list", "name": "高額の伝票", "kind": "list_rows", "target": {"ref": "sales"}, "params": {"condition": {"kind": "condition", "column": "売上金額", "operator": "ge", "value": "500000"}}, "on_fail": "record"},
]
RUN_PARAMETERS = [
    {"param_id": "target_month", "label": "対象月", "type": "month"},
    {"param_id": "expected_total", "label": "確認用の売上合計", "type": "integer", "required": False},
]


def flow_with(criteria=None):
    f = copy.deepcopy(FLOW)
    f["schema_version"] = "1.1"
    f["run_parameters"] = copy.deepcopy(RUN_PARAMETERS)
    f["completion_criteria"] = {"version": 1, "items": copy.deepcopy(criteria if criteria is not None else CRITERIA), "changelog": []}
    return f


def sheet_rows(name: str) -> tuple[list[str], list[tuple]]:
    """エンジンを通さずに元のファイルを読む（期待値を独立に数えるため）"""
    ws = openpyxl.load_workbook(DATA / name, read_only=True)["売上"]
    rows = list(ws.iter_rows(values_only=True))
    return list(rows[0]), rows[1:]


def edited_sales(edit) -> bytes:
    """10月分を書き換えたファイルを作る（形式の誤り・列の欠けを試すため）"""
    wb = openpyxl.load_workbook(DATA / "売上実績_2026-10.xlsx")
    edit(wb["売上"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def run(client, flow, sales="売上実績_2026-10.xlsx", sales_bytes=None, mapping=None, values=None):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}

    def up(name, data=None):
        res = client.post("/api/files", headers=h, files={"file": (name, data if data is not None else (DATA / name).read_bytes())})
        assert res.status_code == 201, res.text
        return res.json()["file_id"]

    bindings = [
        {"input_id": "sales", "file_id": up(sales, sales_bytes), "sheet": "売上", "column_mapping": mapping or {}},
        {"input_id": "products", "file_id": up("商品マスタ.xlsx"), "sheet": "商品"},
        {"input_id": "depts", "file_id": up("部署マスタ.csv")},
    ]
    res = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings, "run_parameters": values or {}})
    assert res.status_code == 200, res.text
    body = res.json()
    return body, {c["criterion_id"]: c for c in body["criteria"]}


# ===================== 10月分：すべて満たす =====================


def test_october_all_criteria(client):
    header, rows = sheet_rows("売上実績_2026-10.xlsx")
    total = MANIFEST["expected"]["2026-10"]["total_amount"]
    body, c = run(client, flow_with(), values={"target_month": "2026-10", "expected_total": str(total)})
    assert body["status"] == "success"
    assert [x["criterion_id"] for x in body["criteria"]] == [x["criterion_id"] for x in CRITERIA]  # 定義の順
    for cid in ("c_cols", "c_type", "c_blank", "c_unique", "c_range", "c_period", "c_total", "c_rows", "c_match", "c_expected"):
        assert c[cid]["status"] == "passed", (cid, c[cid])

    # 根拠の値（独立に数えた値と一致）
    assert c["c_total"]["evidence"]["差額"] == "0"
    assert f"{total:,}" in c["c_total"]["summary"]
    assert c["c_expected"]["evidence"] == {"計算した値": f"{total:,}", "確認用の値": f"{total:,}", "差": "0", "許容差": "0"}
    assert c["c_rows"]["evidence"]["件数"] == "4"
    dates = [r[header.index("売上日")].date() for r in rows]
    assert c["c_period"]["evidence"]["最も早い日"] == min(dates).isoformat()
    assert c["c_period"]["evidence"]["最も遅い日"] == max(dates).isoformat()
    assert c["c_period"]["evidence"]["対象期間"] == "2026-10-01〜2026-10-31"
    assert c["c_blank"]["evidence"]["確かめた行数"] == f"{len(rows):,}"

    # 一覧にするだけの基準は「記録」。判定（満たす／満たさない）には使わない
    high = sum(1 for r in rows if r[header.index("売上金額")] >= 500000)
    assert c["c_list"]["status"] == "recorded"
    assert c["c_list"]["evidence"]["該当件数"] == str(high)
    assert len(c["c_list"]["examples"]) == min(high, 5)


# ===================== 11月分：仕込んだ問題を見つける =====================


def test_november_finds_planted_problems(client):
    header, rows = sheet_rows("売上実績_2026-11.xlsx")
    body, c = run(client, flow_with(), sales="売上実績_2026-11.xlsx", mapping={"金額": "売上金額"}, values={"target_month": "2026-11", "expected_total": "21448960"})
    assert body["status"] == "warning"

    # 空欄の商品コード：manifest の3行
    blanks = len(PLANTED["blank_product_code_rows"])
    assert sum(1 for r in rows if r[header.index("商品コード")] in (None, "")) == blanks
    assert c["c_blank"]["status"] == "failed"
    assert c["c_blank"]["evidence"]["空欄の件数"] == str(blanks)
    # 例の行番号は「結果の行」（見出しを除いた何行目か）＝ Excel の行番号 − 見出しの1行
    assert [e["結果の行"] for e in c["c_blank"]["examples"]] == [r - 1 for r in PLANTED["blank_product_code_rows"]]

    # 照合できない行：知らないコード（4行）＋末尾に空白のあるコード（2行）＋空欄（3行）＝ 9行
    expected_unmatched = sum(PLANTED["unknown_product_codes"].values()) + len(PLANTED["trailing_space_code"]["rows"]) + blanks
    assert c["c_match"]["status"] == "failed"
    assert c["c_match"]["evidence"]["照合できない行"] == str(expected_unmatched)
    # 空白の違いが見えるよう、例のキーはかぎかっこで囲む
    assert {e["照合できないキー"] for e in c["c_match"]["examples"]} >= {"「P-1099」", "「P-2001」", "「P-1005 」"}
    # 直し方は原因ごと（空白を除けば全部直る、とは書かない）
    fix = c["c_match"]["how_to_fix"]
    assert "前後の空白の 2行" in fix and "相手の表にない値 4行" in fix and "空欄の 3行" in fix
    # 原因の内訳（行数）：表記の違い（空白）で直るもの・マスタにない値・空欄を分けて示す（空白を除けば全部直る、と見せない）
    ev = c["c_match"]["evidence"]
    assert ev["原因：前後の空白（取り除けば一致）"] == f"{len(PLANTED['trailing_space_code']['rows'])}行"
    assert ev["原因：相手の表（マスタ）にない値"] == f"{sum(PLANTED['unknown_product_codes'].values())}行"
    assert ev["原因：照合に使う値が空欄"] == f"{blanks}行"

    # 対象期間外：manifest の1行（10月の伝票が混ざっている）
    assert c["c_period"]["status"] == "failed"
    assert c["c_period"]["evidence"]["期間外の件数"] == str(len(PLANTED["out_of_period_rows"]))
    assert [e["結果の行"] for e in c["c_period"]["examples"]] == [r - 1 for r in PLANTED["out_of_period_rows"]]
    assert c["c_period"]["how_to_fix"]

    # 合計は一致する（問題があっても金額は失われていない）
    assert c["c_total"]["status"] == "passed"
    assert c["c_expected"]["status"] == "passed"


def test_wrong_expected_value_fails_with_difference(client):
    body, c = run(client, flow_with(), values={"target_month": "2026-10", "expected_total": "20818000"})
    assert c["c_expected"]["status"] == "failed"
    assert c["c_expected"]["evidence"]["差"] == "240"
    assert "一致しません" in c["c_expected"]["summary"]


def test_tolerance_allows_small_difference(client):
    crit = copy.deepcopy(CRITERIA[9])
    crit["params"]["tolerance"] = "240"
    body, c = run(client, flow_with([crit]), values={"expected_total": "20818000"})
    assert c["c_expected"]["status"] == "passed"


def test_count_and_range_failures(client):
    rows_crit = {**CRITERIA[7], "params": {"min": 5}}
    range_crit = {**CRITERIA[4], "params": {"max": 5}}
    header, rows = sheet_rows("売上実績_2026-10.xlsx")
    over = sum(1 for r in rows if r[header.index("数量")] > 5)
    body, c = run(client, flow_with([rows_crit, range_crit]))
    assert c["c_rows"]["status"] == "failed" and c["c_rows"]["evidence"]["件数"] == "4"
    assert c["c_range"]["status"] == "failed" and c["c_range"]["evidence"]["範囲外の件数"] == str(over)
    assert len(c["c_range"]["examples"]) == min(over, 5)


def test_unique_failure_on_master_with_duplicates(client):
    # 部署コードで重複を確かめる（売上では同じ部署が何度も出る＝重複あり）
    crit = {"criterion_id": "c_u", "name": "部署コードが重複しない", "kind": "unique", "target": {"ref": "sales"}, "params": {"columns": ["部署コード"]}, "on_fail": "caution"}
    header, rows = sheet_rows("売上実績_2026-10.xlsx")
    counts = Counter(r[header.index("部署コード")] for r in rows)
    body, c = run(client, flow_with([crit]))
    assert c["c_u"]["status"] == "failed"
    assert c["c_u"]["evidence"]["重複したキー"] == f"{sum(1 for n in counts.values() if n > 1)}種類"


# ===================== 入力の基準（必要な列・データの形式）=====================


def test_input_criteria_when_file_has_bad_value_and_missing_optional_column(client):
    def edit(ws):
        ws.cell(row=5, column=7, value="千円")  # 売上金額（7列目）に数値でない値
    body, c = run(client, flow_with([CRITERIA[1], CRITERIA[0]]), sales_bytes=edited_sales(edit))
    assert body["status"] == "failed"
    assert c["c_type"]["status"] == "failed"
    assert c["c_type"]["evidence"]["変換できない件数"] == "1"
    assert c["c_type"]["examples"] == [{"Excelの行": 5, "値": "千円"}]  # 元のファイル上の行番号
    # 必要な列は、形式の誤りとは別。読み込みが別の理由で止まったので確かめられない（満たしているとはしない）
    assert c["c_cols"]["status"] == "unverified"


def test_required_columns_counts_optional_column_added_as_blank(client):
    def edit(ws):
        ws.delete_cols(8)  # 備考（任意の列）を消す
    crit = {**CRITERIA[0], "params": {"columns": ["売上日", "備考"]}}
    body, c = run(client, flow_with([crit]), sales_bytes=edited_sales(edit))
    assert body["status"] == "success"  # 任意の列は空欄で補われ、実行は続く
    assert c["c_cols"]["status"] == "failed"  # しかし基準としては「ない」
    assert c["c_cols"]["evidence"]["足りない列"] == "備考"


def test_required_columns_fails_when_load_stops(client):
    body, c = run(client, flow_with(), sales="売上実績_2026-11.xlsx", values={"target_month": "2026-11"})
    assert body["status"] == "failed"
    assert c["c_cols"]["status"] == "failed"
    assert "売上金額" in c["c_cols"]["evidence"]["足りない列"]


# ===================== 未検証：確かめられなかった基準を「満たしている」にしない =====================


def test_unverified_when_run_stopped_before_target(client):
    body, c = run(client, flow_with(), sales="売上実績_2026-11.xlsx", values={"target_month": "2026-11", "expected_total": "1"})
    for cid in ("c_type", "c_blank", "c_unique", "c_range", "c_period", "c_total", "c_rows", "c_match", "c_expected", "c_list"):
        assert c[cid]["status"] == "unverified", (cid, c[cid])
        assert c[cid]["summary"]
    assert "実行されなかった" in c["c_total"]["summary"]


def test_unverified_when_run_parameter_missing_or_malformed(client):
    body, c = run(client, flow_with(), values={})
    assert c["c_period"]["status"] == "unverified"
    assert "「対象月」が入力されていません" in c["c_period"]["summary"]
    assert c["c_expected"]["status"] == "unverified"  # 任意の値でも、未入力なら確かめられない
    body, c = run(client, flow_with(), values={"target_month": "10月", "expected_total": "二千万"})
    assert c["c_period"]["status"] == "unverified" and "2026-10" in c["c_period"]["summary"]
    assert c["c_expected"]["status"] == "unverified" and "整数" in c["c_expected"]["summary"]


def test_unverified_when_column_missing_or_wrong_type(client):
    missing = {"criterion_id": "c_m", "name": "存在しない列", "kind": "no_blank", "target": {"ref": "sales", "column": "担当者"}, "on_fail": "critical"}
    wrong = {"criterion_id": "c_w", "name": "文字の列の範囲", "kind": "value_range", "target": {"ref": "sales", "column": "商品コード"}, "params": {"min": 1}, "on_fail": "critical"}
    period_on_number = {"criterion_id": "c_p", "name": "数値の列の期間", "kind": "period", "target": {"ref": "sales", "column": "数量"}, "params": {"month": "2026-10"}, "on_fail": "critical"}
    sum_text = {"criterion_id": "c_s", "name": "文字の列の合計", "kind": "total_match", "target": {"ref": "sales", "column": "商品コード"}, "params": {"compare_ref": "sales", "compare_column": "売上金額"}, "on_fail": "critical"}
    body, c = run(client, flow_with([missing, wrong, period_on_number, sum_text]))
    assert {k: v["status"] for k, v in c.items()} == {"c_m": "unverified", "c_w": "unverified", "c_p": "unverified", "c_s": "unverified"}
    assert "列「担当者」が対象の結果にない" in c["c_m"]["summary"]


def test_unverified_when_not_confirmed(client):
    ai = {**CRITERIA[7], "origin": "ai", "confirmation_status": "ai_proposed"}
    body, c = run(client, flow_with([ai]))
    assert c["c_rows"]["status"] == "unverified"
    assert "AIの提案" in c["c_rows"]["summary"]


def test_blocked_run_marks_everything_unverified(client):
    f = flow_with()
    f["nodes"][6]["confirmation_status"] = "unset"  # 未確認のステップがあると実行しない
    body, c = run(client, f, values={"target_month": "2026-10"})
    assert body["status"] == "failed"
    assert all(x["status"] == "unverified" for x in c.values())


def test_no_criteria_and_preview_do_not_evaluate(client):
    body, c = run(client, FLOW)  # 1.0 のファイル：完了基準なし
    assert body["criteria"] == []
    # プレビュー（途中まで実行）では評価しない
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    fid = client.post("/api/files", headers=h, files={"file": ("s.xlsx", (DATA / "売上実績_2026-10.xlsx").read_bytes())}).json()["file_id"]
    res = client.post("/api/flows/preview", headers=h, json={"flow": flow_with(), "bindings": [{"input_id": "sales", "file_id": fid, "sheet": "売上"}], "node_id": "n2"})
    assert res.status_code == 200 and "criteria" not in res.json()


def test_run_parameters_are_returned_with_run(client):
    body, _ = run(client, flow_with(), values={"target_month": "2026-10"})
    assert body["run_parameters"] == {"target_month": "2026-10"}
    detail = client.get(f"/api/runs/{body['run_id']}", headers={"X-Session-Id": "x"})
    assert detail.status_code in (401, 404)  # 別のセッションからは見られない
