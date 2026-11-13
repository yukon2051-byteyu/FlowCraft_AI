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

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
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
from app.export.excel import build_workbook
from app.files.compare import compare_input
from app.files.profile import build_table
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
    # 実行時に指定する値（例 {"target_month": "2026-10"}）。完了基準の評価に使う
    run_parameters: Annotated[dict[Annotated[str, Field(max_length=64)], Annotated[str, Field(max_length=200)]], Field(max_length=20)] = Field(default_factory=dict)


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


class CriterionResultOut(BaseModel):
    criterion_id: str
    name: str
    kind: str
    on_fail: str
    status: str  # passed／failed／unverified／not_applicable／recorded
    summary: str
    evidence: dict[str, str]
    examples: list[dict[str, Any]]
    how_to_fix: str | None


class VerdictOut(BaseModel):
    verdict: str  # normal／caution／critical／unverified
    standard_only: bool
    headline: str
    reasons: list[str]
    export: str  # allowed／needs_confirmation／report_only
    counts: dict[str, int]


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
    criteria: list[CriterionResultOut] = Field(default_factory=list)
    run_parameters: dict[str, str] = Field(default_factory=dict)
    verdict: VerdictOut | None = None


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


def _summary(run_id: str, ex: Execution, fhash: str, executed_at: datetime, run_values: dict[str, str] | None = None) -> dict[str, Any]:
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
        "criteria": [CriterionResultOut(**jsonable_encoder(asdict(c))) for c in r.criteria],
        "run_parameters": dict(run_values or {}),
        "verdict": VerdictOut(**asdict(r.verdict)) if r.verdict is not None else None,
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


# ---------------------------------------------------------------------------
# 再実行時の入力の変化の検出（Phase 3-1）
# ---------------------------------------------------------------------------


class InputCheckRequest(BaseModel):
    flow: dict[str, Any]
    bindings: list[BindingIn] = Field(default_factory=list)


class RenameCandidateOut(BaseModel):
    column: str
    score: float
    reasons: list[str]


class MissingColumnOut(BaseModel):
    name: str
    type: str
    required: bool
    candidates: list[RenameCandidateOut]


class TypeProblemOut(BaseModel):
    name: str
    type: str
    failed: int
    examples: list[dict[str, Any]]


class BlankValuesOut(BaseModel):
    name: str
    count: int
    rows: list[int]


class InputCheckOut(BaseModel):
    input_id: str
    label: str
    assigned: bool
    can_run: bool
    has_changes: bool
    missing: list[MissingColumnOut] = Field(default_factory=list)
    added: list[str] = Field(default_factory=list)
    order_changed: bool = False
    expected_order: list[str] = Field(default_factory=list)
    actual_order: list[str] = Field(default_factory=list)
    type_problems: list[TypeProblemOut] = Field(default_factory=list)
    blank_required: list[BlankValuesOut] = Field(default_factory=list)
    mapping_errors: list[str] = Field(default_factory=list)
    mapping_applied: dict[str, str] = Field(default_factory=dict)


@router.post("/flows/check-inputs", response_model=list[InputCheckOut])
def check_inputs(req: InputCheckRequest, session: Session = Depends(current_session)) -> list[InputCheckOut]:
    """保存した作業手順の列構成と、今回割り当てたファイルを比べる。処理は行わない（実行前の確認）。

    列名の対応付けは自動では決めない。候補と理由を返し、利用者が承認した対応付け（column_mapping）を当てて比べ直す。
    """
    flow = _parse_or_422(req.flow)
    bindings = _bindings(flow, req.bindings)
    out: list[InputCheckOut] = []
    for d in flow.input_definitions:
        b = bindings.get(d.input_id)
        f = session.files.get(b.file_id) if b else None
        if b is None or f is None:
            out.append(InputCheckOut(input_id=d.input_id, label=d.label, assigned=False, can_run=False, has_changes=False))
            continue
        sheet = b.sheet or f.default_sheet()
        raw = f.sheets.get(sheet)
        if raw is None:
            raise AppError(404, "SHEET_NOT_FOUND", f"シート「{sheet}」が見つかりません。", how_to_fix="シートを選び直してください。")
        c = compare_input(d, build_table(raw, b.header_row, is_csv=f.kind == "csv"), b.header_row, b.column_mapping)
        out.append(InputCheckOut(assigned=True, can_run=c.can_run, has_changes=c.has_changes, **asdict(c)))
    return out


