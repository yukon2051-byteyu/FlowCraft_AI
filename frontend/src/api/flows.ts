import { computeDependencies } from '../flow/ops'
import type { Binding, FlowDoc } from '../flow/types'
import { apiRequest, downloadFile } from './client'

/*
 * 作業手順のチェック（backend/app/api/flows.py の /api/flows/validate）。
 * 形の誤りがあっても 200 で「問題の一覧」が返る。
 */

export type StructureIssue = { code: string; severity: 'error' | 'warning' | 'info' | string; message: string; node_id: string | null }

export type ValidateResult = {
  valid: boolean
  executable: boolean
  schema_errors: { location: string; message: string }[]
  issues: StructureIssue[]
  blockers: StructureIssue[]
  dependencies: { node_id: string; depends_on: string[] }[]
}

/** 画面の作業手順をそのまま送る（つながりの記録はその場で計算する） */
export function validateFlow(flow: FlowDoc): Promise<ValidateResult> {
  return apiRequest<ValidateResult>('/api/flows/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow: { ...flow, dependencies: computeDependencies(flow.nodes) } }),
  })
}

/**
 * 形の誤りの場所から、ステップの番号（0始まり）を取り出す。
 * サーバーは "nodes[3].parameters.keys" の形で返す（app/flow/validate.py の _location）。古い形 "nodes.3.…" も受け付ける。
 */
export function stepIndexOf(location: string): number | null {
  const m = /^nodes(?:\[(\d+)\]|\.(\d+))/.exec(location)
  return m ? Number(m[1] ?? m[2]) : null
}

/** 形の誤りの場所から、ステップの中の項目の部分だけを取り出す（例 "nodes[3].parameters.keys" → "parameters.keys"） */
export function fieldOf(location: string): string {
  return location.replace(/^nodes(?:\[\d+\]|\.\d+)\.?/, '')
}

/* ---------- テスト実行（/api/flows/preview）と全体の実行（/api/runs） ---------- */

export type EngineIssue = {
  code: string
  severity: 'info' | 'warning' | 'error' | string
  message: string
  cause: string | null
  how_to_fix: string | null
  details: Record<string, unknown>
}

export type StepRun = {
  node_id: string
  node_type: string
  node_name: string
  status: 'ok' | 'warning' | 'error' | 'skipped' | string
  input_rows: number[]
  output_rows: number | null
  added_columns: string[]
  removed_columns: string[]
  issues: EngineIssue[]
  duration_ms: number
}

export type TablePreview = { reference: string; columns: string[]; types: string[]; rows: (string | null)[][]; shown: number; total: number }

export type PreviewResult = {
  node: StepRun | null
  inputs: TablePreview[]
  output: TablePreview | null
  stopped_at: string | null
  flow_issues: EngineIssue[]
}

export type RunSummary = {
  run_id: string
  status: 'success' | 'warning' | 'failed' | string
  can_export: boolean
  engine_version: string
  flow_hash: string
  executed_at: string
  duration_ms: number
  nodes: StepRun[]
  flow_issues: EngineIssue[]
  outputs: { sheet_name: string; reference: string }[]
  fingerprints: Record<string, string>
  /** 完了基準の評価結果（タスク2-2）。表示は 2-5 で作る */
  criteria: CriterionResult[]
  /** 実行時に指定した値 */
  run_parameters: Record<string, string>
  /** 総合判定（タスク2-3）。実行できなかったときも返る */
  verdict: Verdict | null
  /** 実行の記録（品質の履歴1件。backend/app/quality/record.py）。品質MVP QM-3 でブラウザに保存する */
  record?: Record<string, unknown> | null
  /** 前回との比較（backend/app/quality/compare.py） */
  comparison?: Record<string, unknown> | null
  /** 分析（backend/app/analysis/engine.py。AIを使わない計算）。画面は Phase B で作る */
  analysis?: Record<string, unknown> | null
}

