"""Excel出力のテスト（タスク1-7）。

出力したファイルを openpyxl で読み戻し、シートの構成・値の形式・件数・安全性を確かめる。
期待値は入力データ（test_api_flows.py の架空データ）から手計算した値。
"""

import copy
import io
from datetime import datetime
from decimal import Decimal
from urllib.parse import unquote

import openpyxl

from tests.test_api_flows import FLOW, SALES_CSV, client, setup_session  # noqa: F401（client はフィクスチャ）


def run_and_export(client, sales=SALES_CSV, products=None, flow=FLOW):  # noqa: F811
    h, bindings = setup_session(client, sales=sales, **({"products": products} if products else {}))
    run = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings}).json()
    res = client.get(f"/api/runs/{run['run_id']}/export", headers=h)
    return run, res, h


def load(res):
    return openpyxl.load_workbook(io.BytesIO(res.content))


def test_export_has_result_sheets_then_checks_and_record(client):  # noqa: F811
    run, res, _ = run_and_export(client)
    assert run["status"] == "success"
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    disposition = res.headers["content-disposition"]
    name = unquote(disposition.split("filename*=UTF-8''")[1])
    assert name.startswith("月次売上集計_結果_") and name.endswith(".xlsx")

    wb = load(res)
    assert wb.sheetnames == ["部署別売上", "商品別売上", "明細", "確認結果", "処理の記録"]


def test_result_sheet_values_keep_types(client):  # noqa: F811
    _, res, _ = run_and_export(client)
    wb = load(res)
    # 部署別：営業1部 3000+2940=5940（2件）、営業2部 980+1500=2480（2件）
    ws = wb["部署別売上"]
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0] == ("部署名", "売上合計", "件数")
    assert rows[1:] == [("営業1部", 5940, 2), ("営業2部", 2480, 2)]
    assert ws["B2"].number_format == "#,##0"

    detail = list(wb["明細"].iter_rows(values_only=True))
    header = detail[0]
    first = dict(zip(header, detail[1]))
    assert isinstance(first["売上日"], datetime) and first["売上日"].date().isoformat() == "2026-10-01"  # 日付は日付のまま
    assert first["部署コード"] == "001"  # 先頭0のコードは文字のまま
    assert first["数量"] == 2 and isinstance(first["数量"], int)
    assert first["金額"] == 3000
    assert len(detail) == 1 + 4  # 見出し＋4件（増えも減りもしない）
    assert wb["明細"].freeze_panes == "A2"


def test_text_starting_with_equals_is_not_a_formula(client):  # noqa: F811
    # 備考に数式のような文字が入っていても、数式としては書き込まない
    sales = SALES_CSV.replace(",架空\r\n", ',"=HYPERLINK(""http://example.invalid"",""x"")"\r\n')
    flow = copy.deepcopy(FLOW)
    flow["nodes"][1]["parameters"]["columns"].append("備考")  # 明細に備考を残す
    _, res, _ = run_and_export(client, sales=sales, flow=flow)
    ws = load(res)["明細"]
    header = [c.value for c in ws[1]]
    col = header.index("備考") + 1
    cells = [ws.cell(row=r, column=col) for r in range(2, ws.max_row + 1)]
    target = next(c for c in cells if c.value and str(c.value).startswith("="))
    assert target.data_type == "s"  # 文字（数式ではない）
    assert target.value == '=HYPERLINK("http://example.invalid","x")'


def test_checks_and_record_sheets(client):  # noqa: F811
    run, res, _ = run_and_export(client)
    wb = load(res)
    checks = [r for r in wb["確認結果"].iter_rows(values_only=True)]
    first = {r[0]: r[1] for r in checks if r and r[0] and len(r) > 1}
    # 1枚目（判断するためのレポート）：総合判定・処理と検証の状態・正式な出力を分けて示す
    assert checks[0][0] == "確認結果｜月次売上集計"
    assert any(r[0] == "総合判定：正常" for r in checks)
    assert first["処理・検証"].startswith("完了")
    assert first["正式な集計結果"].startswith("出力済み")
    assert first["判定の根拠"].startswith("標準の確認のみ")
    header = next(r for r in checks if r and r[0] == "ステップ")
    assert header[:5] == ("ステップ", "名前", "状態", "件数", "要点（最も重要なお知らせ）")

    record = [r for r in wb["処理の記録"].iter_rows(values_only=True)]
    # 2枚目（処理を追跡するための記録）：処理の中で行った確認の結果（お知らせ）も、詳細ログに残る
    assert any(r and r[3] and "合計は結合の前後で一致" in str(r[3]) for r in record)
    values = {r[0]: r[1] for r in record if r and len(r) > 1}
    assert values["作業手順"] == "月次売上集計"
    assert values["作業手順の指紋"] == run["flow_hash"]
    files = [r for r in record if r and r[0] in ("売上実績", "商品マスタ", "部署マスタ")]
    assert [(r[1], r[4]) for r in files] == [("売上.csv", 4), ("商品.csv", 2), ("部署.csv", 2)]
    fps = {r[0]: r[3] for r in record if r and r[0] in ("部署別売上", "商品別売上", "明細")}
    assert fps == {k: run["fingerprints"][ref] for k, ref in (("部署別売上", "by_dept"), ("商品別売上", "by_product"), ("明細", "sales_full"))}


