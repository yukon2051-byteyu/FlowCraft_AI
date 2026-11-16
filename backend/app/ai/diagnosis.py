"""AI業務改善診断（A-3：不足情報の質問／A-4：改善提案）。

材料（app/ai/context.py）はサーバーで組み立て直してからAIに送る（画面から届いた文章をそのまま渡さない）。
AIには、データから分かることは聞かせず、業務の背景（なぜその作業をするのか、なくすと誰が困るのか など）だけを聞かせる。
初回は3問まで。各質問に「なぜ聞くか」を添える。回答は任意（答えなくても診断を進められる）。
同じ材料なら前回の結果を返し、AIを呼ばない（費用の節約）。
"""

from __future__ import annotations

import hashlib
import re
from typing import Annotated, Literal

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



# ---------------------------------------------------------------------------
# A-4：改善提案
# ---------------------------------------------------------------------------

MAX_SHOWN_FIRST = 3  # 初めに見せる提案の数（ほかは画面で開いて見る）

Text = Annotated[str, Field(min_length=1, max_length=400)]


class Answer(BaseModel):
    question: Annotated[str, Field(max_length=200)]
    answer: Annotated[str, Field(max_length=1000)] = ""


class ProposalsRequest(ContextRequest):
    answers: Annotated[list[Answer], Field(max_length=6)] = Field(default_factory=list)


class Evidence(BaseModel):
    # data：材料（Excelの列・作業手順のステップ・品質ルール）で確かめられる事実／answer：利用者の回答／inference：AIの推測
    source: Literal["data", "answer", "inference"]
    text: Text
    # source が data のときの根拠の場所：列名（「列「売上金額」」のように）・ステップ番号（「ステップ3」）・品質ルールの名前
    ref: Annotated[str, Field(max_length=120)] = ""


class EffectEstimate(BaseModel):
    # 実測はまだない（実行の実績がない）ので、推定（材料からの見積もり）か仮定（置いた前提での試算）だけ
    kind: Literal["estimated", "assumed"]
    text: Annotated[str, Field(min_length=1, max_length=200)]  # 例：「月に約60分（仮定：4部署×15分）」


class Proposal(BaseModel):
    direction: Literal["eliminate", "simplify", "standardize", "automate"]
    title: Annotated[str, Field(min_length=1, max_length=80)]
    target: Annotated[str, Field(min_length=1, max_length=200)]  # 改善の対象の工程
    problem: Text  # 今の問題
    change: Text  # 改善の内容
    evidence: Annotated[list[Evidence], Field(min_length=1, max_length=6)]  # 理由・根拠
    effect: Text  # 期待できる効果（数値を出せないときは文章だけ）
    estimate: EffectEstimate | None = None
    risks: Annotated[list[Text], Field(max_length=4)] = Field(default_factory=list)  # 想定されるリスク（品質・内部統制）
    recommendation: Text  # 推奨する対応
    priority: Annotated[int, Field(ge=1, le=10)]  # 重要度（1がいちばん高い）


class ProposalsOut(BaseModel):
    """AIの出力の形（構造化出力）"""

    proposals: Annotated[list[Proposal], Field(max_length=8)]
    note: Annotated[str, Field(max_length=400)] = ""  # 足りない情報などの断り書き


class CheckedEvidence(Evidence):
    # data として出されたが、材料で確かめられなかった（推測に格下げした）
    downgraded: bool = False


class CheckedProposal(Proposal):
    proposal_id: str
    evidence: list[CheckedEvidence]  # type: ignore[assignment]


class ProposalsResponse(BaseModel):
    proposals: list[CheckedProposal]  # 重要な順
    shown_first: int  # 初めに見せる数
    note: str
    fingerprint: str
    cached: bool
    mode: str


DIRECTION_ORDER = {"eliminate": 0, "simplify": 1, "standardize": 2, "automate": 3}

SYSTEM_PROPOSALS = """あなたは業務改善の専門家です。材料（業務の説明・作業手順・品質ルール・Excelの列と値の傾向）と、利用者の回答をもとに、改善提案を作ります。

守ること：
- 検討の順番は、廃止（そもそも不要ではないか）→簡素化（工程や確認の回数を減らせないか）→標準化（人によるばらつきをなくせないか）→自動化（残すべき作業をプログラムで処理できないか）。自動化ありきの提案はしない。
- 品質や内部統制が下がるおそれがあれば、risks に必ず書く。承認・監査・法令などで必要な作業を、根拠なく廃止しない（利用者が「必須」と答えたものは廃止を勧めない）。
- 根拠（evidence）は種類を分ける。data：材料に書かれている事実（ref に「列「〇〇」」「ステップN」「品質ルールの名前」のどれかを書く）／answer：利用者の回答／inference：あなたの推測。材料にない列やステップを data として書かない。
- 効果の数値を出せないときは、文章だけにして estimate は出さない。出すときは estimated（材料からの見積もり）か assumed（前提を置いた試算。前提を文中に書く）。根拠のない削減率・削減時間は書かない。実測とは書かない。
- 提案は多くても5件。priority は重要度（1がいちばん高い）。
- 材料の「足りない情報」に書かれたものは、ないものとして扱う。足りないために言い切れないことは note に書く。
- 利用者は業務の担当者。やさしい日本語で、1項目は短く書く。"""


def _column_names(text: str) -> set[str]:
    return set(re.findall(r"列「(.+?)」", text))


