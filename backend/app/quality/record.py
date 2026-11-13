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
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.engine.nodes.load import Binding
from app.engine.runner import Execution
from app.flow.schema import FlowDefinition, LoadNode
from app.quality.output import OutputDecision, decide_output

RECORD_VERSION = 1

RunSource = Literal["manual", "worker", "demo"]

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


class InputRecord(BaseModel):
    input_id: str
    label: str
    filename: str | None
    sheet: str | None
    sha256: str | None
    rows: int | None
    column_mapping: dict[str, str] = Field(default_factory=dict)


class OutputRecord(BaseModel):
    reference: str
    sheet_name: str
    rows: int | None
    fingerprint: str | None


class CopySource(BaseModel):
    rule_id: str
    rule_version: int


class RuleRecord(BaseModel):
    """適用した品質ルール1つと、その判定"""

    criterion_id: str
    rule_id: str
    rule_version: int
    copied_from: CopySource | None
    name: str
    kind: str
    on_fail: str
    # 実行した時点のルールの設定の写し（作業手順の完了基準の1項目そのもの）
    snapshot: dict[str, Any]
    status: str
    summary: str
    evidence: dict[str, str]
    examples: list[dict[str, Any]]
    # 異常の件数（件数で表せない種類は None）
    anomaly_count: int | None


class OfficialOutputRecord(BaseModel):
    mode: Literal["allowed", "needs_confirmation", "report_only"]
    # 正式な結果を出力したか（画面では出力した後、Worker では正式なファイルを確定した後に True にする）
    performed: bool = False
    performed_at: datetime | None = None
    stop_reason: str | None = None


class RunRecord(BaseModel):
    record_version: int = RECORD_VERSION
    run_id: str
    source: RunSource
    executed_at: datetime
    duration_ms: int

    flow_id: str
    flow_name: str
    flow_version: int
    flow_hash: str
    criteria_version: int

    # 対象期間（実行時に指定する「月」の値。例 "2026-10"）。分からなければ None（前回比較はしない）
    period: str | None
    run_parameters: dict[str, str]

    inputs: list[InputRecord]
    outputs: list[OutputRecord]
    # 処理の状態（品質の判定とは別）：completed＝最後まで処理した／failed＝途中で止まった
    processing_status: Literal["completed", "failed"]
    steps: int

    verdict: str | None
    verdict_headline: str | None
    verdict_reasons: list[str]
    rules: list[RuleRecord]
    official_output: OfficialOutputRecord


def anomaly_count(kind: str, evidence: dict[str, str]) -> int | None:
    key = ANOMALY_EVIDENCE.get(kind)
    if key is None or key not in evidence:
        return None
    m = _LEADING_INT.match(evidence[key])
    return int(m.group(1).replace(",", "")) if m else None


def period_of(flow: FlowDefinition, run_values: dict[str, str]) -> str | None:
    """対象期間：実行時に指定する値のうち、最初の「月」の値"""
    for p in flow.run_parameters:
        if p.type == "month" and run_values.get(p.param_id):
            return run_values[p.param_id]
    return None


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
                snapshot=d.model_dump(mode="json"),
                status=c.status,
                summary=c.summary,
                evidence=dict(c.evidence),
                examples=[dict(e) for e in c.examples],
                anomaly_count=anomaly_count(c.kind, c.evidence),
            )
        )

    v = r.verdict
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
    )
