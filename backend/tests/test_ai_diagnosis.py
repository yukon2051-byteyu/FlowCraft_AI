"""A-3：AI業務改善診断の質問（データからは分からない業務の背景だけを、初回は3問まで聞く）。実際のAIは呼ばない。

- 固定応答モードで、質問・なぜ聞くか・回答の例を返す
- 同じ材料なら前回の結果を返し、AIを呼ばない（費用の節約）。材料が変われば聞き直す
- 認証していなければ使えない（401）。AIを使わない設定なら使えない（503）
- 実際のAIへ渡す文章は、サーバーで組み立てた材料（個人情報と思われる値は入らない）。4問以上返っても見せるのは3問まで
すべて架空のデータ。
"""

from types import SimpleNamespace

import pytest

import app.ai.client as ai_client
from app.ai.diagnosis import QuestionsOut
from tests.test_ai_foundation import PASSWORD, FakeMessages, make, usage

BODY = {"name": "顧客対応の集計", "purpose": "月ごとに件数と金額をまとめ、部長に報告する"}
CSV = "受付日,氏名,金額\n2026-10-01,山田 太郎,1200\n2026-10-02,佐藤 花子,800\n"


def code(res) -> str:
    return res.json()["error"]["code"]


def test_固定応答モード_質問は3問まで_なぜ聞くかと回答の例を添える():
    client, app, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    res = client.post("/api/ai/diagnosis/questions", json=BODY)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "fixed" and body["cached"] is False
    assert 1 <= len(body["questions"]) <= 3
    for q in body["questions"]:
        assert q["question"] and q["why"] and q["examples"]
    assert len(body["fingerprint"]) == 64


def test_同じ材料ならAIを呼ばずに前回の結果を返し_材料が変われば聞き直す():
    client, app, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    first = client.post("/api/ai/diagnosis/questions", json=BODY).json()
    again = client.post("/api/ai/diagnosis/questions", json=BODY).json()
    assert again["cached"] is True and again["questions"] == first["questions"]
    assert len(app.state.ai.ledger.records) == 1  # 2回目はAIを呼んでいない
    changed = client.post("/api/ai/diagnosis/questions", json={**BODY, "purpose": "月ごとに件数をまとめる"}).json()
    assert changed["cached"] is False
    assert len(app.state.ai.ledger.records) == 2


def test_認証していなければ401_AIを使わない設定なら503():
    client, _, _ = make()
    assert code(client.post("/api/ai/diagnosis/questions", json=BODY)) == "AI_AUTH_REQUIRED"
    off, _, _ = make(ai_mode="off")
    assert code(off.post("/api/ai/diagnosis/questions", json=BODY)) == "AI_UNAVAILABLE"


