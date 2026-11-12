"""フローの検証・プレビュー・実行のAPI（設計書 §12・§16）。

サーバーはフローを保存しない。画面が持っているフロー（JSON）を毎回まるごと受け取り、
セッション内のファイルに対して検証・実行する。実行結果はセッション内に直近数回分だけ保持する。
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from app.api.session import current_session
from app.config import Settings, get_settings
from app.engine.convert import to_string
from app.engine.nodes.load import Binding
from app.engine.result import EngineIssue, NodeRun, RunResult
from app.engine.runner import Execution, RunLimits, run_flow
from app.engine.table import Table
from app.errors import AppError
from app.flow.schema import FlowDefinition
from app.flow.validate import FlowSchemaError, compute_dependencies, execution_blockers, parse_flow, validate_structure
from app.sessions.store import Session

router = APIRouter(tags=["flows"])

MAX_STORED_RUNS = 5
PREVIEW_ROWS = 50


# ---------------------------------------------------------------------------
# 受け取る形
# ---------------------------------------------------------------------------


class BindingIn(BaseModel):
    """入力の割当：フローの入力（input_id）に、読み込んだどのファイルを使うか。"""

    input_id: str
    file_id: str
    sheet: str | None = None
    header_row: Annotated[int, Field(ge=1, le=100)] = 1
    column_mapping: dict[str, str] = Field(default_factory=dict)


class ValidateRequest(BaseModel):
    flow: dict[str, Any]


class ExecuteRequest(BaseModel):
    flow: dict[str, Any]
    bindings: list[BindingIn] = Field(default_factory=list)


class PreviewRequest(ExecuteRequest):
    node_id: str
    limit: Annotated[int, Field(ge=1, le=200)] = PREVIEW_ROWS


# ---------------------------------------------------------------------------
# 返す形
# ---------------------------------------------------------------------------


class SchemaErrorOut(BaseModel):
    location: str
    message: str


class StructureIssueOut(BaseModel):
    code: str
    severity: str
    message: str
    node_id: str | None


class ValidateResponse(BaseModel):
    valid: bool  # 形・つながりにエラーがない
    executable: bool  # 本番実行できる（エラーなし・全ノード確定済み）
    schema_errors: list[SchemaErrorOut]
    issues: list[StructureIssueOut]
    blockers: list[StructureIssueOut]  # 実行できない理由
    dependencies: list[dict[str, Any]]


class IssueOut(BaseModel):
    code: str
    severity: str
    message: str
    cause: str | None
    how_to_fix: str | None
    details: dict[str, Any]


class NodeRunOut(BaseModel):
    node_id: str
    node_type: str
    node_name: str
    status: str
    input_rows: list[int]
    output_rows: int | None
    added_columns: list[str]
    removed_columns: list[str]
    issues: list[IssueOut]
    duration_ms: int


class TablePreview(BaseModel):
    reference: str
    columns: list[str]
    types: list[str]
    rows: list[list[str | None]]
    shown: int
    total: int


class PreviewResponse(BaseModel):
    node: NodeRunOut | None  # 指定ノードまで到達しなかった場合は None
    inputs: list[TablePreview]
    output: TablePreview | None
    stopped_at: str | None  # 途中のノードでエラーになった場合、そのノードID
    flow_issues: list[IssueOut]


class OutputSheetOut(BaseModel):
    sheet_name: str
    reference: str


class RunSummary(BaseModel):
    run_id: str
    status: str
    can_export: bool
    engine_version: str
    flow_hash: str  # 実行時のフローの指紋（実行後にフローを編集したか判定するため）
    executed_at: datetime
    duration_ms: int
    nodes: list[NodeRunOut]
    flow_issues: list[IssueOut]
    outputs: list[OutputSheetOut]
    fingerprints: dict[str, str]


class RunDetail(RunSummary):
    output_previews: list[TablePreview]


# ---------------------------------------------------------------------------
# 共通処理
# ---------------------------------------------------------------------------


def _parse_or_422(data: dict[str, Any]) -> FlowDefinition:
    try:
        return parse_flow(data)
    except FlowSchemaError as e:
        err = AppError(
            422,
            "FLOW_SCHEMA_INVALID",
            "作業手順の形式が正しくありません。",
            cause=" ／ ".join(f"{loc}：{msg}" for loc, msg in e.errors[:5]),
            how_to_fix="作業手順を読み込み直すか、エラーの箇所を修正してください。",
        )
        raise err from None


def _bindings(flow: FlowDefinition, items: list[BindingIn]) -> dict[str, Binding]:
    known = {d.input_id for d in flow.input_definitions}
    out: dict[str, Binding] = {}
    for b in items:
        if b.input_id not in known:
            raise AppError(422, "UNKNOWN_INPUT", f"作業手順に入力「{b.input_id}」はありません。", how_to_fix="入力の割当を見直してください。")
        if b.input_id in out:
            raise AppError(422, "DUPLICATE_BINDING", f"入力「{b.input_id}」に複数のファイルが割り当てられています。", how_to_fix="1つの入力には1つのファイルを割り当ててください。")
        out[b.input_id] = Binding(b.input_id, b.file_id, b.sheet, b.header_row, dict(b.column_mapping))
    return out


def _limits(settings: Settings) -> RunLimits:
    return RunLimits(max_rows=settings.max_intermediate_rows, timeout_seconds=settings.run_timeout_seconds)


def flow_hash(flow: FlowDefinition) -> str:
    canonical = json.dumps(flow.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _issue(i: EngineIssue) -> IssueOut:
    return IssueOut(code=i.code, severity=i.severity, message=i.message, cause=i.cause, how_to_fix=i.how_to_fix, details=jsonable_encoder(i.details))


def _node(n: NodeRun) -> NodeRunOut:
    d = asdict(n)
    d["issues"] = [_issue(i) for i in n.issues]
    return NodeRunOut(**d)


def _preview(ref: str, t: Table, limit: int) -> TablePreview:
    rows = [[to_string(v) for v in r] for r in t.rows(0, limit)]
    return TablePreview(reference=ref, columns=list(t.columns), types=[t.type_of(c) for c in t.columns], rows=rows, shown=len(rows), total=t.row_count)


def _summary(run_id: str, ex: Execution, fhash: str, executed_at: datetime) -> dict[str, Any]:
    r: RunResult = ex.result
    return {
        "run_id": run_id,
        "status": r.status,
        "can_export": r.can_export,
        "engine_version": r.engine_version,
        "flow_hash": fhash,
        "executed_at": executed_at,
        "duration_ms": r.duration_ms,
        "nodes": [_node(n) for n in r.nodes],
        "flow_issues": [_issue(i) for i in r.flow_issues],
        "outputs": [OutputSheetOut(sheet_name=o.sheet_name, reference=o.reference) for o in r.outputs],
        "fingerprints": r.fingerprints,
    }


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@router.post("/flows/validate", response_model=ValidateResponse)
def validate(req: ValidateRequest) -> ValidateResponse:
    """フローの形とつながりを検査する。問題があっても 200 で「問題の一覧」を返す（画面がノードを色分けするため）。"""
    try:
        flow = parse_flow(req.flow)
    except FlowSchemaError as e:
        return ValidateResponse(
            valid=False,
            executable=False,
            schema_errors=[SchemaErrorOut(location=loc, message=msg) for loc, msg in e.errors],
            issues=[],
            blockers=[],
            dependencies=[],
        )
    issues = validate_structure(flow)
    blockers = execution_blockers(flow)

    def out(items):  # type: ignore[no-untyped-def]
        return [StructureIssueOut(code=i.code, severity=i.severity, message=i.message, node_id=i.node_id) for i in items]

    return ValidateResponse(
        valid=not any(i.severity == "error" for i in issues),
        executable=not blockers,
        schema_errors=[],
        issues=out(issues),
        blockers=out(blockers),
        dependencies=[d.model_dump() for d in compute_dependencies(flow)],
    )


@router.post("/flows/preview", response_model=PreviewResponse)
def preview(
    req: PreviewRequest,
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
) -> PreviewResponse:
    """指定ノードまで実行し、そのノードの入力と出力の先頭行を返す（未確定のノードがあっても実行する）。"""
    flow = _parse_or_422(req.flow)
    target = next((n for n in flow.nodes if n.node_id == req.node_id), None)
    if target is None:
        raise AppError(422, "NODE_NOT_FOUND", f"ステップ「{req.node_id}」が作業手順にありません。", how_to_fix="画面を再読み込みしてください。")

    ex = run_flow(flow, _bindings(flow, req.bindings), session.files, limits=_limits(settings), require_confirmed=False, stop_after=req.node_id)
    runs = {n.node_id: n for n in ex.result.nodes}
    node_run = runs.get(req.node_id)
    reached = node_run is not None and node_run.status != "skipped"
    stopped = next((n.node_id for n in ex.result.nodes if n.status == "error"), None)

    inputs = [_preview(ref, ex.tables[ref], req.limit) for ref in target.input_references if ref in ex.tables]
    output = None
    if reached and target.output_reference and target.output_reference in ex.tables:
        output = _preview(target.output_reference, ex.tables[target.output_reference], req.limit)
    return PreviewResponse(
        node=_node(node_run) if reached and node_run else None,
        inputs=inputs,
        output=output,
        stopped_at=stopped,
        flow_issues=[_issue(i) for i in ex.result.flow_issues],
    )


@router.post("/runs", response_model=RunSummary)
def execute(
    req: ExecuteRequest,
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
) -> RunSummary:
    """本番の実行。未確定のノード・構造エラーがあれば実行せず、理由を返す（status=failed）。"""
    flow = _parse_or_422(req.flow)
    ex = run_flow(flow, _bindings(flow, req.bindings), session.files, limits=_limits(settings), require_confirmed=True)
    run_id = "r_" + secrets.token_urlsafe(9)
    executed_at = datetime.now(timezone.utc)
    fhash = flow_hash(flow)
    session.runs[run_id] = {"execution": ex, "flow_hash": fhash, "executed_at": executed_at}
    while len(session.runs) > MAX_STORED_RUNS:  # 古い実行結果から捨てる（メモリ保護）
        session.runs.pop(next(iter(session.runs)))
    return RunSummary(**_summary(run_id, ex, fhash, executed_at))


@router.get("/runs/{run_id}", response_model=RunDetail)
def run_detail(run_id: str, limit: Annotated[int, Query(ge=1, le=200)] = PREVIEW_ROWS, session: Session = Depends(current_session)) -> RunDetail:
    stored = session.runs.get(run_id)
    if stored is None:
        raise AppError(404, "RUN_NOT_FOUND", "実行結果が見つかりません。", how_to_fix="もう一度実行してください。古い実行結果は自動で削除されます。")
    ex: Execution = stored["execution"]
    previews = [_preview(o.reference, ex.tables[o.reference], limit) for o in ex.result.outputs if o.reference in ex.tables]
    return RunDetail(**_summary(run_id, ex, stored["flow_hash"], stored["executed_at"]), output_previews=previews)