def test_failed_run_exports_only_checks_for_investigation(client):  # noqa: F811
    # 商品マスタに重複 → 結合で止まる。処理結果のシートは出さない
    run, res, _ = run_and_export(client, products="商品コード,商品名\r\nA-1,ノートPC\r\nA-1,ノートPC（重複）\r\nB-1,マウス\r\n")
    assert run["status"] == "failed" and run["can_export"] is False
    assert res.status_code == 200
    name = unquote(res.headers["content-disposition"].split("filename*=UTF-8''")[1])
    assert "確認結果（調査用）" in name
    wb = load(res)
    assert wb.sheetnames == ["確認結果", "処理の記録"]
    checks = list(wb["確認結果"].iter_rows(values_only=True))
    first = {r[0]: r[1] for r in checks if r and r[0] and len(r) > 1}
    assert any(r[0] == "総合判定：重大" for r in checks)
    assert first["処理・検証"].startswith("途中で停止（ステップ") and "でエラー" in first["処理・検証"]
    assert first["正式な集計結果"] == "出力停止（処理が途中で止まったため）"
    # 確認すべき問題の先頭が、止まった原因（重大）
    head = next(i for i, r in enumerate(checks) if r and r[0] == "重要度")
    assert checks[head + 1][0] == "重大" and "（自動の確認）" in checks[head + 1][1]
    flat = [str(v) for ws in wb.worksheets for r in ws.iter_rows(values_only=True) for v in r if v is not None]
    assert any("照合に使う列の値が重複しています" in v for v in flat)  # 原因
    assert "実行していない" in flat


def test_sheet_name_collision_with_report_sheets(client):  # noqa: F811
    flow = copy.deepcopy(FLOW)
    flow["nodes"][8]["parameters"]["sheets"][0]["sheet_name"] = "確認結果"
    _, res, _ = run_and_export(client, flow=flow)
    assert load(res).sheetnames == ["確認結果", "商品別売上", "明細", "確認結果2", "処理の記録"]


def test_export_unknown_run_and_other_session(client):  # noqa: F811
    run, _, h = run_and_export(client)
    assert client.get("/api/runs/r_nothing/export", headers=h).status_code == 404
    other = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    assert client.get(f"/api/runs/{run['run_id']}/export", headers=other).status_code == 404


def test_decimal_without_scale_has_no_trailing_dot_format(client):  # noqa: F811
    _, res, _ = run_and_export(client)
    ws = load(res)["明細"]
    header = [c.value for c in ws[1]]
    cell = ws.cell(row=2, column=header.index("金額") + 1)
    assert cell.value == Decimal("3000") or cell.value == 3000
    assert not cell.number_format.endswith(".")


def test_report_layout_for_reading_and_printing(client):  # noqa: F811
    """全シートで目盛線なし・A4横・幅1ページ。見出しの固定。結果と詳細ログには絞り込み。開くと「確認結果」"""
    _, res, _ = run_and_export(client)
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert wb.active.title == "確認結果"
    for ws in wb.worksheets:
        assert ws.sheet_view.showGridLines is False, ws.title
        assert ws.page_setup.orientation == "landscape" and ws.page_setup.paperSize == 9, ws.title
        # 幅1ページ（1は既定値のため、ファイルには書かれない）・縦は必要なだけ
        assert ws.sheet_properties.pageSetUpPr.fitToPage is True, ws.title
        assert ws.page_setup.fitToWidth in (None, 1) and ws.page_setup.fitToHeight == 0, ws.title
        assert ws.freeze_panes == "A2", ws.title
    assert wb["部署別売上"].auto_filter.ref == "A1:" + wb["部署別売上"].auto_filter.ref.split(":")[1]
    record = wb["処理の記録"]
    header = next(r for r in record.iter_rows() if r[0].value == "ログID")
    assert record.auto_filter.ref.startswith(f"A{header[0].row}:")
    # 見出しは濃紺・白い文字（重要度は色だけでなく文字でも示す）
    checks = wb["確認結果"]
    cell = next(c for r in checks.iter_rows() for c in r if c.value == "ステップ")
    assert cell.fill.fgColor.rgb.endswith("203047") and cell.font.color.rgb.endswith("FFFFFF")


def test_duration_is_not_rounded_to_zero():
    from app.export.report import format_duration

    assert format_duration(0) == "0.001秒未満"
    assert format_duration(8) == "0.008秒"
    assert format_duration(999) == "0.999秒"
    assert format_duration(12_345) == "12.3秒"
