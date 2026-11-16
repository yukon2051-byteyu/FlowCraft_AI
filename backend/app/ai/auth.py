"""AI使用パスワードの認証（docs/ai-auth-design.md §3）。

- 認証に成功したら、サーバーのセッションに「AIを使ってよい」印（期限つき）を付ける。ブラウザには何も残さない
- 期限：最後にAIを使ってから ai_auth_idle_minutes、最長 ai_auth_max_hours。過ぎたら再認証
- 失敗の制限：同じセッション・同じ接続元で、それぞれ15分に5回まで。超えたらしばらく受け付けない
- パスワードの照合はハッシュで行う（app/ai/password.py）。パスワードそのものはどこにも記録しない
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Request

from app.ai.password import verify_password
from app.ai.usage import UsageLedger
from app.config import Settings
from app.errors import AppError
from app.sessions.store import Session

FAIL_WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 5


@dataclass
class AiState:
    """アプリ全体で1つ持つ、AIの状態（費用の記録・接続元ごとの失敗回数）"""

    ledger: UsageLedger
    clock: Callable[[], float] = time.time
    ip_failures: dict[str, list[float]] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


def get_ai_state(request: Request) -> AiState:
    return request.app.state.ai


def unavailable() -> AppError:
    return AppError(
        503,
        "AI_UNAVAILABLE",
        "AI機能は現在利用できません。",
        cause="このサーバーでは、AIの利用が設定されていません。",
        how_to_fix="AIを使わずに手順を作れます（「改善診断をせずに手順を作る」を選んでください）。",
    )


def authenticate(state: AiState, session: Session, client_ip: str, password: str, settings: Settings) -> None:
    if settings.ai_status == "off":
        raise unavailable()
    now = state.clock()
    with state.lock:
        session.ai_failures = [t for t in session.ai_failures if now - t < FAIL_WINDOW_SECONDS]
        ip = [t for t in state.ip_failures.get(client_ip, []) if now - t < FAIL_WINDOW_SECONDS]
        state.ip_failures[client_ip] = ip
        if len(session.ai_failures) >= MAX_FAILURES or len(ip) >= MAX_FAILURES:
            raise AppError(
                429,
                "AI_AUTH_LOCKED",
                "パスワードの入力に続けて失敗したため、しばらく受け付けません。",
                cause=f"{FAIL_WINDOW_SECONDS // 60}分の間に{MAX_FAILURES}回失敗しました。",
                how_to_fix=f"{FAIL_WINDOW_SECONDS // 60}分ほど待ってから、もう一度お試しください。AIを使わない機能は、そのまま使えます。",
            )
    hashed = settings.ai_password_hash.get_secret_value() if settings.ai_password_hash else ""
    if not verify_password(password, hashed):
        with state.lock:
            session.ai_failures.append(now)
            state.ip_failures.setdefault(client_ip, []).append(now)
        raise AppError(401, "AI_AUTH_FAILED", "パスワードが正しくありません。", how_to_fix="AI使用パスワードを確かめて、もう一度入力してください。")
    session.ai_auth_at = now
    session.ai_last_use = now
    session.ai_failures = []


def auth_expires_at(state: AiState, session: Session, settings: Settings) -> float | None:
    """認証の期限（時刻）。認証していない・期限が過ぎたときは None（期限切れなら印を消す）"""
    if session.ai_auth_at is None or session.ai_last_use is None:
        return None
    end = min(session.ai_last_use + settings.ai_auth_idle_minutes * 60, session.ai_auth_at + settings.ai_auth_max_hours * 3600)
    if state.clock() >= end:
        logout(session)
        return None
    return end


def logout(session: Session) -> None:
    session.ai_auth_at = None
    session.ai_last_use = None
