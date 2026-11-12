"""ノードで共通に使う部品。"""

from __future__ import annotations

import difflib
from collections.abc import Iterable
from typing import Any

from app.engine.result import EngineIssue, NodeFailure
from app.engine.table import ColumnSpec, Table

TYPE_LABEL = {"string": "文字", "integer": "整数", "decimal": "小数", "date": "日付", "boolean": "はい／いいえ"}
MAX_EXAMPLES = 5


def fail(code: str, message: str, how_to_fix: str, cause: str | None = None, **details: Any) -> NodeFailure:
    return NodeFailure(EngineIssue(code, "error", message, cause=cause, how_to_fix=how_to_fix, details=dict(details)))


def info(code: str, message: str, **details: Any) -> EngineIssue:
    return EngineIssue(code, "info", message, details=dict(details))


def warning(code: str, message: str, cause: str | None = None, how_to_fix: str | None = None, **details: Any) -> EngineIssue:
    return EngineIssue(code, "warning", message, cause=cause, how_to_fix=how_to_fix, details=dict(details))


def require_columns(table: Table, columns: Iterable[str], node_name: str) -> None:
    """指定された列が表にあるか確認する。なければ似た列名を候補として示して止める。"""
    missing = [c for c in columns if c not in table.specs]
    if not missing:
        return
    hints = {m: difflib.get_close_matches(m, table.columns, n=2, cutoff=0.4) for m in missing}
    hint_text = "、".join(f"「{m}」→ 候補：{'・'.join(h)}" for m, h in hints.items() if h)
    raise fail(
        "COLUMN_NOT_FOUND",
        f"「{node_name}」で指定された列がありません：{'、'.join(missing)}",
        cause=hint_text or f"この時点の列：{'、'.join(table.columns[:20])}",
        how_to_fix="列名を確認し、設定を修正してください。前のステップで列名が変わっていないかも確認してください。",
        missing=missing,
        candidates=hints,
    )


def pick_rows(table: Table, indices: list[int]) -> Table:
    """指定した行だけを、指定した順に並べた新しい表を作る（元の表は変えない）。"""
    return Table(
        columns=list(table.columns),
        specs=dict(table.specs),
        data={c: [table.data[c][i] for i in indices] for c in table.columns},
    )


def with_columns(columns: list[str], specs: dict[str, ColumnSpec], data: dict[str, list[Any]]) -> Table:
    return Table(columns=columns, specs={c: specs[c] for c in columns}, data={c: data[c] for c in columns})
