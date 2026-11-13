"""フローの実行（設計書 §4.4）。

流れ：
 1. 実行前の確認：フローの構造エラー・未確定ノード（本実行のみ）があれば実行しない
 2. ノードを上から順に実行し、作られた表を参照名で保管する
 3. ノードごとに 件数・追加/削除された列・問題・所要時間 を記録する
 4. エラーが出たノードで止め、以降は「未実行」とする（不正な結果を先へ流さない）
 5. 行数の上限・処理時間の上限を超えたら止める
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from app import ENGINE_VERSION
from app.criteria.evaluate import evaluate_criteria
from app.criteria.verdict import decide
from app.engine import nodes as _nodes  # noqa: F401  ノードを registry に登録する
from app.engine.registry import NodeContext, get_handler
from app.engine.result import EngineIssue, NodeFailure, NodeRun, OutputSheet, RunResult
from app.engine.table import Table
from app.flow.schema import FlowDefinition
from app.flow.validate import execution_blockers, validate_structure


@dataclass
class RunLimits:
    max_rows: int = 500_000  # 1つの表の行数の上限（結合で膨らんだ場合の保護）
    timeout_seconds: float = 60


@dataclass
class Execution:
    """実行結果（記録）と、実行で作られた表（プレビュー・出力用。メモリ上のみ）。"""

    result: RunResult
    tables: dict[str, Table]


def run_flow(
    flow: FlowDefinition,
    bindings: dict,
    files: dict,
    *,
    limits: RunLimits | None = None,
    require_confirmed: bool = True,
    stop_after: str | None = None,
    run_values: dict[str, str] | None = None,
) -> Execution:
    """フローを実行する。

    require_confirmed=False：プレビュー用。未確定ノードがあっても実行する（成果物は作らない）
    stop_after：このノードまで実行して止める（プレビュー用）
    run_values：実行時に指定する値（例 {"target_month": "2026-10"}）。完了基準の評価に使う
    本番の実行（require_confirmed=True かつ stop_after なし）では、最後に完了基準を評価する（タスク2-2）。
    途中で止まった場合も評価し、確かめられなかった基準は「未検証」になる。
    """
    limits = limits or RunLimits()
    started = time.perf_counter()

    blockers = execution_blockers(flow) if require_confirmed else [i for i in validate_structure(flow) if i.severity == "error"]
    if blockers:
        issues = [EngineIssue(b.code, "error", b.message, details={"node_id": b.node_id}) for b in blockers]
        runs = [NodeRun(n.node_id, n.node_type, n.node_name, "skipped") for n in flow.nodes]
        blocked = RunResult("failed", ENGINE_VERSION, runs, flow_issues=issues)
        if require_confirmed:
            blocked.criteria = evaluate_criteria(flow, blocked, {}, run_values)
            blocked.verdict = decide(blocked)
        return Execution(blocked, {})

    ctx = NodeContext(
        bindings=bindings,
        files=files,
        input_definitions={d.input_id: d for d in flow.input_definitions},
        validation_rules=flow.validation_rules,
        max_rows=limits.max_rows,
    )
    tables: dict[str, Table] = {}
    runs: list[NodeRun] = []
    outputs: list[OutputSheet] = []
    failed = False

    for node in flow.nodes:
        run = NodeRun(node.node_id, node.node_type, node.node_name, "skipped")
        runs.append(run)
        if failed:
            continue

        t0 = time.perf_counter()
        inputs = [tables[r] for r in node.input_references]
        run.input_rows = [t.row_count for t in inputs]
        handler = get_handler(node.node_type)
        try:
            if handler is None:
                raise NodeFailure(
                    EngineIssue(
                        "NODE_NOT_AVAILABLE",
                        "error",
                        f"「{node.node_name}」の処理（{node.node_type}）は、このバージョンでは実行できません。",
                        how_to_fix="対応している処理に置き換えてください。",
                    )
                )
            out = handler(node, inputs, ctx)
            run.issues.extend(out.issues)
            if out.table is not None:
                if out.table.row_count > limits.max_rows:
                    raise NodeFailure(
                        EngineIssue(
                            "TOO_MANY_ROWS",
                            "error",
                            f"「{node.node_name}」の結果が{out.table.row_count:,}行になり、上限（{limits.max_rows:,}行）を超えました。",
                            cause="結合キーの重複などで、行数が想定外に増えた可能性があります。",
                            how_to_fix="結合キーや結合方式を見直してください。",
                        )
                    )
                assert node.output_reference is not None
                tables[node.output_reference] = out.table
                run.output_rows = out.table.row_count
                before = set().union(*(t.columns for t in inputs)) if inputs else set()
                run.added_columns = [c for c in out.table.columns if c not in before]
                if len(inputs) == 1:
                    run.removed_columns = [c for c in inputs[0].columns if c not in out.table.specs]
            outputs.extend(out.sheets)
            run.status = "warning" if any(i.severity == "warning" for i in run.issues) else "ok"
        except NodeFailure as f:
            run.issues.append(f.issue)
            run.status = "error"
            failed = True
        run.duration_ms = int((time.perf_counter() - t0) * 1000)

        if not failed and time.perf_counter() - started > limits.timeout_seconds:
            run.issues.append(
                EngineIssue(
                    "TIMEOUT",
                    "error",
                    f"処理時間が上限（{limits.timeout_seconds:.0f}秒）を超えたため中止しました。",
                    how_to_fix="データ量を減らすか、処理を分けて実行してください。",
                )
            )
            run.status = "error"
            failed = True
        if stop_after is not None and node.node_id == stop_after:
            break

    status = "failed" if failed else ("warning" if any(r.status == "warning" for r in runs) else "success")
    result = RunResult(
        status=status,
        engine_version=ENGINE_VERSION,
        nodes=runs,
        outputs=[] if failed else outputs,
        # 指紋は「出力する表」だけに計算する（途中の表は再現性の確認に不要で、10万行で数秒かかるため）
        fingerprints={} if failed else {o.reference: tables[o.reference].fingerprint() for o in outputs if o.reference in tables},
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    if require_confirmed and stop_after is None:
        result.criteria = evaluate_criteria(flow, result, tables, run_values)
        result.verdict = decide(result)
        result.duration_ms = int((time.perf_counter() - started) * 1000)
    return Execution(result, tables)
