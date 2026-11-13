"""分析エンジン（Phase A。docs/analysis-design.md）。

デモの架空データを実際の処理エンジンで実行し、分析の値を正解値（manifest.json）と照らす。
- 基本集計・ランキング・構成比は、まとめるステップの設定から作る（列名から意味を推測しない）
- 前回がなくても分析は成立する（比べられないことを理由つきで示す）
- 注目すべき変化：増減率と増減の量の両方が閾値を超えたものだけ。前回 0 は割合を出さない。定義が変われば比べない
- 時系列：まとめる列が日付のとき、日付の順に並べる
"""

import copy
import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.analysis.engine import Breakdown, BreakdownItem, analyze, notable_changes
from app.config import Settings, get_settings
from app.engine.nodes.load import Binding
from app.engine.runner import run_flow
from app.files.service import accept_upload
from app.flow.validate import parse_flow
from app.main import create_app
from app.sessions.store import SessionStore

DATA = Path(__file__).parent.parent / "app" / "demos" / "data"
MANIFEST = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def start(client, demo="monthly_sales", pattern="ok", history=()):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    s = client.post(f"/api/demos/{demo}/start", headers=h, json={"pattern": pattern}).json()
    body = client.post("/api/runs", headers=h, json={"flow": s["flow"], "bindings": s["bindings"], "run_parameters": s["run_parameters"], "history": list(history)}).json()
    return s, body


def test_basic_summary_ranking_and_share_match_the_answer(client):
    _, body = start(client)
    a = body["analysis"]
    by_dept = next(b for b in a["breakdowns"] if b["reference"] == "by_dept")
    assert by_dept["dimension"] == "部署名" and by_dept["measure"] == "売上合計" and by_dept["measure_kind"] == "sum"
    expected = MANIFEST["expected"]["2026-10"]
    assert by_dept["total"] == f"{expected['total_amount']:,}"
    assert {i["key"]: i["value"] for i in by_dept["items"]} == {k: f"{v:,}" for k, v in expected["dept_totals"].items()}
    # 値の大きい順・構成比（合計がほぼ 100%）
    values = [Decimal(i["value"].replace(",", "")) for i in by_dept["items"]]
    assert values == sorted(values, reverse=True)
    assert abs(sum(Decimal(i["share"].rstrip("%")) for i in by_dept["items"]) - 100) <= Decimal("0.2")
    # 基本集計：出力する表ごと
    t = next(t for t in a["tables"] if t["reference"] == "by_dept")
    assert t["rows"] == 4
    total = next(n for n in t["numeric"] if n["column"] == "売上合計")
    assert total["sum"] == f"{expected['total_amount']:,}"
    # 前回がなくても分析は成立し、比べられないことを示す（エラーにしない）
    assert "比較できる過去の実行結果がありません。今回のデータの分析は確認できます。" in a["notes"]
    assert a["notable_changes"] == [] and a["compared_with"] is None
    # 実行の記録にも入る（集計済みの値だけ）
    assert body["record"]["analysis"] == a


def test_each_demo_shows_its_own_analysis(client):
    _, pm = start(client, "product_match")
    assert [b["dimension"] for b in pm["analysis"]["breakdowns"]] == ["カテゴリ"]
    _, inv = start(client, "inventory")
    assert any(b["dimension"] == "商品コード" for b in inv["analysis"]["breakdowns"])


def test_check_items_come_from_verdict_without_asserting_causes(client):
    _, body = start(client, pattern="ng")
    items = body["analysis"]["check_items"]
    assert any(x.startswith("「対象月の伝票だけ」：") for x in items)
    assert all("原因です" not in x for x in items)


def test_notable_changes_need_both_rate_and_amount(client):
    s, prev = start(client)
    # 前回の記録：正式に出力した9月分とし、ある部署の値を変えて「変化」を作る
    rec = copy.deepcopy(prev["record"])
    rec["period"], rec["official_output"]["performed"] = "2026-09", True
    by_dept = next(b for b in rec["analysis"]["breakdowns"] if b["reference"] == "by_dept")
    big = by_dept["items"][0]
    big_now = Decimal(big["value"].replace(",", ""))
    big["value"] = f"{int(big_now / Decimal('1.35')):,}"  # 今回は約35%増
    small = by_dept["items"][-1]
    _, body = start(client, history=[rec])
    a = body["analysis"]
    assert a["compared_with"] == "2026年9月"
    keys = [(c["key"], c["rate"]) for c in a["notable_changes"]]
    assert any(k == big["key"] and r.startswith("+35") for k, r in keys)
    assert all(k != small["key"] for k, _ in keys)  # 変わっていない部署は出さない
    assert any("増えています" in x and big["key"] in x for x in a["check_items"])


