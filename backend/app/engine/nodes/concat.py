"""データ連結ノード（仕様6.9）：複数の表を縦につなぐ。

- 入力ごとに列名を対応付けられる（例：大阪支店の「売上金額」→「金額」）
- 列の並び：最初の入力の列順 → 後の入力にだけある列を登場順に追加
- 同じ列名で型が違う場合は止める（黙って文字列などに変換しない）
  例外：整数と小数は、小数にそろえる（値は変わらないため。その旨を記録）
- 一部の入力にない列：既定は止める。「許可」なら空欄で連結し、件数を警告する
- source_column を指定すると、どの入力から来た行かを記録する列を先頭に追加する
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.engine.nodes.common import TYPE_LABEL, fail, info, require_columns, warning, with_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import ColumnSpec, Table
from app.flow.schema import ConcatNode


@register("concat")
def run_concat(node: ConcatNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    p = node.parameters
    labels = [s.label or s.reference for s in p.sources]

    # 1) 入力ごとに列名を対応付ける
    renamed: list[Table] = []
    for src, table, label in zip(p.sources, inputs, labels):
        require_columns(table, [r.source for r in src.renames], f"{node.node_name}（{label}）")
        mapping = {r.source: r.target for r in src.renames}
        names = [mapping.get(c, c) for c in table.columns]
        if len(set(names)) != len(names):
            raise fail(
                "COLUMN_NAME_CONFLICT",
                f"「{node.node_name}」：入力「{label}」の列名の対応付けで、同じ列名が重なります。",
                how_to_fix="対応付けを見直してください。",
            )
        renamed.append(
            with_columns(names, {mapping.get(c, c): table.specs[c] for c in table.columns}, {mapping.get(c, c): table.data[c] for c in table.columns})
        )

    # 2) 列の並びと型をそろえる
    columns: list[str] = []
    types: dict[str, set[str]] = {}
    for t in renamed:
        for c in t.columns:
            if c not in types:
                columns.append(c)
                types[c] = set()
            types[c].add(t.type_of(c))

    issues = []
    specs: dict[str, ColumnSpec] = {}
    for c in columns:
        ts = types[c]
        if len(ts) == 1:
            t = next(iter(ts))
            scales = {r.specs[c].scale for r in renamed if c in r.specs}
            specs[c] = ColumnSpec(t, scales.pop() if len(scales) == 1 else None)
        elif ts == {"integer", "decimal"}:
            specs[c] = ColumnSpec("decimal")
            issues.append(info("TYPES_UNIFIED", f"列「{c}」は整数と小数が混在するため、小数にそろえました（値は変わりません）。"))
        else:
            detail = "、".join(f"{lab}：{TYPE_LABEL[r.type_of(c)]}" for lab, r in zip(labels, renamed) if c in r.specs)
            raise fail(
                "TYPE_MISMATCH",
                f"「{node.node_name}」：列「{c}」のデータの形式が、表によって異なります（{detail}）。",
                how_to_fix="まとめる前に「データの形式をそろえる」処理で、形式をそろえてください。",
            )

    # 3) 一部の入力にない列
    lacking = {lab: [c for c in columns if c not in r.specs] for lab, r in zip(labels, renamed)}
    lacking = {lab: cols for lab, cols in lacking.items() if cols}
    if lacking:
        text = " ／ ".join(f"{lab}：{'、'.join(cols)}" for lab, cols in lacking.items())
        if p.missing_columns == "error":
            raise fail(
                "MISSING_COLUMNS_IN_SOURCE",
                f"「{node.node_name}」：一部の入力に列がありません。",
                cause=text,
                how_to_fix="列名の対応付けで名前をそろえるか、「足りない列は空欄で連結する」を選んでください。",
                lacking=lacking,
            )
        issues.append(
            warning(
                "MISSING_COLUMNS_FILLED_BLANK",
                "一部の入力にない列は、空欄のまま連結しました。",
                cause=text,
                how_to_fix="空欄の値は集計に含まれません。意図どおりか確認してください。",
                lacking=lacking,
            )
        )

    # 4) 連結
    data: dict[str, list[Any]] = {c: [] for c in columns}
    for r in renamed:
        for c in columns:
            if c in r.specs:
                vals = r.data[c]
                if specs[c].type == "decimal" and r.type_of(c) == "integer":
                    vals = [None if v is None else Decimal(v) for v in vals]
                data[c].extend(vals)
            else:
                data[c].extend([None] * r.row_count)

    if p.source_column:
        if p.source_column in specs:
            raise fail(
                "COLUMN_ALREADY_EXISTS",
                f"「{node.node_name}」：入力元を記録する列「{p.source_column}」は、すでにある列名です。",
                how_to_fix="別の列名を指定してください。",
            )
        columns = [p.source_column, *columns]
        specs[p.source_column] = ColumnSpec("string")
        data[p.source_column] = [lab for lab, r in zip(labels, renamed) for _ in range(r.row_count)]

    counts = "、".join(f"{lab} {r.row_count:,}行" for lab, r in zip(labels, renamed))
    total = sum(r.row_count for r in renamed)
    issues.insert(0, info("CONCATENATED", f"{len(renamed)}つの表を連結しました（{counts} → 合計{total:,}行）。", rows={lab: r.row_count for lab, r in zip(labels, renamed)}))
    return NodeOutput(table=with_columns(columns, specs, data), issues=issues)
