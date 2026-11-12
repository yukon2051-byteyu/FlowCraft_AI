"""重複処理（仕様6.6）・欠損値処理（仕様6.7）ノード。

「検出」モードはデータを一切変えず、件数と具体例を検証結果として報告する。
「除去」「補完」「行の除外」は利用者が明示的に選んだときだけ行い、変えた件数を必ず記録する。
行番号は、このステップに入ってきたデータの何行目か（1始まり）。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from app.engine.convert import convert_value, to_string
from app.engine.nodes.common import MAX_EXAMPLES, TYPE_LABEL, fail, info, pick_rows, require_columns, warning
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import Table
from app.flow.schema import DuplicatesNode, MissingNode


def _key_text(key: tuple[Any, ...]) -> str:
    return " / ".join(to_string(v) or "（空欄）" for v in key)


@register("duplicates")
def run_duplicates(node: DuplicatesNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    require_columns(table, p.key_columns, node.node_name)
    keys = [tuple(table.data[c][i] for c in p.key_columns) for i in range(table.row_count)]
    counts = Counter(keys)
    dup_keys = {k: n for k, n in counts.items() if n > 1}
    dup_rows = sum(dup_keys.values())
    blank_key_rows = sum(1 for k in keys if any(v is None for v in k))
    key_label = "・".join(p.key_columns)

    # 重複が多い順（同数なら最初に現れた順）に例を示す。行番号は1回のループで集める（大量データでも遅くならないように）
    rows_of: dict[tuple[Any, ...], list[int]] = {}
    for i, k in enumerate(keys):
        if k in dup_keys:
            rows_of.setdefault(k, []).append(i + 1)
    ranked = sorted(dup_keys.items(), key=lambda kn: (-kn[1], rows_of[kn[0]][0]))[:MAX_EXAMPLES]
    examples = [{"key": _key_text(k), "count": n, "rows": rows_of[k][:MAX_EXAMPLES]} for k, n in ranked]
    details = {"duplicate_keys": len(dup_keys), "duplicate_rows": dup_rows, "examples": examples, "blank_key_rows": blank_key_rows}
    issues = []
    if blank_key_rows:
        issues.append(info("BLANK_KEYS", f"キー（{key_label}）に空欄を含む行が{blank_key_rows:,}行あります。空欄どうしは同じ値として扱います。"))

    if p.mode == "detect":
        if dup_keys:
            ex = "、".join(f"「{e['key']}」{e['count']}件" for e in examples)
            issues.insert(
                0,
                warning(
                    "DUPLICATES_FOUND",
                    f"キー（{key_label}）が重複している行が{dup_rows:,}行（{len(dup_keys):,}種類）あります。",
                    cause=f"例：{ex}",
                    how_to_fix="意図しない重複の場合は、元データを確認するか「重複を除去」を選んでください。",
                    **details,
                ),
            )
        else:
            issues.insert(0, info("NO_DUPLICATES", f"キー（{key_label}）の重複はありません。", **details))
        return NodeOutput(table=table, issues=issues)

    # 除去：キーごとに最初（または最後）の1行を残す。残す行の並び順は元の順序のまま
    keep_index: dict[tuple[Any, ...], int] = {}
    for i, k in enumerate(keys):
        if p.keep == "first":
            keep_index.setdefault(k, i)
        else:
            keep_index[k] = i
    kept = sorted(keep_index.values())
    kept_set = set(kept)
    removed = table.row_count - len(kept)
    removed_rows = [i + 1 for i in range(table.row_count) if i not in kept_set][: MAX_EXAMPLES * 4]
    issues.insert(
        0,
        info(
            "DUPLICATES_REMOVED",
            f"キー（{key_label}）の重複{removed:,}行を除去しました（各キーの{'最初' if p.keep == 'first' else '最後'}の行を残しています）。",
            removed=removed,
            removed_rows=removed_rows,
            **details,
        ),
    )
    return NodeOutput(table=pick_rows(table, kept), issues=issues)


@register("missing")
def run_missing(node: MissingNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    require_columns(table, p.columns, node.node_name)
    per_column = {
        c: [i + 1 for i, v in enumerate(table.data[c]) if v is None] for c in p.columns
    }
    summary = {c: {"count": len(rows), "rows": rows[: MAX_EXAMPLES * 4]} for c, rows in per_column.items()}
    total = sum(len(r) for r in per_column.values())
    text = "、".join(f"「{c}」{len(r):,}件" for c, r in per_column.items())

    if p.mode == "detect":
        if total:
            return NodeOutput(
                table=table,
                issues=[
                    warning(
                        "MISSING_FOUND",
                        f"空欄があります：{text}",
                        how_to_fix="必要に応じて「指定した値で補完」または「空欄の行を除外」を選んでください（自動では変更しません）。",
                        columns=summary,
                    )
                ],
            )
        return NodeOutput(table=table, issues=[info("NO_MISSING", "指定した列に空欄はありません。", columns=summary)])

    if p.mode == "fill":
        data = dict(table.data)
        for c in p.columns:
            col_type = table.type_of(c)
            value, ok = convert_value(p.fill_value, col_type)
            if not ok or value is None:
                raise fail(
                    "FILL_VALUE_INVALID",
                    f"「{node.node_name}」：補完する値「{p.fill_value}」を、列「{c}」のデータの形式（{TYPE_LABEL[col_type]}）として解釈できません。",
                    how_to_fix="列のデータの形式に合う値を指定してください。",
                )
            data[c] = [value if v is None else v for v in table.data[c]]
        out = Table(columns=list(table.columns), specs=dict(table.specs), data=data)
        return NodeOutput(
            table=out,
            issues=[info("MISSING_FILLED", f"空欄を「{p.fill_value}」で補完しました：{text}", fill_value=p.fill_value, columns=summary)],
        )

    # drop_rows：指定した列のどれかが空欄の行を除外する
    blank = set().union(*(set(r) for r in per_column.values()))
    kept = [i for i in range(table.row_count) if i + 1 not in blank]
    return NodeOutput(
        table=pick_rows(table, kept),
        issues=[
            info(
                "MISSING_ROWS_DROPPED",
                f"空欄を含む{len(blank):,}行を除外しました（{table.row_count:,}行 → {len(kept):,}行）。内訳：{text}",
                removed=len(blank),
                columns=summary,
            )
        ],
    )
