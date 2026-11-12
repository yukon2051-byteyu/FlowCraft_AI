"""並べ替えノード（仕様6.3）。

- 複数の列で並べ替える（先に指定した列が優先）
- 同じ値の行は元の順序を保つ（安定ソート）＝何度実行しても同じ順序になる
- 空欄は、昇順・降順のどちらでも最後に置く
- 文字列は文字コード順（五十音順ではない。例：カタカナはひらがなより後）
"""

from __future__ import annotations

from app.engine.nodes.common import info, pick_rows, require_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.table import Table
from app.flow.schema import SortNode


@register("sort")
def run_sort(node: SortNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    table = inputs[0]
    keys = node.parameters.keys
    require_columns(table, [k.column for k in keys], node.node_name)

    order = list(range(table.row_count))
    # 優先度の低いキーから順に安定ソートを重ねると、複数キーの並べ替えになる
    for key in reversed(keys):
        values = table.data[key.column]
        present = [i for i in order if values[i] is not None]
        blanks = [i for i in order if values[i] is None]
        present.sort(key=lambda i: values[i], reverse=not key.ascending)  # Pythonの sort は reverse でも安定
        order = present + blanks

    desc = "、".join(f"{k.column}（{'昇順' if k.ascending else '降順'}）" for k in keys)
    return NodeOutput(table=pick_rows(table, order), issues=[info("SORTED", f"{desc}で並べ替えました。")])
