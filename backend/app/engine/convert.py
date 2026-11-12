"""値の型変換（読込ノード・型変換ノードで使う）。

「変換できない値を黙って空欄にしない」ため、変換関数は (値, 成功したか) を返し、
呼び出し側が失敗件数と例を必ず報告する。
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.engine.numeric import CONTEXT, from_float, quantize
from app.flow.schema import ColumnType, Rounding

_INT_RE = re.compile(r"^[+-]?[0-9]+$")
_INT_COMMA_RE = re.compile(r"^[+-]?[0-9]{1,3}(,[0-9]{3})+$")
_DEC_RE = re.compile(r"^[+-]?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)?(\.[0-9]+)?$")
_DEFAULT_DATE_FORMATS = ("%Y/%m/%d", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")
_TRUE = {"true", "1", "はい", "yes"}
_FALSE = {"false", "0", "いいえ", "no"}

MISSING = None


def is_missing(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def to_string(v: Any) -> str | None:
    """どんな値も表示用の文字列にする（失敗しない）。"""
    if is_missing(v):
        return None
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, datetime):
        return v.strftime("%Y/%m/%d") if (v.hour, v.minute, v.second) == (0, 0, 0) else v.strftime("%Y/%m/%d %H:%M:%S")
    if isinstance(v, date):
        return v.strftime("%Y/%m/%d")
    return str(v)


def _to_integer(v: Any) -> int | None:
    if isinstance(v, bool):
        return None  # TRUE/FALSE を 1/0 として扱わない
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else None  # 小数部があるものは切り捨てない
    if isinstance(v, Decimal):
        return int(v) if v.is_finite() and v == v.to_integral_value() else None
    if isinstance(v, str):
        s = v.strip()
        if _INT_RE.match(s) or _INT_COMMA_RE.match(s):
            return int(s.replace(",", ""))
    return None


def _to_decimal(v: Any) -> Decimal | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return Decimal(v)
    if isinstance(v, float):
        return from_float(v) if v == v and v not in (float("inf"), float("-inf")) else None
    if isinstance(v, Decimal):
        return v if v.is_finite() else None
    if isinstance(v, str):
        s = v.strip()
        # 通貨記号・%・全角数字などは黙って取り除かない（変換失敗として報告する）
        if not s or not _DEC_RE.match(s) or s in ("+", "-", ".", "+.", "-."):
            return None
        try:
            d = Decimal(s.replace(",", ""), context=CONTEXT)
        except InvalidOperation:
            return None
        return d if d.is_finite() else None
    return None


def _to_date(v: Any, date_format: str | None) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in (date_format,) if date_format else _DEFAULT_DATE_FORMATS:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def _to_boolean(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, int) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in _TRUE:
            return True
        if s in _FALSE:
            return False
    return None


def convert_value(
    v: Any,
    to: ColumnType,
    *,
    scale: int | None = None,
    date_format: str | None = None,
    rounding: Rounding = "half_up",
) -> tuple[Any, bool]:
    """値 v を型 to に変換する。戻り値：(変換後の値, 成功したか)。欠損は (None, True)。"""
    if is_missing(v):
        return None, True
    if to == "string":
        return to_string(v), True
    if to == "integer":
        r = _to_integer(v)
        return r, r is not None
    if to == "decimal":
        d = _to_decimal(v)
        if d is None:
            return None, False
        return (quantize(d, scale, rounding) if scale is not None else d), True
    if to == "date":
        d2 = _to_date(v, date_format)
        return d2, d2 is not None
    if to == "boolean":
        b = _to_boolean(v)
        return b, b is not None
    raise ValueError(f"unknown type: {to}")