def test_実際のAI_渡す文章は材料そのもので個人情報の値は入らず_見せるのは3問まで(monkeypatch):
    many = QuestionsOut(
        understanding="件数と金額を月ごとにまとめる業務と把握しました。",
        questions=[{"question": f"質問{i}", "why": "理由", "examples": []} for i in range(1, 6)],
    )
    msgs = FakeMessages(SimpleNamespace(stop_reason="end_turn", parsed_output=many, usage=usage(3000, 800)))
    monkeypatch.setattr(ai_client, "make_client", lambda settings: SimpleNamespace(messages=msgs))
    client, app, _ = make(ai_mode="auto", anthropic_api_key="sk-test-secret-value")
    client.post("/api/ai/auth", json={"password": PASSWORD})
    fid = client.post("/api/files", files={"file": ("顧客対応.csv", CSV.encode("utf-8"))}).json()["file_id"]
    # 画面から別の文章を送ってきても、AIに渡すのはサーバーで組み立てた材料だけ
    res = client.post("/api/ai/diagnosis/questions", json={**BODY, "text": "ここに何か書いても使わない", "files": [{"file_id": fid}]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [q["question"] for q in body["questions"]] == ["質問1", "質問2", "質問3"]
    sent = msgs.calls[0]
    content = sent["messages"][0]["content"]
    assert "月ごとに件数と金額をまとめ、部長に報告する" in content
    assert "列「氏名」" in content and "山田" not in content and "佐藤" not in content
    assert "ここに何か書いても使わない" not in content
    assert "データだけでは分からない業務の背景だけを聞く" in sent["system"]
    assert sent["output_format"] is QuestionsOut


@pytest.mark.parametrize("bad", [{"understanding": "", "questions": []}, {"questions": [{"question": "q", "why": "w"}]}])
def test_固定応答の形が崩れていても_使わずに502(monkeypatch, bad):
    monkeypatch.setitem(ai_client.FIXED_RESPONSES, "diagnosis_questions", lambda _: bad)
    client, _, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    res = client.post("/api/ai/diagnosis/questions", json=BODY)
    assert res.status_code == 502 and code(res) == "AI_BAD_OUTPUT"


# ===================== A-4：改善提案 =====================

import json
from pathlib import Path

from app.ai.diagnosis import ProposalsOut

FLOW = json.loads((Path(__file__).parent.parent / "app" / "demos" / "flows" / "demo_monthly_sales.json").read_text(encoding="utf-8"))
ANSWERS = [{"question": "いちばん時間がかかるのは？", "answer": "合計の確認"}]


def test_提案は重要な順で_初めに見せるのは3件_材料にない列のデータ根拠は推測に格下げする():
    client, app, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    fid = client.post("/api/files", files={"file": ("顧客対応.csv", CSV.encode("utf-8"))}).json()["file_id"]
    res = client.post("/api/ai/diagnosis/proposals", json={**BODY, "files": [{"file_id": fid}], "answers": ANSWERS})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [p["direction"] for p in body["proposals"]] == ["eliminate", "automate", "standardize", "simplify"]
    assert body["shown_first"] == 3
    auto = next(p for p in body["proposals"] if p["direction"] == "automate")
    # 材料にある列を挙げた根拠は「データ」のまま
    assert auto["evidence"][0]["source"] == "data" and auto["evidence"][0]["downgraded"] is False
    assert auto["estimate"] == {"kind": "assumed", "text": "月に約30分（仮定：確認に毎回30分かかっている場合）"}
    std = next(p for p in body["proposals"] if p["direction"] == "standardize")
    # 材料にない列を「データ」として挙げた根拠は、推測に格下げ（事実のように見せない）
    assert std["evidence"][0] == {"source": "inference", "text": "材料にない列を挙げた例（推測に格下げされる）。", "ref": "列「存在しない列」", "downgraded": True}


def test_同じ材料と回答ならAIを呼ばず_回答が変われば作り直す():
    client, app, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    first = client.post("/api/ai/diagnosis/proposals", json={**BODY, "answers": ANSWERS}).json()
    again = client.post("/api/ai/diagnosis/proposals", json={**BODY, "answers": ANSWERS}).json()
    assert again["cached"] is True and again["proposals"] == first["proposals"]
    assert len(app.state.ai.ledger.records) == 1
    changed = client.post("/api/ai/diagnosis/proposals", json={**BODY, "answers": [{"question": "いちばん時間がかかるのは？", "answer": "転記"}]}).json()
    assert changed["cached"] is False and len(app.state.ai.ledger.records) == 2


def test_実際のAI_回答を材料と一緒に渡し_ステップ番号の根拠も照らし合わせる(monkeypatch):
    out = ProposalsOut(
        proposals=[
            {
                "direction": "simplify",
                "title": "2回の集計を1回に",
                "target": "集計",
                "problem": "部署別とカテゴリ別に2回集計している",
                "change": "同じ表から2つの集計を作る",
                "evidence": [
                    {"source": "data", "text": "ステップ7で集計している", "ref": "ステップ7"},
                    {"source": "data", "text": "ステップ99で何かしている", "ref": "ステップ99"},
                    {"source": "data", "text": "品質ルールがある", "ref": "対象月の伝票だけ"},
                ],
                "effect": "集計の手間が減る",
                "recommendation": "結果が同じか確かめる",
                "priority": 1,
            }
        ],
    )
    msgs = FakeMessages(SimpleNamespace(stop_reason="end_turn", parsed_output=out, usage=usage(5000, 1500)))
    monkeypatch.setattr(ai_client, "make_client", lambda settings: SimpleNamespace(messages=msgs))
    client, app, _ = make(ai_mode="auto", anthropic_api_key="sk-test-secret-value")
    client.post("/api/ai/auth", json={"password": PASSWORD})
    body = client.post("/api/ai/diagnosis/proposals", json={**BODY, "flow": FLOW, "answers": ANSWERS}).json()
    ev = body["proposals"][0]["evidence"]
    assert [(e["source"], e["downgraded"]) for e in ev] == [("data", False), ("inference", True), ("data", False)]
    sent = msgs.calls[0]
    assert "回答：合計の確認" in sent["messages"][0]["content"]
    assert "自動化ありきの提案はしない" in sent["system"]
    assert sent["output_format"] is ProposalsOut


def test_効果を実測と名乗る応答は_形が違うとして使わない(monkeypatch):
    original = ai_client.FIXED_RESPONSES["diagnosis_proposals"]  # 差し替える前の固定応答

    def bad(_):
        p = original("")
        p["proposals"][0]["estimate"] = {"kind": "measured", "text": "月に30分減った"}
        return p

    monkeypatch.setitem(ai_client.FIXED_RESPONSES, "diagnosis_proposals", bad)
    client, _, _ = make()
    client.post("/api/ai/auth", json={"password": PASSWORD})
    res = client.post("/api/ai/diagnosis/proposals", json={**BODY, "answers": ANSWERS})
    assert res.status_code == 502 and code(res) == "AI_BAD_OUTPUT"
