"""すべてのAIのAPIで使う確認の部品（docs/ai-auth-design.md §4）。

  require_ai：AIを使えるか（off なら 503）・認証済みか（401 AI_AUTH_REQUIRED）を、AIを呼ぶ前に確かめる（FastAPI の依存関係）
  run_ai    ：上限の範囲か確かめて費用を先に確保 → 呼び出し → 実際の費用に直して記録
画面のボタンを隠すだけの制御はしない（サーバーで必ず確かめる）。
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends

from app.ai.auth import AiState, auth_expires_at, get_ai_state, unavailable
from app.ai.client import AiOutputError, AiResult, T, call_structured
from app.ai.usage import cost_usd, estimate_input_tokens
from app.api.session import current_session
from app.config import Settings, get_settings
from app.errors import AppError
from app.sessions.store import Session


@dataclass
class AiContext:
    session: Session
    settings: Settings
    state: AiState

    @property
    def model(self) -> str:
        # 固定応答モードは費用がかからない（料金0で記録する）
        return self.settings.claude_model if self.settings.ai_status == "live" else "fixed"


def require_ai(
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
    state: AiState = Depends(get_ai_state),
) -> AiContext:
    if settings.ai_status == "off":
        raise unavailable()
    if auth_expires_at(state, session, settings) is None:
        raise AppError(
            401,
            "AI_AUTH_REQUIRED",
            "この機能ではAIを使用します。AI使用パスワードを入力してください。",
            how_to_fix="AI使用パスワードを入力すると、続けて実行します。AIを使わない機能は、パスワードなしで使えます。",
        )
    return AiContext(session, settings, state)


def run_ai(ctx: AiContext, feature: str, system: str, user: str, output_model: type[T], max_tokens: int) -> AiResult[T]:
    ledger = ctx.state.ledger
    max_cost = cost_usd(ctx.model, estimate_input_tokens(system + user), max_tokens)
    rid = ledger.reserve(ctx.session.session_id, max_cost)
    try:
        result = call_structured(ctx.settings, feature, system, user, output_model, max_tokens)
    except AiOutputError as e:
        # 応答はあった（費用はかかった）が使えない：実際の費用を記録してから、使えない理由を返す
        ledger.commit(rid, feature, ctx.model, e.input_tokens, e.output_tokens)
        raise e.error from None
    except Exception:
        ledger.release(rid)
        raise
    ledger.commit(rid, feature, ctx.model, result.input_tokens, result.output_tokens)
    ctx.session.ai_last_use = ctx.state.clock()
    return result