def test_notable_change_thresholds_and_zero_previous():
    def b(items, total, kind="sum", fp="x"):
        return Breakdown(
            reference="t", step_name="s", dimension="d", measure="m", measure_kind=kind, total=total, groups=len(items),
            items=[BreakdownItem(key=k, value=v, share=None) for k, v in items], is_time=False, fingerprint=fp,
        )

    # 1件 → 2件（+100%）だが量が小さい：件数は10件以上でないと注目しない
    assert notable_changes([b([("A", "2")], "2", "count")], [b([("A", "1")], "1", "count")]) == []
    # 1,000件 → 2,000件：注目する
    got = notable_changes([b([("A", "2,000")], "2,000", "count")], [b([("A", "1,000")], "1,000", "count")])
    assert {c.key for c in got} == {"A", "（全体）"} and got[0].rate == "+100.0%"
    # 前回 0：割合を出さず、注目もしない
    assert notable_changes([b([("A", "50")], "50")], [b([("A", "0")], "0")]) == []
    # まとめ方の定義が変われば比べない
    assert notable_changes([b([("A", "2,000")], "2,000", "count", fp="new")], [b([("A", "1,000")], "1,000", "count", fp="old")]) == []


def test_time_series_when_grouped_by_date():
    flow = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "demo_monthly_sales.json").read_text(encoding="utf-8"))
    for n in flow["nodes"]:
        if n["node_id"] == "n8":
            n["parameters"]["group_by"] = ["売上日"]
            n["node_name"] = "日ごとに売上を合計する"
    fd = parse_flow(flow)
    settings = Settings(_env_file=None)
    store = SessionStore(ttl_seconds=60)
    sess = store.create()
    files = {}
    bindings = {}
    for input_id, name, sheet in [("sales", "売上実績_2026-10.xlsx", "売上"), ("products", "商品マスタ.xlsx", "商品"), ("depts", "部署マスタ.csv", None)]:
        f = accept_upload(sess, (DATA / name).read_bytes(), name, settings)
        files[f.file_id] = f
        bindings[input_id] = Binding(input_id, f.file_id, sheet, 1)
    ex = run_flow(fd, bindings, sess.files, run_values={"target_month": "2026-10"})
    a = analyze(fd, ex)
    series = next(b for b in a.breakdowns if b.is_time)
    keys = [i.key for i in series.items]
    assert keys == sorted(keys) and keys[0].startswith("2026-10-")
    assert not any("時系列" in n for n in a.notes)


# ===================== Excel の「確認結果」（Phase B-2） =====================


def _check_sheet_text(client, h, run_id):
    import io

    import openpyxl

    res = client.get(f"/api/runs/{run_id}/export", headers=h, params={"confirmed": "true"})
    assert res.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(res.content), read_only=True)["確認結果"]
    return [[c for c in row if c is not None] for row in ws.iter_rows(values_only=True)]


def test_excel_check_sheet_has_key_figures_comparison_and_check_items(client):
    h = {"X-Session-Id": client.post("/api/session").json()["session_id"]}
    s = client.post("/api/demos/monthly_sales/start", headers=h, json={"pattern": "ng"}).json()
    body = client.post("/api/runs", headers=h, json={"flow": s["flow"], "bindings": s["bindings"], "run_parameters": s["run_parameters"]}).json()
    rows = _check_sheet_text(client, h, body["run_id"])
    flat = [str(x) for r in rows for x in r]
    sections = [x for x in flat if x[:3] in ("1. ", "2. ", "3. ", "4. ", "5. ", "6. ", "7. ")]
    # 見出しは番号順で、主要数値・前回との比較・完了基準・確認すべきこと・ステップの要約の順
    titles = [x.split(" ", 1)[1].split("（")[0] for x in sections]
    assert titles == ["確認すべき問題", "今回の主要数値", "前回との比較", "完了基準の詳細", "確認すべきこと", "処理ステップの要約"]
    # 部署別の内訳：部署名の次のセルに、値が数値（文字ではなく）として入る（Excel で桁区切りの書式になる）
    dept = next(r for r in rows if "EC事業部" in r)
    value = dept[dept.index("EC事業部") + 1]
    assert isinstance(value, int) and value > 1_000_000
    assert any("比較できる前月（2026年9月）の正式な出力の記録がありません" in x for x in flat)
    assert any(x.startswith("・「対象月の伝票だけ」：") for x in flat)
