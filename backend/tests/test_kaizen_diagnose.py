"""業務改善診断デモ Phase 2：改善候補の検出（決まった規則）と根拠。

- デモのシナリオでは A 廃止・B 簡素化・C 標準化・D 自動化 の4候補が、この順に出る
- 各候補は根拠（工程・業務情報・Excelの列）と確認事項を持つ。廃止には確認の問いがある
- 「必ず残すこと」の工程（合計の照合）は、どの候補でも廃止・簡素化の対象にならない
- 事実が変われば候補も変わる（転記が1つなら A は出ない、列名が同じなら C は出ない など）
- 処理エンジンで行えない工程は「未対応」として示す
- AIは使っていない
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.kaizen.diagnose import column_diffs, diagnose
from app.kaizen.models import Scenario
from app.kaizen.scenarios import SCENARIO_DIR, FileFacts, load_scenario, read_file_facts
from app.main import create_app

RAW = json.loads((SCENARIO_DIR / "monthly_report.json").read_text(encoding="utf-8"))


def scenario(edit=None) -> Scenario:
    data = json.loads(json.dumps(RAW))
    if edit:
        edit(data)
    return Scenario.model_validate(data)


def facts(*headers: list[str], kinds: list[list[str]] | None = None) -> list[FileFacts]:
    return [
        FileFacts(f"部{i}", f"f{i}.xlsx", "売上", list(h), 10, (kinds[i] if kinds else ["text"] * len(h)))
        for i, h in enumerate(headers)
    ]


@pytest.fixture(scope="module")
def demo():
    sc = load_scenario("monthly_report")
    return diagnose(sc, read_file_facts(sc))


def test_デモでは4候補が廃止_簡素化_標準化_自動化の順に出る(demo):
    assert [(c.candidate_id, c.direction, c.rule_id) for c in demo.candidates] == [
        ("A", "eliminate", "KD-1"),
        ("B", "simplify", "KD-2"),
        ("C", "standardize", "KD-3"),
        ("D", "automate", "KD-4"),
    ]
    assert demo.ai_used is False
    assert "AIは使っていません" in demo.method


def test_候補A_会議資料への転記_根拠と確認の問い(demo):
    a = demo.candidates[0]
    assert a.title == "会議用資料への重複転記を廃止"
    assert a.target_steps == ["s5"]
    sources = {(e.source, e.ref) for e in a.evidence}
    assert {("step", "s3"), ("step", "s5"), ("context", "unsure_to_remove")} <= sources
    assert a.confirm_question == "会議用資料への転記は、独立した承認・監査・報告上の要件がありますか？"
    assert any("監査" in c for c in a.checks)


def test_候補B_部署ごとの繰り返し_前提は標準化(demo):
    b = demo.candidates[1]
    assert b.target_steps == ["s2", "s3"]
    assert b.depends_on == ["C"]
    assert sum(e.source == "file" for e in b.evidence) == 3


def test_候補C_実際の列名の違いと共通の列名(demo):
    c = demo.candidates[2]
    got = {d.position: (d.standard, d.names["営業2部"], d.names["法人営業部"]) for d in c.column_diffs}
    assert got == {1: ("売上日", "日付", "売上日"), 2: ("伝票番号", "伝票No", "伝票番号"), 3: ("商品コード", "商品コード", "商品CD"), 6: ("売上金額", "金額", "売上額")}


def test_候補D_自動化できる工程と未対応の工程(demo):
    d = demo.candidates[3]
    assert d.target_steps == ["s1", "s2", "s3", "s4", "s6"]
    assert d.unsupported_steps == ["s5", "s7"]
    assert all("未対応" in e.text for e in d.evidence if e.ref in d.unsupported_steps)


def test_合計の照合は必ず残す_どの候補でも廃止_簡素化の対象にしない(demo):
    assert [k.step_id for k in demo.kept] == ["s6"]
    for c in demo.candidates:
        if c.direction in ("eliminate", "simplify"):
            assert "s6" not in c.target_steps


def test_必ず残す工程が転記でも_廃止の候補にしない():
    def edit(d):
        d["steps"][4]["must_keep"] = True  # 会議用資料への転記を「必ず残す」にする
    sc = scenario(edit)
    got = diagnose(sc, read_file_facts(sc))
    assert "eliminate" not in [c.direction for c in got.candidates]
    assert {k.step_id for k in got.kept} == {"s5", "s6"}


def test_書き写しが1つなら_廃止の候補は出ない():
    sc = scenario(lambda d: d["steps"][4].update(transcribes_from=None))
    got = diagnose(sc, read_file_facts(sc))
    assert [c.direction for c in got.candidates] == ["simplify", "standardize", "automate"]
    assert [c.candidate_id for c in got.candidates] == ["A", "B", "C"]  # 記号は詰めて振る
    assert got.candidates[0].depends_on == ["B"]


def test_列名がそろっていれば_標準化は出ず_簡素化に前提はない():
    sc = load_scenario("monthly_report")
    same = facts(["売上日", "金額"], ["売上日", "金額"], ["売上日", "金額"])
    got = diagnose(sc, same)
    assert "standardize" not in [c.direction for c in got.candidates]
    simplify = next(c for c in got.candidates if c.direction == "simplify")
    assert simplify.depends_on == []


def test_列名の違いの判定_列数や形式が違う位置は推測しない():
    assert column_diffs(facts(["日", "金額"], ["日", "金額", "備考"])) == []
    mixed = column_diffs(facts(["日", "金額"], ["日", "売上"], kinds=[["date", "number"], ["date", "text"]]))
    assert mixed == []
    two = column_diffs(facts(["日", "金額"], ["日", "売上"], kinds=[["date", "number"], ["date", "number"]]))
    assert [(d.position, d.standard) for d in two] == [(2, "金額")]  # 同数なら先のファイルの名前


def test_ファイルが1つなら_簡素化も標準化も出ない():
    sc = load_scenario("monthly_report")
    got = diagnose(sc, facts(["売上日", "金額"]))
    assert [c.direction for c in got.candidates] == ["eliminate", "automate"]


def test_形式は実際のファイルから読む():
    sc = load_scenario("monthly_report")
    for f in read_file_facts(sc):
        assert f.kinds == ["date", "text", "text", "number", "number", "number"]


def test_API_改善候補を返す_AIもパスワードも使わない():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        res = c.post("/api/kaizen/scenarios/monthly_report/diagnose")
        assert res.status_code == 200
        body = res.json()
        assert body["ai_used"] is False
        assert [x["candidate_id"] for x in body["candidates"]] == ["A", "B", "C", "D"]
        assert c.post("/api/kaizen/scenarios/none/diagnose").status_code == 404
