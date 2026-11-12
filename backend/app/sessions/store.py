"""セッション管理（設計書 §10.1）。

- セッションIDは推測できない乱数（secrets）で発行する。
- データはメモリ上にだけ置き、ディスクには保存しない（無断の永続保存禁止）。
- 最後の操作から ttl が過ぎたセッションは、データごと削除する。
- あるセッションのデータは、そのセッションIDを持つ人しか取り出せない（ユーザー間の混在防止）。

時刻は clock 関数で受け取る。テストで「60分後」を待たずに再現できるようにするため。
"""

from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.errors import AppError

# セッションIDの長さ。secrets.token_urlsafe(32) は約43文字・256ビットの乱数
_TOKEN_BYTES = 32


@dataclass
class Session:
    session_id: str
    created_at: float
    last_access: float
    # ファイルID → 解析済みデータ。中身の型はファイル管理（タスク1-8）で決める
    files: dict[str, Any] = field(default_factory=dict)


class SessionStore:
    def __init__(self, ttl_seconds: float, max_sessions: int = 200, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._max = max_sessions
        self._clock = clock
        self._sessions: dict[str, Session] = {}
        # 複数のリクエストが同時に来ても壊れないよう、出し入れは1つずつ行う
        self._lock = threading.Lock()

    # ----- 発行・取得・削除 -----

    def create(self) -> Session:
        with self._lock:
            self._purge_expired_locked()
            if len(self._sessions) >= self._max:
                raise AppError(
                    503,
                    "SERVER_BUSY",
                    "現在利用者が多いため、新しい作業を開始できません。",
                    cause="同時に利用できる人数の上限に達しています。",
                    how_to_fix="しばらく待ってから、もう一度お試しください。",
                )
            now = self._clock()
            sid = secrets.token_urlsafe(_TOKEN_BYTES)
            session = Session(session_id=sid, created_at=now, last_access=now)
            self._sessions[sid] = session
            return session

    def get(self, session_id: str | None) -> Session:
        """有効なセッションを返し、最終操作時刻を更新する。無効なら AppError(401)。"""
        if not session_id:
            raise _session_error("SESSION_REQUIRED", "作業セッションが開始されていません。")
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise _session_error(
                    "SESSION_NOT_FOUND",
                    "作業セッションが見つかりません。時間切れで削除された可能性があります。",
                )
            now = self._clock()
            if self._is_expired(session, now):
                del self._sessions[session_id]
                raise _session_error(
                    "SESSION_EXPIRED",
                    "一定時間操作がなかったため、読み込んだデータを削除しました。",
                )
            session.last_access = now
            return session

    def delete(self, session_id: str) -> bool:
        """利用者が作業を終了したとき、データを即座に削除する。"""
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    # ----- 期限切れの掃除 -----

    def purge_expired(self) -> int:
        """期限切れのセッションを削除し、削除した数を返す（定期的に呼ぶ）。"""
        with self._lock:
            return self._purge_expired_locked()

    def _purge_expired_locked(self) -> int:
        now = self._clock()
        expired = [sid for sid, s in self._sessions.items() if self._is_expired(s, now)]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)

    def _is_expired(self, session: Session, now: float) -> bool:
        return now - session.last_access >= self._ttl

    # ----- 情報 -----

    def remaining_seconds(self, session: Session) -> int:
        return max(0, int(self._ttl - (self._clock() - session.last_access)))

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)


def _session_error(code: str, message: str) -> AppError:
    return AppError(
        401,
        code,
        message,
        how_to_fix="画面を再読み込みして、ファイルをもう一度読み込んでください。保存したフロー（.json）は引き続き使えます。",
    )
