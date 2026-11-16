"""AI業務改善診断（A-3：不足情報の質問）。

材料（app/ai/context.py）はサーバーで組み立て直してからAIに送る（画面から届いた文章をそのまま渡さない）。
AIには、データから分かることは聞かせず、業務の背景（なぜその作業をするのか、なくすと誰が困るのか など）だけを聞かせる。
初回は3問まで。各質問に「なぜ聞くか」を添える。回答は任意（答えなくても診断を進められる）。
同じ材料なら前回の結果を返し、AIを呼ばない（費用の節約）。
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field

from app.ai.client import fixed_response
from app.ai.context import ContextRequest, build_context
from app.ai.guard import AiContext, run_ai

MAX_FIRST_QUESTIONS = 3

Short = Annotated[str, Field(min_length=1, max_length=200)]


class DiagnosisQuestion(BaseModel):
    question: Short
    why: Short  # なぜ聞くか（短く）
    examples: Annotated[list[Annotated[str, Field(max_length=80)]], Field(max_length=3)] = Field(default_factory=list)  # 回答の例


class QuestionsOut(BaseModel):
    """AIの出力の形（構造化出力）"""

    understanding: Annotated[str, Field(min_length=1, max_length=400)]  # 今の情報から把握したこと（1〜2文）
    questions: Annotated[list[DiagnosisQuestion], Field(max_length=6)]


class QuestionsResponse(BaseModel):
    understanding: str
    questions: list[DiagnosisQuestion]
    fingerprint: str
    cached: bool  # 前回の結果を返した（AIは呼んでいない）
    mode: str  # fixed（固定応答）／live（実際のAI）


SYSTEM_QUESTIONS = """あなたは業務改善の専門家です。利用者の業務を、廃止→簡素化→標準化→自動化の順に見直す手伝いをします。
今は、改善案を作る前に、利用者に質問する段階です。

守ること：
- 材料（業務の説明・作業手順・品質ルール・Excelの列と値の傾向）から分かることは質問しない。
- データだけでは分からない業務の背景だけを聞く。優先する観点：なぜその作業をしているのか／その作業をなくすと誰が困るのか／その確認や承認は本当に必要か／何を満たせば業務として正しく完了したといえるか／最も時間がかかる工程はどれか／過去にどんなミスや手戻りがあったか。
- 質問は多くても3問。少なくてよいなら減らす。1問に1つのことだけを聞く。
- 各質問に「なぜ聞くか」を1文で添える（例：「使われていない資料なら、作らずに済む可能性があるため」）。回答の例を2〜3個添える。
- 個人情報（氏名・連絡先など）を聞かない。
- 材料の「足りない情報」に書かれたものは、ないものとして扱う（あると決めつけない）。
- 利用者は業務の担当者で、専門用語に詳しくない。やさしい日本語で書く。
- understanding には、材料から把握したことを1〜2文で書く（推測は推測と分かる書き方にする）。"""


@fixed_response("diagnosis_questions")
def _fixed_questions(_: str) -> dict:
    return {
        "understanding": "固定応答モードの例です（AIは呼んでいません）。入力された業務の説明と材料を受け取りました。",
        "questions": [
            {
                "question": "この作業の結果（資料・集計表）は、誰が、何に使っていますか？",
                "why": "使われていない資料や集計なら、作らずに済む可能性があるためです。",
                "examples": ["部長が会議で使う", "経理に送るだけ", "使っているか分からない"],
            },
            {
                "question": "作業の中で、いちばん時間がかかるのはどこですか？",
                "why": "効果の大きい工程から改善を考えるためです。",
                "examples": ["マスタからの転記", "合計が合うかの確認"],
            },
            {
                "question": "これまでに、どんなミスや手戻りがありましたか？",
                "why": "品質ルールで防ぐべき点を見つけるためです。",
                "examples": ["別の月のデータが混ざった", "転記ミスで合計がずれた"],
            },
        ],
    }


def ask_questions(ctx: AiContext, req: ContextRequest) -> QuestionsResponse:
    material = build_context(ctx.session, req)
    key = f"questions:{material.fingerprint}"
    cached = ctx.session.ai_cache.get(key)
    if isinstance(cached, QuestionsOut):
        return QuestionsResponse(understanding=cached.understanding, questions=cached.questions[:MAX_FIRST_QUESTIONS], fingerprint=material.fingerprint, cached=True, mode=ctx.settings.ai_status)
    result = run_ai(ctx, "diagnosis_questions", SYSTEM_QUESTIONS, "# 材料\n\n" + material.text, QuestionsOut, max_tokens=4000)
    out = result.data
    ctx.session.ai_cache[key] = out
    # 初回は3問まで（AIが多く返しても、利用者に一度に見せるのは3問まで）
    return QuestionsResponse(understanding=out.understanding, questions=out.questions[:MAX_FIRST_QUESTIONS], fingerprint=material.fingerprint, cached=False, mode=ctx.settings.ai_status)
