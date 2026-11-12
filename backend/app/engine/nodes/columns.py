"""列編集ノード（仕様6.4）：列の抽出・列名の変更・列の削除・固定値列の追加。"""

from __future__ import annotations

from app.engine.convert import convert_value
from app.engine.nodes.common import TYPE_LABEL, fail, info, require_columns, with_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import ColumnSpec, Table
from app.flow.schema import AddConstantNode, DropColumnsNode, RenameColumnsNode, SelectColumnsNode


def _duplicates(items: list[str]) -> list[str]:
    return sorted({x for x in items if items.count(x) > 1})


@register("select_columns")
def run_select_columns(node: SelectColumnsNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    cols = node.parameters.columns
    dup = _duplicates(cols)
    if dup:
        raise fail("DUPLICATE_COLUMN", f"「{node.node_name}」：同じ列が複数回指定されています：{'、'.join(dup)}", how_to_fix="重複を取り除いてください。")
    require_columns(table, cols, node.node_name)
    dropped = [c for c in table.columns if c not in cols]
    out = with_columns(list(cols), table.specs, table.data)
    return NodeOutput(table=out, issues=[info("COLUMNS_SELECTED", f"{len(table.columns)}列から{len(cols)}列を残しました。", dropped=dropped)])


@register("rename_columns")
def run_rename_columns(node: RenameColumnsNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    renames = node.parameters.renames
    sources = [r.source for r in renames]
    targets = [r.target for r in renames]
    for dup, what in ((_duplicates(sources), "変更元"), (_duplicates(targets), "変更後")):
        if dup:
            raise fail("DUPLICATE_COLUMN", f"「{node.node_name}」：{what}の列名が重複しています：{'、'.join(dup)}", how_to_fix="重複を取り除いてください。")
    require_columns(table, sources, node.node_name)
    mapping = dict(zip(sources, targets))
    new_names = [mapping.get(c, c) for c in table.columns]
    clash = _duplicates(new_names)
    if clash:
        raise fail(
            "COLUMN_NAME_CONFLICT",
            f"「{node.node_name}」：変更後の列名がほかの列と重なります：{'、'.join(clash)}",
            how_to_fix="別の列名にするか、先に既存の列を削除・変更してください。",
        )
    specs = {mapping.get(c, c): table.specs[c] for c in table.columns}
    data = {mapping.get(c, c): table.data[c] for c in table.columns}
    changed = "、".join(f"「{s}」→「{t}」" for s, t in mapping.items())
    return NodeOutput(table=with_columns(new_names, specs, data), issues=[info("COLUMNS_RENAMED", f"列名を変更しました：{changed}")])


@register("drop_columns")
def run_drop_columns(node: DropColumnsNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    cols = node.parameters.columns
    require_columns(table, cols, node.node_name)
    remaining = [c for c in table.columns if c not in cols]
    if not remaining:
        raise fail("NO_COLUMNS_LEFT", f"「{node.node_name}」：すべての列が削除されてしまいます。", how_to_fix="残す列を1つ以上にしてください。")
    return NodeOutput(
        table=with_columns(remaining, table.specs, table.data),
        issues=[info("COLUMNS_DROPPED", f"{len(cols)}列を削除しました：{'、'.join(cols)}")],
    )


@register("add_constant")
def run_add_constant(node: AddConstantNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    if p.column in table.specs:
        raise fail(
            "COLUMN_ALREADY_EXISTS",
            f"「{node.node_name}」：列「{p.column}」はすでにあります。",
            how_to_fix="別の列名を指定してください（既存の列を上書きはしません）。",
        )
    value, ok = convert_value(p.value, p.value_type)
    if not ok:
        raise fail(
            "CONSTANT_VALUE_INVALID",
            f"「{node.node_name}」：固定値「{p.value}」を{TYPE_LABEL[p.value_type]}として解釈できません。",
            how_to_fix="値か型の指定を見直してください。",
        )
    columns = [*table.columns, p.column]
    specs = {**table.specs, p.column: ColumnSpec(p.value_type)}
    data = {**table.data, p.column: [value] * table.row_count}
    return NodeOutput(table=with_columns(columns, specs, data), issues=[info("COLUMN_ADDED", f"列「{p.column}」を追加しました（全行：{p.value if p.value is not None else '空欄'}）。")])
