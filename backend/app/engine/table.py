"""エンジン内部で扱う「表」。

値は列ごとの Python のリストで持ち、列の型（ColumnType）も一緒に管理する。
pandas は使わない：自動の型推論で 00123 が 123 に、金額が float になるなどの
「黙った変換」を確実に避けるため。集計・結合でも挙動を1行ずつ説明できる。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from app.flow.schema import ColumnType


@dataclass(frozen=True)
class ColumnSpec:
    type: ColumnType
    scale: int | None = None  # decimal の小数桁（不明なら None）


@dataclass
class Table:
    """列名の順序・型・値を持つ表。ノードはこれを書き換えず、新しい Table を返す。"""

    columns: list[str]
    specs: dict[str, ColumnSpec]
    data: dict[str, list[Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if set(self.columns) != set(self.specs) or set(self.columns) != set(self.data):
            raise ValueError("columns / specs / data の列が一致しません")
        lengths = {len(v) for v in self.data.values()}
        if len(lengths) > 1:
            raise ValueError("列ごとの行数が一致しません")

    @property
    def row_count(self) -> int:
        return len(self.data[self.columns[0]]) if self.columns else 0

    def type_of(self, column: str) -> ColumnType:
        return self.specs[column].type

    def numeric_columns(self) -> set[str]:
        return {c for c in self.columns if self.specs[c].type in ("integer", "decimal")}

    def rows(self, start: int = 0, stop: int | None = None) -> list[list[Any]]:
        stop = self.row_count if stop is None else min(stop, self.row_count)
        return [[self.data[c][i] for c in self.columns] for i in range(start, stop)]

    def fingerprint(self) -> str:
        """表の内容の指紋（SHA-256）。同じ入力・同じフローなら必ず同じ値になる（再現性の確認用）。"""
        h = hashlib.sha256()
        h.update(json.dumps([[c, self.specs[c].type, self.specs[c].scale] for c in self.columns], ensure_ascii=False).encode())
        for i in range(self.row_count):
            h.update(b"\n")
            h.update("\x1f".join(_canonical(self.data[c][i]) for c in self.columns).encode())
        return h.hexdigest()


def _canonical(v: Any) -> str:
    if v is None:
        return "\x00"
    if isinstance(v, bool):
        return "b:" + ("1" if v else "0")
    if isinstance(v, int):
        return "i:" + str(v)
    if isinstance(v, Decimal):
        return "d:" + str(v)
    if isinstance(v, date):
        return "t:" + v.isoformat()
    return "s:" + json.dumps(str(v), ensure_ascii=False)
