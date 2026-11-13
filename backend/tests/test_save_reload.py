"""タスク1-10：保存 → 読み込み → 再実行の自動テスト。

作業手順は「ファイル（JSON）」として保存され、サーバーには残らない（設計書 §5.2）。
そのため「保存したファイルを、別のときに・別のサーバーで読み込んで実行できるか」を、画面と同じ API で確かめる。

- 同じデータなら、出力する表の指紋（SHA-256）が毎回一致する（再現性）
- サーバーを起動し直しても（別のアプリのインスタンス）、保存したファイルで同じ結果になる
- 新しい月のデータ（11月分：列名の変更・列の追加・照合できない商品コードを含む）でも再実行でき、
  仕込んだ問題を「注意」として示し、合計は正解値と一致する
- 保存したファイルの中身は、業務データやファイルの割当を含まない

デモ用の架空データ（app/demos/data、正解値は manifest.json）を使う。
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

DATA = Path(__file__).parent.parent / "app" / "demos" / "data"
MANIFEST = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
FLOW_FILE = Path(__file__).parent.parent / "app" / "demos" / "flows" / "monthly_sales.json"


def saved_file_text() -> str:
    """画面の「作業手順を保存」と同じ形で書き出したファイルの中身（字下げつきJSON）"""
    flow = json.loads(FLOW_FILE.read_text(encoding="utf-8"))
    return json.dumps(flow, ensure_ascii=False, indent=2) + "\n"


def new_server() -> TestClient:
    """サーバーを新しく起動する（前のサーバーのメモリ・セッションは引き継がない）"""
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def run_saved_flow(client: TestClient, text: str, sales: str, mapping: dict[str, str] | None = None) -> tuple[dict, dict]:
    """保存したファイルを読み込み、ファイルを割り当てて実行する。実行結果と詳細を返す"""
    flow = json.loads(text)
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}

    def upload(name: str) -> str:
        res = client.post("/api/files", headers=h, files={"file": (name, (DATA / name).read_bytes())})
        assert res.status_code == 201, res.text
        return res.json()["file_id"]

    # 読み込んだ作業手順が、形の決まりを満たし実行できること（画面の「開く」と同じ確認）
    check = client.post("/api/flows/validate", json={"flow": flow}).json()
    assert check["valid"] and check["executable"], check

    bindings = [
        {"input_id": "sales", "file_id": upload(sales), "sheet": "売上", "column_mapping": mapping or {}},
        {"input_id": "products", "file_id": upload("商品マスタ.xlsx"), "sheet": "商品"},
        {"input_id": "depts", "file_id": upload("部署マスタ.csv")},
    ]
    run = client.post("/api/runs", headers=h, json={"flow": flow, "bindings": bindings})
    assert run.status_code == 200, run.text
    summary = run.json()
    detail = client.get(f"/api/runs/{summary['run_id']}", headers=h).json()
    return summary, detail


def dept_total(detail: dict) -> int:
    by_dept = next(p for p in detail["output_previews"] if p["reference"] == "by_dept")
    col = by_dept["columns"].index("売上合計")
    return sum(int(r[col]) for r in by_dept["rows"])


@pytest.fixture(scope="module")
def first_run():
    with new_server() as c:
        return run_saved_flow(c, saved_file_text(), "売上実績_2026-10.xlsx")


def test_same_data_gives_same_fingerprints(first_run):
    summary, detail = first_run
    assert summary["status"] == "success"
    assert dept_total(detail) == MANIFEST["expected"]["2026-10"]["total_amount"]  # 20,818,240
    assert set(summary["fingerprints"]) == {"by_dept", "by_category", "sales_full"}

    # 同じサーバーで、同じファイルをもう一度実行しても指紋が一致する
    with new_server() as c:
        again, _ = run_saved_flow(c, saved_file_text(), "売上実績_2026-10.xlsx")
        again2, _ = run_saved_flow(c, saved_file_text(), "売上実績_2026-10.xlsx")
    assert again["fingerprints"] == summary["fingerprints"]
    assert again2["fingerprints"] == summary["fingerprints"]


def test_saved_file_works_after_server_restart(first_run, tmp_path):
    """ファイルに書いて、別のサーバー（起動し直したもの）で読み込んでも同じ結果になる"""
    summary, _ = first_run
    path = tmp_path / "月次売上集計_v1.json"
    path.write_text(saved_file_text(), encoding="utf-8")

    with new_server() as restarted:
        result, detail = run_saved_flow(restarted, path.read_text(encoding="utf-8"), "売上実績_2026-10.xlsx")
    assert result["status"] == "success"
    assert result["fingerprints"] == summary["fingerprints"]
    assert result["flow_hash"] == summary["flow_hash"]  # 作業手順の内容も同じ
    assert dept_total(detail) == MANIFEST["expected"]["2026-10"]["total_amount"]


def test_new_month_data_runs_and_reports_planted_problems(first_run):
    """11月分：列名「売上金額」→「金額」（対応付けで読み込む）、照合できない商品コード・空欄のコードを注意として示す"""
    with new_server() as c:
        summary, detail = run_saved_flow(c, saved_file_text(), "売上実績_2026-11.xlsx", mapping={"金額": "売上金額"})
    assert summary["status"] == "warning"  # 最後まで実行し、確認が必要なお知らせがある
    assert dept_total(detail) == MANIFEST["expected"]["2026-11"]["total_amount"]  # 21,448,960

    issues = {i["code"]: i for n in summary["nodes"] for i in n["issues"]}
    planted = MANIFEST["planted_2026_11"]
    unmatched = issues["UNMATCHED_RECORDS"]
    assert unmatched["severity"] == "warning"
    assert f"キーが空欄の{len(planted['blank_product_code_rows'])}行" in unmatched["message"]
    sales_load = {i["code"]: i for i in summary["nodes"][0]["issues"]}
    assert "担当者" in sales_load["COLUMNS_NOT_LOADED"]["message"]  # 増えた列は読み込まない
    # 画面に出す文に、内部の参照名を入れない
    assert "sales_selected" not in unmatched["message"] and "左" not in unmatched["message"]
    # 10月分とは違う結果になる（指紋が変わる）
    assert summary["fingerprints"]["by_dept"] != first_run[0]["fingerprints"]["by_dept"]


def test_new_month_without_mapping_stops_before_processing():
    """対応付けをしないと、必須の列「売上金額」がないため、読み込みの段階で止まる（間違った集計をしない）"""
    with new_server() as c:
        summary, _ = run_saved_flow(c, saved_file_text(), "売上実績_2026-11.xlsx")
    assert summary["status"] == "failed"
    first = summary["nodes"][0]
    assert first["status"] == "error"
    assert first["issues"][0]["code"] == "MISSING_COLUMNS"
    assert "売上金額" in first["issues"][0]["message"]
    assert all(n["status"] == "skipped" for n in summary["nodes"][1:])
    assert summary["fingerprints"] == {}


def test_saved_file_contains_no_business_data():
    text = saved_file_text()
    flow = json.loads(text)
    assert "bindings" not in flow and "file_id" not in text
    # 売上データの値（伝票番号など）は入っていない。入っているのは列名と処理の設定だけ
    assert "D-" not in text and "伝票番号" in text
