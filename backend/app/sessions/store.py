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
    # 作った利用者のIPアドレス（同じ所から同時に持てる数を制限するために使う。公開先では中継サーバーが付ける本当の送り元）
    client_ip: str | None = None
    # ファイルID → 解析済みデータ。中身の型はファイル管理（タスク1-8）で決める
    files: dict[str, Any] = field(default_factory=dict)
    # 実行ID → 実行結果（直近の数回分だけ保持。ディスクには保存しない）
    runs: dict[str, Any] = field(default_factory=dict)
    # デモが読み込んだファイルの ID。次にデモを始めるときに、これだけを入れ替える
    # （名前で探すと、利用者が自分で読み込んだ同じ名前のファイルまで消してしまうため。2026-11-16）
    demo_file_ids: set[str] = field(default_factory=set)
    # AI使用パスワードの認証（docs/ai-auth-design.md §3）。サーバーのセッションにだけ持つ（ブラウザには置かない）
    ai_auth_at: float | None = None  # 認証した時刻
    ai_last_use: float | None = None  # 最後に認証・AIを使った時刻（ここから一定時間で切れる）
    ai_failures: list[float] = field(default_factory=list)  # 認証に失敗した時刻（回数の制限に使う）
    # AIの結果（材料の指紋ごと）。同じ材料をもう一度AIに送らないために使う（メモリ上だけ。セッションと一緒に消える）
    ai_cache: dict[str, Any] = field(default_factory=dict)


class SessionStore:
    def __init__(self, ttl_seconds: float, max_sessions: int = 200, clock: Callable[[], float] = time.monotonic, max_per_ip: int | None = None):
        self._ttl = ttl_seconds
        self._max = max_sessions
        # 同じIPアドレスから同時に持てる数（None は制限なし）。1人で全体の上限を埋められないようにする
        self._max_per_ip = max_per_ip
        self._clock = clock
        self._sessions: dict[str, Session] = {}
        # 複数のリクエストが同時に来ても壊れないよう、出し入れは1つずつ行う
        self._lock = threading.Lock()

    # ----- 発行・取得・削除 -----

    def create(self, client_ip: str | None = None) -> Session:
        with self._lock:
            self._purge_expired_locked()
            if self._max_per_ip is not None and client_ip is not None:
                same = sum(1 for s in self._sessions.values() if s.client_ip == client_ip)
                if same >= self._max_per_ip:
                    raise AppError(
                        429,
                        "TOO_MANY_SESSIONS",
                        "この端末（ネットワーク）から開いている作業が多すぎるため、新しい作業を開始できません。",
                        cause=f"同じ所から同時に開ける作業は{self._max_per_ip}までです。",
                        how_to_fix="使っていないタブを閉じるか、しばらく（最大60分）待ってから、もう一度お試しください。",
                    )
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
            session = Session(session_id=sid, created_at=now, last_access=now, client_ip=client_ip)
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
        how_to_fix="画面を再読み込みして、ファイルをもう一度読み込んでください。保存した作業手順のファイルは引き続き使えます。",
    )
