"""AIの土台のAPI（docs/ai-auth-design.md）。

GET    /api/ai/status ：AIの状態（使わない・固定応答・実際のAI）、認証の状態と残りの時間、今の1時間に使える残りの回数
POST   /api/ai/auth   ：AI使用パスワードで認証する（成功したら、このセッションに期限つきの印を付ける）
DELETE /api/ai/auth   ：認証を解除する（共有のPCで「AIの利用を終える」）
POST   /api/ai/check  ：AIの接続を確かめる（認証と上限の確認を通って、最小の呼び出しを1回行う）
POST   /api/ai/diagnosis/context：AI業務改善診断に送る材料を作り、送る前に見せる（AIは呼ばない・パスワード不要）
パスワード・APIキー・費用の金額は返さない。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.ai.auth import AiState, auth_expires_at, authenticate, get_ai_state, logout
from app.ai.client import fixed_response
from app.ai.context import ContextPreview, ContextRequest, build_context
from app.ai.diagnosis import ProposalsRequest, ProposalsResponse, QuestionsResponse, ask_questions, make_proposals
from app.ai.guard import AiContext, require_ai, run_ai
from app.api.session import current_session
from app.config import Settings, get_settings
from app.sessions.store import Session

router = APIRouter(tags=["ai"])


class AiStatus(BaseModel):
    status: Literal["off", "fixed", "live"]
    authenticated: bool
    expires_in_seconds: int | None
    calls_left_this_hour: int


class AuthRequest(BaseModel):
    password: str = Field(max_length=200)


def _status(state: AiState, session: Session, settings: Settings) -> AiStatus:
    end = auth_expires_at(state, session, settings)
    return AiStatus(
        status=settings.ai_status,
        authenticated=end is not None,
        expires_in_seconds=None if end is None else max(0, int(end - state.clock())),
        calls_left_this_hour=state.ledger.calls_left(session.session_id),
    )


@router.get("/ai/status", response_model=AiStatus)
def ai_status(session: Session = Depends(current_session), settings: Settings = Depends(get_settings), state: AiState = Depends(get_ai_state)) -> AiStatus:
    return _status(state, session, settings)


@router.post("/ai/auth", response_model=AiStatus)
def ai_auth(
    body: AuthRequest,
    request: Request,
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
    state: AiState = Depends(get_ai_state),
) -> AiStatus:
    authenticate(state, session, request.client.host if request.client else "unknown", body.password, settings)
    return _status(state, session, settings)


@router.delete("/ai/auth", status_code=204)
def ai_logout(session: Session = Depends(current_session)) -> Response:
    logout(session)
    return Response(status_code=204)


@router.post("/ai/diagnosis/context", response_model=ContextPreview)
def diagnosis_context(req: ContextRequest, session: Session = Depends(current_session)) -> ContextPreview:
    """AI業務改善診断に送る材料（A-2）。AIは呼ばないので、パスワードは求めない。

    送る前に利用者に見せる文章と、実際に送る文章は同じ（text）。個人情報と思われる列の値は送らない（excluded）。
    """
    return build_context(session, req)


@router.post("/ai/diagnosis/questions", response_model=QuestionsResponse)
def diagnosis_questions(req: ContextRequest, ctx: AiContext = Depends(require_ai)) -> QuestionsResponse:
    """AI業務改善診断：データからは分からない業務の背景を、AIに質問してもらう（初回は3問まで。A-3）。

    材料はサーバーで組み立て直す。同じ材料なら前回の結果を返し、AIは呼ばない。
    """
    return ask_questions(ctx, req)


@router.post("/ai/diagnosis/proposals", response_model=ProposalsResponse)
def diagnosis_proposals(req: ProposalsRequest, ctx: AiContext = Depends(require_ai)) -> ProposalsResponse:
    """AI業務改善診断：材料と回答をもとに改善提案を作る（A-4）。

    「データ」とされた根拠は材料と照らし合わせ、確かめられなければ推測に格下げする。効果の数値は推定・仮定だけ（実測とは名乗らせない）。
    同じ材料と回答なら前回の結果を返し、AIは呼ばない。
    """
    return make_proposals(ctx, req)


class CheckResult(BaseModel):
    ok: bool
    message: str = Field(max_length=200)


@fixed_response("check")
def _check_fixed(_: str) -> dict:
    return {"ok": True, "message": "固定応答モードで動いています（AIは呼んでいません）"}


@router.post("/ai/check", response_model=CheckResult)
def ai_check(ctx: AiContext = Depends(require_ai)) -> CheckResult:
    result = run_ai(
        ctx,
        "check",
        system="あなたは接続確認の応答係です。",
        user="接続の確認です。ok を true にし、message に「接続できました」と書いてください。",
        output_model=CheckResult,
        max_tokens=2000,
    )
    return result.data
