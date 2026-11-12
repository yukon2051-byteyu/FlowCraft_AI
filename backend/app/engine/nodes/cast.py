"""型変換ノード（仕様6.5）。

変換できない値の扱いは設定で選ぶ：
- error（既定）：処理を止め、列ごとの件数と例を示す
- warn        ：その値を空欄にして続行し、件数と例を警告として必ず報告する
どちらの場合も「黙って空欄にする」ことはない。
行番号は、このステップに入ってきたデータの何行目か（1始まり）で示す。
"""

from __future__ import annotations

from typing import Any

from app.engine.convert import convert_value, to_string
from app.engine.nodes.common import MAX_EXAMPLES, TYPE_LABEL, fail, info, require_columns, warning, with_columns
from app.engine.numeric import ROUNDING_LABEL
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import ColumnSpec, Table
from app.flow.schema import CastNode


@register("cast")
def run_cast(node: CastNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    require_columns(table, [c.column for c in p.casts], node.node_name)
    cols = [c.column for c in p.casts]
    dup = sorted({c for c in cols if cols.count(c) > 1})
    if dup:
        raise fail("DUPLICATE_COLUMN", f"「{node.node_name}」：同じ列が複数回指定されています：{'、'.join(dup)}", how_to_fix="重複を取り除いてください。")

    specs = dict(table.specs)
    data = dict(table.data)
    failures: dict[str, dict[str, Any]] = {}
    done: list[str] = []

    for spec in p.casts:
        converted: list[Any] = []
        bad = 0
        examples: list[dict[str, Any]] = []
        for i, v in enumerate(table.data[spec.column]):
            out, ok = convert_value(v, spec.to, scale=spec.scale, date_format=spec.date_format, rounding=spec.rounding)
            if not ok:
                bad += 1
                if len(examples) < MAX_EXAMPLES:
                    examples.append({"row": i + 1, "value": to_string(v)})
            converted.append(out)
        if bad:
            failures[spec.column] = {"to": spec.to, "count": bad, "examples": examples}
        data[spec.column] = converted
        specs[spec.column] = ColumnSpec(spec.to, spec.scale)
        label = TYPE_LABEL[spec.to]
        if spec.to == "decimal" and spec.scale is not None:
            label += f"（小数{spec.scale}桁・{ROUNDING_LABEL[spec.rounding]}）"
        done.append(f"「{spec.column}」→{label}")

    issues = [info("CAST_DONE", f"型を変換しました：{'、'.join(done)}")]
    if failures:
        parts = []
        for col, f in failures.items():
            ex = "、".join(f"{e['row']}行目「{e['value']}」" for e in f["examples"])
            parts.append(f"「{col}」（{TYPE_LABEL[f['to']]}）{f['count']:,}件：{ex}")
        cause = " ／ ".join(parts)
        if p.on_failure == "error":
            raise fail(
                "TYPE_CONVERSION_FAILED",
                f"「{node.node_name}」：変換できない値があります。",
                cause=cause,
                how_to_fix="元データを修正するか、「変換できない値は空欄にして続ける」設定を選んでください。",
                failures=failures,
            )
        issues.append(
            warning(
                "TYPE_CONVERSION_BLANKED",
                f"変換できない値{sum(f['count'] for f in failures.values()):,}件を空欄にしました。",
                cause=cause,
                how_to_fix="空欄になった値が集計に含まれない点にご注意ください。",
                failures=failures,
            )
        )
    return NodeOutput(table=with_columns(list(table.columns), specs, data), issues=issues)
