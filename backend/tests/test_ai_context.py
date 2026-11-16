"""A-2：AI業務改善診断の材料（情報の収集）。AIは呼ばない・パスワード不要。

- 今ある情報（業務・作業手順・品質ルール・Excelの列と値の傾向）を集め、送る文章を画面に見せる形で返す
- 個人情報と思われる列（名前・値の形）は、列名と件数だけを送り、値は送らない。送らなかったことを示す
- ない情報を、あるものとして扱わない（足りないことを示し、AIにも伝える）
- 同じ材料なら同じ指紋（同じ材料を何度も送らないため）
すべて架空のデータ。
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

FLOW = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "demo_monthly_sales.json").read_text(encoding="utf-8"))

# 架空の顧客対応の記録（個人情報と思われる列と、備考に紛れたメールアドレスを含む）
CSV = (
    "受付日,受付番号,氏名,電話,金額,備考\n"
    "2026-10-01,R001,山田 太郎,03-1234-5678,1200,\n"
    "2026-10-03,R002,佐藤 花子,090-1111-2222,800,折り返し希望\n"
    "2026-10-05,R003,鈴木 一郎,06-9876-5432,1500,taro.example@example.com へ連絡\n"
)


@pytest.fixture
def client():
    settings = Settings(_env_file=None)  # AIは使わない状態（off）でも材料は作れる
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    c = TestClient(app)
    c.headers["X-Session-Id"] = c.post("/api/session").json()["session_id"]
    return c, app


def ctx(c, **body):
    res = c.post("/api/ai/diagnosis/context", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_業務の説明だけでも作れ_足りない情報を示す_AIは呼ばない(client):
    c, app = client
    body = ctx(c, name="支店経費の月次集計", purpose="支店の経費を毎月まとめ、役員会に報告する")
    assert [s["key"] for s in body["sections"]] == ["business"]
    assert "やりたい作業・目的：支店の経費を毎月まとめ、役員会に報告する" in body["text"]
    assert any("Excel・CSVがまだ読み込まれていません" in m for m in body["missing"])
    assert any("作業手順はまだありません" in m for m in body["missing"])
    # 足りないことは、AIにも「ない」と伝える
    assert "## 足りない情報（ないものとして扱ってください）" in body["text"]
    assert body["chars"] == len(body["text"])
    assert app.state.ai.ledger.records == []


def test_目的がないときは_足りないこととして示す(client):
    c, _ = client
    body = ctx(c, name="支店経費の月次集計")
    assert any("業務の目的が入力されていません" in m for m in body["missing"])


def test_作業手順と品質ルールを_業務の言葉で並べる(client):
    c, _ = client
    body = ctx(c, name="月次売上", purpose="部署別に集計する", flow=FLOW)
    steps = next(s for s in body["sections"] if s["key"] == "steps")
    assert steps["title"] == "作業手順（処理ステップ 9）"
    assert any(line.startswith("ステップ4：") and "（別の表から情報を付け加える）・使うデータ：ステップ2・ステップ3" in line for line in steps["lines"])
    criteria = next(s for s in body["sections"] if s["key"] == "criteria")
    assert "対象月の伝票だけ（重大）" in criteria["lines"]
    assert not any("作業手順はまだありません" in m for m in body["missing"])


def test_Excelの列と値の傾向を送り_個人情報と思われる値は送らない(client):
    c, _ = client
    fid = c.post("/api/files", files={"file": ("顧客対応.csv", CSV.encode("utf-8"))}).json()["file_id"]
    body = ctx(c, name="顧客対応の集計", purpose="月ごとに件数と金額をまとめる", files=[{"file_id": fid, "label": "顧客対応の記録"}])
    text = body["text"]
    sec = next(s for s in body["sections"] if s["key"] == f"file:{fid}")
    assert sec["title"] == "Excel・CSV：顧客対応の記録"
    assert "データの行数：3行・列数：6列" in text
    assert any(line.startswith("列「金額」：整数・空欄0件・種類3・範囲800〜1,500") for line in sec["lines"])
    # 名前・電話（列名で判定）と、備考に紛れたメールアドレス（値の形で判定）の値は送らない
    for secret in ["山田", "佐藤", "03-1234-5678", "090-1111-2222", "taro.example@example.com"]:
        assert secret not in text
    assert "列「氏名」：文字・空欄0件・種類3・値は送りません（個人情報の可能性）" in sec["lines"]
    assert [e.split("の値")[0] for e in body["excluded"]] == ["顧客対応の記録の列「氏名」", "顧客対応の記録の列「電話」", "顧客対応の記録の列「備考」"]
    assert not any("Excel・CSVがまだ読み込まれていません" in m for m in body["missing"])


def test_同じ材料なら同じ指紋_変われば違う指紋(client):
    c, _ = client
    a = ctx(c, name="支店経費", purpose="まとめる")
    b = ctx(c, name="支店経費", purpose="まとめる")
    d = ctx(c, name="支店経費", purpose="まとめて報告する")
    assert a["fingerprint"] == b["fingerprint"] != d["fingerprint"]


def test_ほかのセッションのファイルは使えない(client):
    c, app = client
    fid = c.post("/api/files", files={"file": ("顧客対応.csv", CSV.encode("utf-8"))}).json()["file_id"]
    other = TestClient(app)
    other.headers["X-Session-Id"] = other.post("/api/session").json()["session_id"]
    res = other.post("/api/ai/diagnosis/context", json={"name": "x", "files": [{"file_id": fid}]})
    assert res.status_code == 404
