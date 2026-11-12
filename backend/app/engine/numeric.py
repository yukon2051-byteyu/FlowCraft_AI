"""金額・小数の計算（設計書 §8）。

- 小数は Decimal（10進数）で計算する。float（2進数）だと 0.1 + 0.2 = 0.30000000000000004 になるため。
- 丸めは「計算の最後に1回」。途中で丸めて誤差を積み上げない。
- 丸め方式はノードごとに選ぶ（確認事項Q2）。
"""

from __future__ import annotations

import decimal
from decimal import Decimal

from app.flow.schema import Rounding

# 計算の有効桁数（金額の合計で桁あふれしない十分な大きさ）
CONTEXT = decimal.Context(prec=50, rounding=decimal.ROUND_HALF_UP, traps=[decimal.InvalidOperation, decimal.Overflow])

ROUNDING_MODES: dict[Rounding, str] = {
    "half_up": decimal.ROUND_HALF_UP,  # 四捨五入（2.5→3, -2.5→-3）
    "down": decimal.ROUND_DOWN,  # 切り捨て（0方向。-2.7→-2）
    "up": decimal.ROUND_UP,  # 切り上げ（0から遠ざかる方向。-2.1→-3）
    "half_even": decimal.ROUND_HALF_EVEN,  # 銀行丸め（2.5→2, 3.5→4）
}

ROUNDING_LABEL: dict[Rounding, str] = {
    "half_up": "四捨五入",
    "down": "切り捨て",
    "up": "切り上げ",
    "half_even": "銀行丸め",
}


def quantize(value: Decimal, scale: int, rounding: Rounding = "half_up") -> Decimal:
    """小数点以下 scale 桁に丸める。例：quantize(Decimal("2.345"), 2) → 2.35"""
    exp = Decimal(1).scaleb(-scale)  # scale=2 → 0.01
    return value.quantize(exp, rounding=ROUNDING_MODES[rounding], context=CONTEXT)


def from_float(v: float) -> Decimal:
    """Excelから来たfloatをDecimalにする。repr（最短の表現）を経由し、2進数の誤差を持ち込まない。

    例：Decimal(0.1) は 0.1000000000000000055511151231257827... だが、from_float(0.1) は 0.1
    """
    return Decimal(repr(v))
