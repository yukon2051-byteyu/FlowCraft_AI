"""実行の記録（品質検証の履歴1件。品質MVP・共通基盤）。

「いつ・どのデータを・どの版のルールで検証し・何を見つけ・正式に出力したか」を1件の記録にする。
画面からの実行はブラウザに、無人実行は Worker のデータベースに、この形のまま保存する（保存先には依存しない）。

- どのデータ：入力ファイルの名前・シート・SHA-256（中身から計算する識別）・件数・承認した列の対応付け
- どの版のルール：ルールごとの識別・版・複製元と、**その時点の設定の写し**（あとでルールを変えても過去の記録は変わらない）
- 業務データそのものは入れない（根拠の該当行の例は、完了基準の結果に含まれる最大5件だけ）
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.engine.nodes.load import Binding
from app.engine.runner import Execution
from app.flow.schema import FlowDefinition, LoadNode
from app.quality.compare import change_metric_fingerprint, change_metric_id, input_fingerprint, period_of, ref_fingerprint, rule_fingerprint
from app.quality.models import CopySource, InputRecord, MetricRecord, OfficialOutputRecord, OutputRecord, RuleRecord, RunRecord, RunSource
from app.quality.output import OutputDecision, decide_output

__all__ = ["RunRecord", "build_record", "anomaly_count", "period_of", "build_metrics"]

# 完了基準の種類ごとに「異常の件数」を表す根拠の項目（前回比較の「品質異常の件数」に使う）。
# 件数で表せない種類（合計の一致・件数・確認用の値）は持たない
ANOMALY_EVIDENCE: dict[str, str] = {
    "period": "期間外の件数",
    "all_matched": "照合できない行",
    "no_blank": "空欄の件数",
    "unique": "重複している行",
    "value_range": "範囲外の件数",
    "data_type": "変換できない件数",
    "list_rows": "該当件数",
}

_LEADING_INT = re.compile(r"^\s*([0-9][0-9,]*)")


def anomaly_count(kind: str, evidence: dict[str, str]) -> int | None:
    key = ANOMALY_EVIDENCE.get(kind)
    if key is None or key not in evidence:
        return None
    m = _LEADING_INT.match(evidence[key])
    return int(m.group(1).replace(",", "")) if m else None


def build_record(
    flow: FlowDefinition,
    ex: Execution,
    *,
    run_id: str,
    executed_at: datetime,
    flow_hash: str,
    bindings: dict[str, Binding],
    files: dict[str, Any],
    run_values: dict[str, str] | None = None,
    source: RunSource = "manual",
    decision: OutputDecision | None = None,
) -> RunRecord:
    r = ex.result
    run_values = dict(run_values or {})
    decision = decision or decide_output(r)

    # 入力：読み込みステップの件数と、割り当てたファイルの識別
    rows_by_input: dict[str, int | None] = {}
    for node in flow.nodes:
        if isinstance(node, LoadNode):
            run = next((n for n in r.nodes if n.node_id == node.node_id), None)
            rows_by_input[node.parameters.input_id] = run.output_rows if run else None
    inputs = []
    for d in flow.input_definitions:
        b = bindings.get(d.input_id)
        f = files.get(b.file_id) if b else None
        inputs.append(
            InputRecord(
                input_id=d.input_id,
                label=d.label,
                filename=getattr(f, "filename", None),
                sheet=(b.sheet or f.default_sheet()) if b and f else None,
                sha256=getattr(f, "sha256", None),
                rows=rows_by_input.get(d.input_id),
                column_mapping=dict(b.column_mapping) if b else {},
            )
        )

    outputs = [
        OutputRecord(
            reference=o.reference,
            sheet_name=o.sheet_name,
            rows=ex.tables[o.reference].row_count if o.reference in ex.tables else None,
            fingerprint=r.fingerprints.get(o.reference),
        )
        for o in r.outputs
    ]

    defs = {c.criterion_id: c for c in flow.completion_criteria.items}
    rules = []
    for c in r.criteria:
        d = defs[c.criterion_id]
        rules.append(
            RuleRecord(
                criterion_id=c.criterion_id,
                rule_id=d.rule_id,
                rule_version=d.rule_version,
                copied_from=CopySource(**d.copied_from.model_dump()) if d.copied_from else None,
                name=c.name,
                kind=c.kind,
                on_fail=c.on_fail,
                snapshot=d.model_dump(mode="json", by_alias=True),
                status=c.status,
                summary=c.summary,
                evidence=dict(c.evidence),
                examples=[dict(e) for e in c.examples],
                anomaly_count=anomaly_count(c.kind, c.evidence),
            )
        )

    v = r.verdict
    metrics = build_metrics(flow, inputs, outputs, rules, {c.criterion_id: c.metric_value for c in r.criteria})
    return RunRecord(
        run_id=run_id,
        source=source,
        executed_at=executed_at,
        duration_ms=r.duration_ms,
        flow_id=str(flow.flow_id),
        flow_name=flow.flow_name,
        flow_version=flow.flow_version,
        flow_hash=flow_hash,
        criteria_version=flow.completion_criteria.version,
        period=period_of(flow, run_values),
        run_parameters=run_values,
        inputs=inputs,
        outputs=outputs,
        processing_status="failed" if r.status == "failed" else "completed",
        steps=len(flow.nodes),
        verdict=v.verdict if v else None,
        verdict_headline=v.headline if v else None,
        verdict_reasons=list(v.reasons) if v else [],
        rules=rules,
        official_output=OfficialOutputRecord(mode=decision.mode, stop_reason=decision.stop_reason),
        metrics=metrics,
    )


def build_metrics(
    flow: FlowDefinition, inputs: list[InputRecord], outputs: list[OutputRecord], rules: list[RuleRecord], change_values: dict[str, str | None]
) -> list[MetricRecord]:
    """前回と比べる数値（指標）。指標ごとに、定義の指紋を付ける（違えば比べない）"""
    out: list[MetricRecord] = []
    # 業務の数値：入力件数・出力件数・「前回からの変化」で選んだ数値（件数・合計）
    for i in inputs:
        if i.rows is not None:
            out.append(MetricRecord(metric_id=f"input_rows:{i.input_id}", label=f"入力件数（{i.label}）", category="business", value=str(i.rows), fingerprint=input_fingerprint(flow, i.input_id)))
    for o in outputs:
        if o.rows is not None:
            out.append(MetricRecord(metric_id=f"output_rows:{o.reference}", label=f"出力件数（{o.sheet_name}）", category="business", value=str(o.rows), fingerprint=ref_fingerprint(flow, o.reference)))
    defs = {c.criterion_id: c for c in flow.completion_criteria.items}
    for cid, value in change_values.items():
        c = defs.get(cid)
        if value is None or c is None or c.kind != "change_from_previous":
            continue
        what = f"「{c.target.column}」の合計" if c.params.measure == "sum" else "件数"
        out.append(MetricRecord(metric_id=change_metric_id(c), label=f"{c.name}（{what}）", category="business", value=value, fingerprint=change_metric_fingerprint(flow, c)))
    # 品質異常の件数：ルールごとの異常件数と、満たしていない基準の数（全体・重大）
    judged = [r for r in rules if r.status in ("passed", "failed") and r.on_fail != "record"]
    for r in rules:
        if r.anomaly_count is not None and r.status in ("passed", "failed", "recorded"):
            out.append(MetricRecord(metric_id=f"anomaly:{r.rule_id}", label=f"{r.name}（異常の件数）", category="quality", value=str(r.anomaly_count), fingerprint=rule_fingerprint(flow, defs[r.criterion_id])))
    all_fp = "|".join(sorted(rule_fingerprint(flow, defs[r.criterion_id]) for r in rules if r.on_fail != "record"))
    failed = [r for r in judged if r.status == "failed"]
    out.append(MetricRecord(metric_id="quality:failed_rules", label="満たしていない完了基準の数", category="quality", value=str(len(failed)), fingerprint=all_fp or "none"))
    out.append(
        MetricRecord(metric_id="quality:critical_rules", label="うち重大な基準の数", category="quality", value=str(sum(1 for r in failed if r.on_fail == "critical")), fingerprint=all_fp or "none")
    )
    return out