@router.post("/runs", response_model=RunSummary)
def execute(
    req: ExecuteRequest,
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
) -> RunSummary:
    """本番の実行。未確定のノード・構造エラーがあれば実行せず、理由を返す（status=failed）。"""
    flow = _parse_or_422(req.flow)
    ex = run_flow(flow, _bindings(flow, req.bindings), session.files, limits=_limits(settings), require_confirmed=True, run_values=req.run_parameters)
    run_id = "r_" + secrets.token_urlsafe(9)
    executed_at = datetime.now(timezone.utc)
    fhash = flow_hash(flow)
    # Excel出力（処理の記録）のため、実行した作業手順も一緒に持つ（セッションの中だけ。保存はしない）
    session.runs[run_id] = {"execution": ex, "flow_hash": fhash, "executed_at": executed_at, "flow": flow, "run_values": dict(req.run_parameters)}
    while len(session.runs) > MAX_STORED_RUNS:  # 古い実行結果から捨てる（メモリ保護）
        session.runs.pop(next(iter(session.runs)))
    return RunSummary(**_summary(run_id, ex, fhash, executed_at, req.run_parameters))


@router.get("/runs/{run_id}", response_model=RunDetail)
def run_detail(run_id: str, limit: Annotated[int, Query(ge=1, le=200)] = PREVIEW_ROWS, session: Session = Depends(current_session)) -> RunDetail:
    stored = session.runs.get(run_id)
    if stored is None:
        raise AppError(404, "RUN_NOT_FOUND", "実行結果が見つかりません。", how_to_fix="もう一度実行してください。古い実行結果は自動で削除されます。")
    ex: Execution = stored["execution"]
    previews = [_preview(o.reference, ex.tables[o.reference], limit) for o in ex.result.outputs if o.reference in ex.tables]
    return RunDetail(**_summary(run_id, ex, stored["flow_hash"], stored["executed_at"], stored.get("run_values")), output_previews=previews)


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_FILENAME_FORBIDDEN = str.maketrans({c: "_" for c in '\\/:*?"<>|'})


@router.get("/runs/{run_id}/export")
def export_run(run_id: str, confirmed: bool = False, session: Session = Depends(current_session)) -> Response:
    """実行結果を Excel ファイルにする（総合判定にもとづいて出力を制御する。タスク2-3）。

    - 重大（エラーで止まった・重大な基準を満たさない）：処理結果のシートを含めず「確認結果」と「処理の記録」だけ（調査用）
    - 注意・未検証：利用者が内容を確認した（confirmed=true）ときだけ出力する。確認なしでは 409
    - 正常：そのまま出力する
    """
    stored = session.runs.get(run_id)
    if stored is None:
        raise AppError(404, "RUN_NOT_FOUND", "実行結果が見つかりません。", how_to_fix="もう一度実行してください。古い実行結果は自動で削除されます。")
    ex: Execution = stored["execution"]
    v = ex.result.verdict
    if v is not None and v.export == "needs_confirmation" and not confirmed:
        label = "確かめられなかった完了基準" if v.verdict == "unverified" else "確認が必要な点"
        raise AppError(
            409,
            "EXPORT_CONFIRMATION_REQUIRED",
            f"{label}があるため、内容を確認してから出力してください。",
            cause=" ／ ".join(v.reasons[:3]) or None,
            how_to_fix="実行結果の画面で内容を確かめ、「確認したうえで出力する」にチェックを入れてください。",
        )
    flow: FlowDefinition = stored["flow"]
    executed_at: datetime = stored["executed_at"]
    data = build_workbook(flow, ex, executed_at, stored["flow_hash"], stored.get("run_values"))
    kind = "結果" if ex.result.can_export else "確認結果（調査用）"
    stamp = executed_at.astimezone().strftime("%Y%m%d-%H%M")
    name = f"{flow.flow_name}_{kind}_{stamp}.xlsx".translate(_FILENAME_FORBIDDEN)
    # 日本語のファイル名は RFC 5987 の形で渡す（古いブラウザ向けに英数字の名前も付ける）
    disposition = f"attachment; filename=\"flowcraft_{stamp}.xlsx\"; filename*=UTF-8''{quote(name)}"
    return Response(content=data, media_type=XLSX, headers={"Content-Disposition": disposition, "Cache-Control": "no-store"})