def _check_evidence(ev: Evidence, material_text: str, step_count: int, rule_names: set[str]) -> CheckedEvidence:
    """data の根拠が、材料で確かめられるかを照らし合わせる。確かめられなければ推測に格下げする（事実のように見せない）"""
    if ev.source != "data":
        return CheckedEvidence(**ev.model_dump())
    ref = ev.ref.strip()
    ok = False
    if (m := re.fullmatch(r"列「(.+)」", ref)) is not None:
        ok = m.group(1) in _column_names(material_text)
    elif (m := re.fullmatch(r"ステップ(\d+)", ref)) is not None:
        ok = 1 <= int(m.group(1)) <= step_count
    elif ref:
        ok = ref in rule_names
    if ok:
        return CheckedEvidence(**ev.model_dump())
    return CheckedEvidence(source="inference", text=ev.text, ref=ref, downgraded=True)


@fixed_response("diagnosis_proposals")
def _fixed_proposals(user: str) -> dict:
    cols = re.findall(r"列「(.+?)」", user)
    data_ev = {"source": "data", "text": f"材料に「{cols[0]}」の列があります。", "ref": f"列「{cols[0]}」"} if cols else {"source": "inference", "text": "材料からは列を確かめられませんでした。"}
    return {
        "note": "固定応答モードの例です（AIは呼んでいません）。",
        "proposals": [
            {
                "direction": "automate", "title": "集計と確認を作業手順にする", "target": "集計・合計の確認",
                "problem": "毎回、手作業で集計し、合計が合うかを目で確かめている。", "change": "集計と合計の照合を、保存できる作業手順にする。",
                "evidence": [data_ev, {"source": "answer", "text": "回答：いちばん時間がかかるのは確認の作業。"}],
                "effect": "毎回の集計と確認が、ファイルを指定して実行するだけになる。",
                "estimate": {"kind": "assumed", "text": "月に約30分（仮定：確認に毎回30分かかっている場合）"},
                "risks": ["作業手順の設定を誤ると、毎回同じ誤りが起きる（品質ルールで確かめる）。"],
                "recommendation": "まず1か月分のデータで、手作業の結果と一致するかを確かめてから切り替える。", "priority": 2,
            },
            {
                "direction": "eliminate", "title": "使われていない資料への転記をやめる", "target": "報告資料への転記",
                "problem": "同じ数値を別の資料にも書き写している。", "change": "使われていない資料なら、作るのをやめる。",
                "evidence": [{"source": "inference", "text": "同じ数値を複数の資料に転記している可能性があります。"}],
                "effect": "書き写しが1回減り、転記ミスの起きる箇所がなくなる。",
                "risks": ["監査や承認で必要な資料なら、なくせない。"],
                "recommendation": "資料を使っている人に、必要かどうかを確かめる。", "priority": 1,
            },
            {
                "direction": "standardize", "title": "提出してもらう列名をそろえる", "target": "部署からのファイルの受け取り",
                "problem": "部署ごとに列名が違うと、読み替えが必要になる。", "change": "提出してもらうExcelの列名を統一する。",
                "evidence": [{"source": "data", "text": "材料にない列を挙げた例（推測に格下げされる）。", "ref": "列「存在しない列」"}],
                "effect": "読み替えの手間がなくなる。", "risks": [], "recommendation": "各部署に列名の見本を配る。", "priority": 3,
            },
            {
                "direction": "simplify", "title": "確認の回数を減らす", "target": "目での確認",
                "problem": "同じ確認を2回している。", "change": "品質ルールで自動で確かめ、目での確認は異常のときだけにする。",
                "evidence": [{"source": "inference", "text": "確認が重複している可能性があります。"}],
                "effect": "確認の手間が減る。", "risks": ["自動の確認で見落とす観点がないかを確かめる。"], "recommendation": "品質ルールを設定してから、目での確認を減らす。", "priority": 4,
            },
        ],
    }


def make_proposals(ctx: AiContext, req: ProposalsRequest) -> ProposalsResponse:
    material = build_context(ctx.session, req)
    answered = [a for a in req.answers if a.answer.strip()]
    answers_text = "\n".join(f"- 質問：{a.question}\n  回答：{a.answer.strip()}" for a in answered) or "- （回答なし。質問にはすべて答えていません）"
    user = "# 材料\n\n" + material.text + "\n\n## 利用者の回答\n" + answers_text
    fp = hashlib.sha256(user.encode("utf-8")).hexdigest()
    key = f"proposals:{fp}"
    cached = isinstance(ctx.session.ai_cache.get(key), ProposalsOut)
    if cached:
        out: ProposalsOut = ctx.session.ai_cache[key]
    else:
        out = run_ai(ctx, "diagnosis_proposals", SYSTEM_PROPOSALS, user, ProposalsOut, max_tokens=8000).data
        ctx.session.ai_cache[key] = out
    steps = next((s for s in material.sections if s.key == "steps"), None)
    rules = next((s for s in material.sections if s.key == "criteria"), None)
    rule_names = {line.split("（")[0] for line in (rules.lines if rules else [])}
    step_count = len(steps.lines) if steps else 0
    checked = []
    for i, p in enumerate(out.proposals[:5]):  # 多く返っても5件まで
        evidence = [_check_evidence(e, material.text, step_count, rule_names) for e in p.evidence]
        checked.append(CheckedProposal(**{**p.model_dump(), "evidence": [e.model_dump() for e in evidence]}, proposal_id=f"p{i + 1}"))
    # 重要な順（同じ重要度なら、廃止→簡素化→標準化→自動化の順）
    checked.sort(key=lambda p: (p.priority, DIRECTION_ORDER[p.direction]))
    return ProposalsResponse(
        proposals=checked,
        shown_first=min(MAX_SHOWN_FIRST, len(checked)),
        note=out.note,
        fingerprint=fp,
        cached=cached,
        mode=ctx.settings.ai_status,
    )
