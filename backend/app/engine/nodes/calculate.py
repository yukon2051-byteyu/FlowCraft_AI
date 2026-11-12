"""計算ノード（仕様6.4 計算列・6.11 計算）：計算式で新しい列を作る。

- 計算は Decimal。丸めは最後に1回（小数桁と丸め方式はノードごとに指定）
- 既存の列は上書きしない
- 空欄を含む行は結果も空欄（0とみなさない）。件数を記録する
- 0で割った行：既定は結果を空欄にして警告（行番号を示す）。「エラー」設定なら停止
"""

from __future__ import annotations

from app.engine.expression import ExpressionError, evaluate
from app.engine.nodes.common import MAX_EXAMPLES, fail, info, warning, with_columns
from app.engine.numeric import ROUNDING_LABEL, quantize
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import ColumnSpec, Table
from app.flow.schema import CalculateNode


@register("calculate")
def run_calculate(node: CalculateNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    p = node.parameters
    if p.output_column in table.specs:
        raise fail(
            "COLUMN_ALREADY_EXISTS",
            f"「{node.node_name}」：列「{p.output_column}」はすでにあります。",
            how_to_fix="計算結果には新しい列名を指定してください（既存の列は上書きしません）。",
        )
    try:
        result = evaluate(p.expression, table.data, table.numeric_columns())
    except ExpressionError as e:
        raise fail("EXPRESSION_INVALID", f"「{node.node_name}」：{e}", how_to_fix="計算式の列と演算を見直してください。") from None

    values = result.values
    if p.scale is not None:
        values = [None if v is None else quantize(v, p.scale, p.rounding) for v in values]

    issues = []
    rounding_text = f"（小数{p.scale}桁・{ROUNDING_LABEL[p.rounding]}）" if p.scale is not None else ""
    issues.append(info("CALCULATED", f"列「{p.output_column}」を計算しました{rounding_text}。"))
    if result.null_rows:
        issues.append(info("NULL_IN_CALCULATION", f"計算に使う値が空欄の{result.null_rows:,}行は、結果も空欄にしました（0とはみなしません）。", count=result.null_rows))
    if result.zero_division_rows:
        rows = [i + 1 for i in result.zero_division_rows]
        shown = "、".join(f"{r}行目" for r in rows[:MAX_EXAMPLES])
        if p.on_zero_division == "error":
            raise fail(
                "ZERO_DIVISION",
                f"「{node.node_name}」：0で割る計算が{len(rows):,}行あります。",
                cause=f"例：{shown}",
                how_to_fix="割る数が0の行を除外するか、「0で割る行は空欄にして続ける」を選んでください。",
                rows=rows[: MAX_EXAMPLES * 4],
            )
        issues.append(
            warning(
                "ZERO_DIVISION_BLANKED",
                f"0で割る計算が{len(rows):,}行あったため、その行の結果を空欄にしました。",
                cause=f"例：{shown}",
                rows=rows[: MAX_EXAMPLES * 4],
            )
        )

    columns = [*table.columns, p.output_column]
    specs = {**table.specs, p.output_column: ColumnSpec("decimal", p.scale)}
    data = {**table.data, p.output_column: values}
    return NodeOutput(table=with_columns(columns, specs, data), issues=issues)
