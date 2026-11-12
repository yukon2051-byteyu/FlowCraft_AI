"""Excel出力ノード（仕様6.12）。

ここでは「どの表をどのシート名で出力するか」を確定するだけ。
実際のExcelファイルの作成は export モジュール（タスク4-2）で、実行結果が
エラーでない場合に限って行う（不正な結果を成果物として出力しない）。
"""

from __future__ import annotations

from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.result import OutputSheet
from app.engine.table import Table
from app.flow.schema import OutputNode


@register("output")
def run_output(node: OutputNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    sheets = [OutputSheet(sheet_name=s.sheet_name, reference=s.reference) for s in node.parameters.sheets]
    return NodeOutput(table=None, sheets=sheets)
