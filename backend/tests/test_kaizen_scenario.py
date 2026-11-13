"""業務改善診断デモ Phase 1：業務情報・現在の7工程・部署のExcel。

- 7工程の想定所要時間の合計が90分（業務情報の所要時間と一致）
- 部署のExcelの列名は実際のファイルから読み、部署ごとに違う（標準化の根拠になる事実）
- 件数・合計は生成時の正解値（kaizen_manifest.json）と一致
- 形の誤り（時間の不一致・転記元が後ろの工程・未知の成果物）は読み込みで拒否する
- API は AI を使っていないことを返す
"""

import json
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.demos.catalog import DATA_DIR
from app.kaizen.models import Scenario
from app.kaizen.scenarios import SCENARIO_DIR, load_scenario, read_file_facts
from app.main import create_app

MANIFEST = json.loads((DATA_DIR / "kaizen_manifest.json").read_text(encoding="utf-8"))
RAW = json.loads((SCENARIO_DIR / "monthly_report.json").read_text(encoding="utf-8"))


@pytest.fixture
def client():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


def test_現在の作業は7工程で合計90分_すべて手作業():
    sc = load_scenario("monthly_report")
    assert sc is not None
    assert [s.step_id for s in sc.steps] == [f"s{i}" for i in range(1, 8)]
    assert sc.total_minutes == 90 == sc.context.minutes_per_run
    assert all(s.mode == "manual" for s in sc.steps)
    assert "想定値" in sc.time_note
    # 業務情報（指示書 §4）は初期入力済み
    assert sc.context.must_keep == ["元データとの合計照合"]
    assert sc.context.unsure_to_remove == ["会議用資料への個別転記"]


def test_規則で使う事実_同じ集計結果を2つの成果物へ転記している():
    sc = load_scenario("monthly_report")
    copies = [s for s in sc.steps if s.transcribes_from == "s3"]
    assert {s.deliverable for s in copies} == {"summary_xlsx", "meeting_doc"}
    assert [s.step_id for s in sc.steps if s.repeats_per_department] == ["s2", "s3"]


def test_部署のExcelは実際のファイルから読み_列名が部署ごとに違う():
    sc = load_scenario("monthly_report")
    facts = read_file_facts(sc)
    assert [f.department for f in facts] == ["営業1部", "営業2部", "法人営業部"]
    for f in facts:
        m = MANIFEST["files"][f.filename]
        assert f.columns == m["header"]
        assert f.rows == m["rows"]
    assert len({tuple(f.columns) for f in facts}) == 3
    assert sum(f.rows for f in facts) == MANIFEST["total"]["rows"]


def test_部署のExcelの合計はmanifestの正解値と一致():
    for name, m in MANIFEST["files"].items():
        wb = openpyxl.load_workbook(DATA_DIR / name, read_only=True)
        rows = list(wb[m["sheet"]].iter_rows(min_row=2, values_only=True))
        wb.close()
        assert sum(r[5] for r in rows) == m["amount_total"]
        assert all(r[0].year == 2026 and r[0].month == 10 for r in rows)
        assert all(r[3] * r[4] == r[5] for r in rows)


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda d: d["steps"][0].update(minutes=6), "合計"),
        (lambda d: d["steps"][3].update(transcribes_from="s5"), "前の工程"),
        (lambda d: d["steps"][3].update(deliverable="unknown"), "成果物の一覧"),
        (lambda d: d["steps"][1].update(step_id="s1"), "重複"),
        (lambda d: d["steps"][0].update(ai_comment="x"), "Extra inputs"),
    ],
)
def test_形の誤りは読み込みで拒否する(edit, message):
    data = json.loads(json.dumps(RAW))
    edit(data)
    with pytest.raises(ValidationError, match=message):
        Scenario.model_validate(data)


def test_API_シナリオを返し_AIは使っていない(client):
    res = client.get("/api/kaizen/scenarios/monthly_report")
    assert res.status_code == 200
    body = res.json()
    assert body["ai_used"] is False
    assert body["total_minutes"] == 90
    assert len(body["scenario"]["steps"]) == 7
    assert body["files"][1]["columns"] == ["日付", "伝票No", "商品コード", "数量", "単価", "金額"]


@pytest.mark.parametrize("sid", ["unknown", "monthly-report", "..monthly_report"])
def test_API_ないシナリオは404(client, sid):
    res = client.get(f"/api/kaizen/scenarios/{sid}")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "SCENARIO_NOT_FOUND"


def test_API_フォルダをさかのぼる指定は届かない(client):
    # 「../」を含む指定は経路として一致せず、ファイルを読む前に 404 になる
    assert client.get("/api/kaizen/scenarios/..%2Fdemos").status_code == 404
    assert load_scenario("../demos") is None


def test_シナリオのファイルはすべて読める():
    for path in Path(SCENARIO_DIR).glob("*.json"):
        assert load_scenario(path.stem) is not None