/**
 * 総合判定。export：allowed（そのまま出力）／needs_confirmation（確認したうえで出力）／report_only（調査用の確認結果だけ）
 * standard_only：業務の完了基準がなく、標準の確認だけで判定した（「正常」と言い切らない）
 */
export type Verdict = {
  verdict: 'normal' | 'caution' | 'critical' | 'unverified'
  standard_only: boolean
  headline: string
  reasons: string[]
  export: 'allowed' | 'needs_confirmation' | 'report_only'
  counts: Record<string, number>
}

/** 完了基準1つの評価結果。unverified（未検証）は「確かめられなかった」で、満たしているとはみなさない */
export type CriterionResult = {
  criterion_id: string
  name: string
  kind: string
  on_fail: 'critical' | 'caution' | 'record' | string
  status: 'passed' | 'failed' | 'unverified' | 'not_applicable' | 'recorded' | string
  summary: string
  evidence: Record<string, string>
  examples: Record<string, unknown>[]
  how_to_fix: string | null
}

export type RunDetail = RunSummary & { output_previews: TablePreview[] }

const body = (flow: FlowDoc, bindings: Binding[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ flow: { ...flow, dependencies: computeDependencies(flow.nodes) }, bindings, ...extra })

/** 指定したステップまで実行し、その処理の前後のデータを返す（確認済みでないステップがあっても実行する） */
export function previewStep(flow: FlowDoc, bindings: Binding[], nodeId: string, limit = 50): Promise<PreviewResult> {
  return apiRequest<PreviewResult>('/api/flows/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(flow, bindings, { node_id: nodeId, limit }) })
}

/*
 * Phase 3：再実行時の入力の変化の検出（backend/app/files/compare.py）。
 * 保存した作業手順の列構成と、今回割り当てたファイルを比べる。列名の対応付けは自動では決めず、候補と理由を返す。
 */

export type RenameCandidate = { column: string; score: number; reasons: string[] }

export type InputCheck = {
  input_id: string
  label: string
  assigned: boolean
  can_run: boolean
  has_changes: boolean
  missing: { name: string; type: string; required: boolean; candidates: RenameCandidate[] }[]
  added: string[]
  order_changed: boolean
  expected_order: string[]
  actual_order: string[]
  type_problems: { name: string; type: string; failed: number; examples: { row: number; value: string | null }[] }[]
  blank_required: { name: string; count: number; rows: number[] }[]
  mapping_errors: string[]
  mapping_applied: Record<string, string>
}

export function checkInputs(flow: FlowDoc, bindings: Binding[]): Promise<InputCheck[]> {
  return apiRequest<InputCheck[]>('/api/flows/check-inputs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(flow, bindings) })
}

/** 前回のExcelと比較する：比較用ファイルで実行した結果（baseline）と、今回の結果を比べる（分析 Phase B-3） */
export function compareWithRun(runId: string, baselineRunId: string): Promise<{ comparison: Record<string, unknown>; analysis: Record<string, unknown> }> {
  return apiRequest(`/api/runs/${encodeURIComponent(runId)}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline_run_id: baselineRunId }),
  })
}

/** 作業手順全体を実行する（すべてのステップが確認済みであること） */
export function runFlow(flow: FlowDoc, bindings: Binding[], runParameters: Record<string, string> = {}): Promise<RunSummary> {
  return apiRequest<RunSummary>('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(flow, bindings, { run_parameters: runParameters }),
  })
}

export function fetchRun(runId: string, limit = 50): Promise<RunDetail> {
  return apiRequest<RunDetail>(`/api/runs/${encodeURIComponent(runId)}?limit=${limit}`)
}

/** 実行結果を Excel ファイルで保存する。失敗した実行は「確認結果」「処理の記録」だけ（調査用） */
export function exportRun(runId: string, confirmed = false): Promise<string> {
  // 注意・未検証の結果は、利用者が確認したことを伝えないとサーバーが出力しない（409）
  return downloadFile(`/api/runs/${encodeURIComponent(runId)}/export${confirmed ? '?confirmed=true' : ''}`, 'flowcraft_result.xlsx')
}
