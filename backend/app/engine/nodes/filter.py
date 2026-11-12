"""行の抽出ノード（仕様6.2）。

- 比較する値は、列の型に変換してから比べる（「金額 > 1000」を文字の大小で比べない）
- 空欄の値は「空欄」「空欄ではない」以外の条件には一致しない
  （例：「部署 ≠ 営業1部」でも、部署が空欄の行は残らない）。その件数は必ず報告する
- 列の型に合わない演算子（例：日付列に「含む」）はエラー
"""

from __future__ import annotations

from typing import Any

from app.engine.convert import convert_value
from app.engine.nodes.common import TYPE_LABEL, fail, info, pick_rows, require_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import Table
from app.flow.schema import Condition, ConditionGroup, FilterNode

OPERATOR_LABEL = {
    "eq": "等しい",
    "ne": "等しくない",
    "gt": "より大きい",
    "ge": "以上",
    "lt": "より小さい",
    "le": "以下",
    "contains": "含む",
    "not_contains": "含まない",
    "is_empty": "空欄",
    "is_not_empty": "空欄ではない",
}

# 列の型ごとに使える演算子
_ALLOWED = {
    "string": {"eq", "ne", "contains", "not_contains", "is_empty", "is_not_empty"},
    "boolean": {"eq", "ne", "is_empty", "is_not_empty"},
    "integer": {"eq", "ne", "gt", "ge", "lt", "le", "is_empty", "is_not_empty"},
    "decimal": {"eq", "ne", "gt", "ge", "lt", "le", "is_empty", "is_not_empty"},
    "date": {"eq", "ne", "gt", "ge", "lt", "le", "is_empty", "is_not_empty"},
}


def _conditions(node: Condition | ConditionGroup) -> list[Condition]:
    if isinstance(node, Condition):
        return [node]
    return [c for child in node.conditions for c in _conditions(child)]


def _prepare(cond: Condition, table: Table, node_name: str) -> Any:
    """条件の値を列の型に変換しておく（行ごとに変換しない）。"""
    col_type = table.type_of(cond.column)
    if cond.operator not in _ALLOWED[col_type]:
        raise fail(
            "OPERATOR_NOT_ALLOWED",
            f"「{node_name}」：{TYPE_LABEL[col_type]}の列「{cond.column}」には「{OPERATOR_LABEL[cond.operator]}」の条件を使えません。",
            how_to_fix=f"使える条件：{'、'.join(OPERATOR_LABEL[o] for o in sorted(_ALLOWED[col_type]))}",
        )
    if cond.operator in ("is_empty", "is_not_empty"):
        return None
    if cond.operator in ("contains", "not_contains"):
        return cond.value
    value, ok = convert_value(cond.value, col_type)
    if not ok or value is None:
        raise fail(
            "FILTER_VALUE_INVALID",
            f"「{node_name}」：条件の値「{cond.value}」を、列「{cond.column}」のデータの形式（{TYPE_LABEL[col_type]}）として解釈できません。",
            how_to_fix="条件の値を、列のデータの形式に合う形で入力してください（例：日付は 2026/10/01）。",
        )
    return value


def _match(cond: Condition, v: Any, target: Any) -> bool:
    op = cond.operator
    if op == "is_empty":
        return v is None
    if op == "is_not_empty":
        return v is not None
    if v is None:
        return False  # 空欄は比較条件に一致しない
    if op == "eq":
        return v == target
    if op == "ne":
        return v != target
    if op == "gt":
        return v > target
    if op == "ge":
        return v >= target
    if op == "lt":
        return v < target
    if op == "le":
        return v <= target
    if op == "contains":
        return target in v
    if op == "not_contains":
        return target not in v
    raise ValueError(op)


def _eval(node: Condition | ConditionGroup, row: int, table: Table, prepared: dict[int, Any]) -> bool:
    if isinstance(node, Condition):
        return _match(node, table.data[node.column][row], prepared[id(node)])
    results = (_eval(c, row, table, prepared) for c in node.conditions)
    return all(results) if node.logic == "and" else any(results)


@register("filter")
def run_filter(node: FilterNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    conds = _conditions(node.parameters.condition)
    require_columns(table, [c.column for c in conds], node.node_name)
    prepared = {id(c): _prepare(c, table, node.node_name) for c in conds}

    keep: list[int] = []
    for i in range(table.row_count):
        if _eval(node.parameters.condition, i, table, prepared):
            keep.append(i)

    issues = [info("FILTERED", f"{table.row_count:,}行のうち{len(keep):,}行を抽出しました（{table.row_count - len(keep):,}行を除外）。")]
    # 比較条件の列が空欄だったために除外された行を報告する（「≠」で空欄が消えることに気づけるように）
    kept = set(keep)
    for c in conds:
        if c.operator in ("is_empty", "is_not_empty"):
            continue
        blank_dropped = sum(1 for i in range(table.row_count) if i not in kept and table.data[c.column][i] is None)
        if blank_dropped:
            issues.append(
                info(
                    "BLANK_ROWS_EXCLUDED",
                    f"列「{c.column}」が空欄の{blank_dropped:,}行は、条件「{OPERATOR_LABEL[c.operator]}」に一致しないため除外されました。",
                    column=c.column,
                    count=blank_dropped,
                )
            )
    return NodeOutput(table=pick_rows(table, keep), issues=issues)
