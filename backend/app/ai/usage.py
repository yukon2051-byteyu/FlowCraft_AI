"""AIの利用回数と費用の上限（docs/ai-auth-design.md §4）。

- 呼び出す前に、その呼び出しで最大いくらかかりうるか（入力の見積もり＋出力の上限）を先に確保する。
  ロックの中で行うので、同時に呼ばれても上限を超えない。終わったら実際の費用に直す（失敗したら確保を戻す）
- 上限：全体の月の予算（ai_monthly_budget_usd）と、セッションごとの1時間あたりの回数（ai_calls_per_hour）
- 記録するのは、機能・日時・トークン数・費用だけ。業務データ・パスワード・APIキーは記録しない
- メモリ上だけに持つ（サーバーを起動し直すと月の合計は0から数え直す。公開時の永続化は今後の課題）
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.errors import AppError

# 100万トークンあたりの料金（ドル）：入力・出力。出典：Claude API の資料（2026-11-16 確認）
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "fixed": (0.0, 0.0),  # 固定応答モード（AIを呼ばない）
}
# 一覧にないモデルは、高めの料金で見積もる（上限を甘くしない）
UNKNOWN_PRICE: tuple[float, float] = (10.0, 50.0)

MAX_RECORDS = 1000


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = PRICES_PER_MTOK.get(model, UNKNOWN_PRICE)
    return (input_tokens * pin + output_tokens * pout) / 1_000_000


def estimate_input_tokens(text: str) -> int:
    """入力のトークン数の見積もり（多めに）。日本語は1文字が1トークン前後になるため、文字数をそのまま使い、余裕を足す"""
    return len(text) + 500


@dataclass
class UsageRecord:
    feature: str
    at: str  # 日時（ISO形式・UTC）
    input_tokens: int
    output_tokens: int
    cost_usd: float


@dataclass
class _Reservation:
    reservation_id: int
    month: str
    amount: float


@dataclass
class UsageLedger:
    monthly_budget_usd: float
    calls_per_hour: int
    clock: Callable[[], float] = time.time
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _month: str = ""
    _spent: float = 0.0
    _reserved: dict[int, _Reservation] = field(default_factory=dict)
    _next_id: int = 1
    _calls: dict[str, list[float]] = field(default_factory=dict)  # セッション → 呼び出した時刻
    records: list[UsageRecord] = field(default_factory=list)

    def _month_key(self) -> str:
        return datetime.fromtimestamp(self.clock(), tz=timezone.utc).strftime("%Y-%m")

    def _roll_month_locked(self) -> None:
        m = self._month_key()
        if m != self._month:
            self._month, self._spent = m, 0.0
            self._reserved = {k: r for k, r in self._reserved.items() if r.month == m}

    def calls_left(self, session_id: str) -> int:
        with self._lock:
            now = self.clock()
            recent = [t for t in self._calls.get(session_id, []) if now - t < 3600]
            return max(0, self.calls_per_hour - len(recent))

    def reserve(self, session_id: str, max_cost: float) -> int:
        """上限の範囲なら確保して番号を返す。超えるなら AI を呼ばずに理由を返す（429）"""
        with self._lock:
            self._roll_month_locked()
            now = self.clock()
            recent = [t for t in self._calls.get(session_id, []) if now - t < 3600]
            if len(recent) >= self.calls_per_hour:
                raise AppError(
                    429,
                    "AI_LIMIT_REACHED",
                    "AIの利用回数の上限に達しました。",
                    cause=f"1時間に{self.calls_per_hour}回までです。",
                    how_to_fix="しばらく待ってから、もう一度お試しください。AIを使わずに手順を作ることもできます。",
                )
            pending = sum(r.amount for r in self._reserved.values())
            if self._spent + pending + max_cost > self.monthly_budget_usd:
                raise AppError(
                    429,
                    "AI_BUDGET_REACHED",
                    "今月のAIの利用上限に達しました。",
                    cause="AIの費用が、今月の上限に達したため、AIを呼び出しませんでした。",
                    how_to_fix="来月までお待ちください。AIを使わずに手順を作ることはできます。",
                )
            rid = self._next_id
            self._next_id += 1
            self._reserved[rid] = _Reservation(rid, self._month, max_cost)
            self._calls[session_id] = [*recent, now]
            return rid

    def commit(self, reservation_id: int, feature: str, model: str, input_tokens: int, output_tokens: int) -> UsageRecord:
        """実際の費用に直して記録する"""
        with self._lock:
            r = self._reserved.pop(reservation_id, None)
            self._roll_month_locked()
            cost = cost_usd(model, input_tokens, output_tokens)
            if r is None or r.month == self._month:
                self._spent += cost
            rec = UsageRecord(feature, datetime.fromtimestamp(self.clock(), tz=timezone.utc).isoformat(), input_tokens, output_tokens, round(cost, 6))
            self.records.append(rec)
            del self.records[:-MAX_RECORDS]
            return rec

    def release(self, reservation_id: int) -> None:
        """AIを呼べなかったとき、確保を戻す（呼び出しの回数は数えたままにする：失敗を繰り返して上限を回避させない）"""
        with self._lock:
            self._reserved.pop(reservation_id, None)

    @property
    def spent_usd(self) -> float:
        with self._lock:
            self._roll_month_locked()
            return self._spent
