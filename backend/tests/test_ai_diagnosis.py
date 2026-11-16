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
