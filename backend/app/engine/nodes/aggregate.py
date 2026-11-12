"""グループ別集計ノード（仕様6.10・7.5）。

集計方法：合計(sum)・平均(mean)・最大(max)・最小(min)・件数(count)・ユニーク件数(nunique)

空欄の扱い（設計書 §8）：
- 集計キーが空欄の行は捨てず、「空欄」という1つのグループにまとめる（件数を報告）
- 合計・平均・最大・最小・ユニーク件数は、空欄の値を除いて計算する（除いた件数を報告）
- 値がすべて空欄のグループの合計・平均は 0 ではなく空欄にする（データなしと0円は別物）
- 件数：列を指定しない場合は行数、指定した場合は空欄でない値の数

検証：
- 合計：「グループ別合計の総和」＝「集計前の全体合計」を必ず照合する
- 件数（行数）：「グループ別件数の総和」＝「集計前の行数」を照合する
出力の並び：集計キーの昇順（空欄のグループは最後）。毎回同じ順序になる。
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.engine.numeric import CONTEXT, ROUNDING_LABEL, quantize
from app.engine.nodes.common import TYPE_LABEL, fail, info, require_columns, warning, with_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.result import EngineIssue
from app.engine.table import ColumnSpec, Table
from app.flow.schema import AggregateNode, Aggregation

FUNC_LABEL = {"sum": "合計", "mean": "平均", "max": "最大", "min": "最小", "count": "件数", "nunique": "ユニーク件数"}
_ALLOWED_TYPES = {
    "sum": {"integer", "decimal"},
    "mean": {"integer", "decimal"},
    "max": {"integer", "decimal", "date"},
    "min": {"integer", "decimal", "date"},
    "count": {"string", "integer", "decimal", "date", "boolean"},
    "nunique": {"string", "integer", "decimal", "date", "boolean"},
}

Key = tuple[Any, ...]


def _sort_key(k: Key) -> tuple[Any, ...]:
    # 空欄は最後。それ以外は値の昇順（同じ列の値は同じ型なので比較できる）
    return tuple((1, 0) if v is None else (0, v) for v in k)


def _output_spec(agg: Aggregation, table: Table) -> ColumnSpec:
    """集計結果の列の型。

    件数・ユニーク件数 → 整数 ／ 平均 → 小数
    合計・最大・最小 → 元の列と同じ型（整数の列に小数桁を指定した場合だけ小数）
    """
    if agg.function in ("count", "nunique"):
        return ColumnSpec("integer")
    src = table.specs[agg.column]  # type: ignore[index]
    if agg.function == "mean":
        return ColumnSpec("decimal", agg.scale)
    if src.type == "integer" and agg.scale is None:
        return ColumnSpec("integer")
    if src.type in ("integer", "decimal"):
        return ColumnSpec("decimal", agg.scale if agg.scale is not None else src.scale)
    return src  # 日付の最大・最小


def _compute(agg: Aggregation, values: list[Any], rows: int, spec: ColumnSpec) -> Any:
    if agg.function == "count":
        return rows if agg.column is None else sum(1 for v in values if v is not None)
    present = [v for v in values if v is not None]
    if agg.function == "nunique":
        return len(set(present))
    if not present:
        return None  # 値がすべて空欄 → 0 ではなく空欄
    if agg.function in ("max", "min"):
        result: Any = max(present) if agg.function == "max" else min(present)
    else:
        total = sum((Decimal(v) for v in present), Decimal(0))
        result = total if agg.function == "sum" else CONTEXT.divide(total, Decimal(len(present)))
    if spec.type == "integer":
        return int(result)
    if spec.type == "decimal":
        result = Decimal(result)
        return quantize(result, agg.scale, agg.rounding) if agg.scale is not None else result
    return result


@register("aggregate")
def run_aggregate(node: AggregateNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    name = node.node_name
    used = list(p.group_by) + [a.column for a in p.aggregations if a.column is not None]
    require_columns(table, used, name)

    out_names = list(p.group_by) + [a.output_column for a in p.aggregations]
    dup = sorted({c for c in out_names if out_names.count(c) > 1})
    if dup:
        raise fail(
            "DUPLICATE_COLUMN",
            f"「{name}」：結果の列名が重複しています：{'、'.join(dup)}",
            how_to_fix="集計結果の列名（出力列名）を、集計キーやほかの集計と重ならない名前にしてください。",
        )
    for a in p.aggregations:
        if a.column is not None:
            t = table.type_of(a.column)
            if t not in _ALLOWED_TYPES[a.function]:
                raise fail(
                    "AGGREGATION_TYPE_INVALID",
                    f"「{name}」：{TYPE_LABEL[t]}の列「{a.column}」は「{FUNC_LABEL[a.function]}」で集計できません。",
                    how_to_fix="数値の列を指定するか、先に「データの形式をそろえる」処理で数値にしてください。",
                )

    # グループ分け（キーの空欄も1つのグループとして残す）
    groups: dict[Key, list[int]] = {}
    for i in range(table.row_count):
        k = tuple(table.data[c][i] for c in p.group_by)
        groups.setdefault(k, []).append(i)
    ordered = sorted(groups, key=_sort_key)

    specs = {c: table.specs[c] for c in p.group_by}
    data: dict[str, list[Any]] = {c: [] for c in p.group_by}
    for a in p.aggregations:
        specs[a.output_column] = _output_spec(a, table)
        data[a.output_column] = []

    for k in ordered:
        rows = groups[k]
        for c, v in zip(p.group_by, k):
            data[c].append(v)
        for a in p.aggregations:
            values = [table.data[a.column][i] for i in rows] if a.column else []
            data[a.output_column].append(_compute(a, values, len(rows), specs[a.output_column]))

    # 集計キーがない場合（全体で1行）でも、0行の入力なら1行の結果（件数0）を返す
    if not p.group_by and not ordered:
        for a in p.aggregations:
            data[a.output_column].append(_compute(a, [], 0, specs[a.output_column]))

    result = with_columns(out_names, specs, data)
    issues = _verify_and_report(node, table, result, groups)
    return NodeOutput(table=result, issues=issues)


def _verify_and_report(node: AggregateNode, table: Table, result: Table, groups: dict[Key, list[int]]) -> list[EngineIssue]:
    p = node.parameters
    issues: list[EngineIssue] = []
    keys_text = "・".join(p.group_by) if p.group_by else "全体"
    issues.append(info("AGGREGATED", f"{table.row_count:,}行を「{keys_text}」で集計し、{result.row_count:,}行にまとめました。", groups=len(groups)))

    blank_groups = [k for k in groups if any(v is None for v in k)]
    if blank_groups:
        n = sum(len(groups[k]) for k in blank_groups)
        issues.append(
            warning(
                "BLANK_GROUP_KEYS",
                f"集計キー（{keys_text}）が空欄の{n:,}行を、「空欄」のグループとして集計しました（削除していません）。",
                how_to_fix="空欄のグループが不要な場合は、集計の前に「行の抽出」や「欠損値処理」で扱いを決めてください。",
                rows=n,
            )
        )

    for a in p.aggregations:
        label = f"{FUNC_LABEL[a.function]}（{a.column or '行数'}）→「{a.output_column}」"
        if a.column and a.function not in ("count",):
            nulls = sum(1 for v in table.data[a.column] if v is None)
            if nulls:
                issues.append(info("NULLS_EXCLUDED", f"{label}：空欄の{nulls:,}件は計算から除外しました（0とはみなしません）。", column=a.column, count=nulls))
        if a.function == "mean" and a.scale is None:
            issues.append(info("MEAN_NOT_ROUNDED", f"{label}：小数桁が指定されていないため、丸めずに出力しています。小数桁の指定をおすすめします。"))
        if a.scale is not None and a.function in ("sum", "mean", "max", "min"):
            issues.append(info("ROUNDED", f"{label}：小数{a.scale}桁・{ROUNDING_LABEL[a.rounding]}で丸めました。"))

        # 検証：合計（丸めていない場合は完全一致。丸めた場合は丸め誤差の範囲で一致）
        if a.function == "sum":
            before = sum((Decimal(v) for v in table.data[a.column] if v is not None), Decimal(0))  # type: ignore[index]
            after = sum((Decimal(v) for v in result.data[a.output_column] if v is not None), Decimal(0))
            tolerance = Decimal(0) if a.scale is None else Decimal(1).scaleb(-a.scale) / 2 * len(groups)
            detail = {"column": a.column, "before": str(before), "after": str(after), "difference": str(after - before)}
            if abs(after - before) > tolerance:
                raise fail(
                    "AGGREGATE_TOTAL_MISMATCH",
                    f"「{node.node_name}」：集計前の合計（{before:,}）と、グループ別合計の総和（{after:,}）が一致しません。",
                    how_to_fix="結果を使わず、開発者に連絡してください。",
                    **detail,
                )
            issues.append(info("TOTAL_VERIFIED", f"{label}：集計前の合計とグループ別合計の総和が一致しています（{after:,}）。", **detail))
        if a.function == "count" and a.column is None:
            total = sum(v for v in result.data[a.output_column] if v is not None)
            if total != table.row_count:
                raise fail(
                    "AGGREGATE_COUNT_MISMATCH",
                    f"「{node.node_name}」：グループ別件数の総和（{total:,}）が集計前の行数（{table.row_count:,}）と一致しません。",
                    how_to_fix="結果を使わず、開発者に連絡してください。",
                )
            issues.append(info("COUNT_VERIFIED", f"{label}：グループ別件数の総和が集計前の行数と一致しています（{total:,}件）。"))
    return issues
