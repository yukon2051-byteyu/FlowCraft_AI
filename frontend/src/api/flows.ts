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
}

export type RunDetail = RunSummary & { output_previews: TablePreview[] }

const body = (flow: FlowDoc, bindings: Binding[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ flow: { ...flow, dependencies: computeDependencies(flow.nodes) }, bindings, ...extra })

/** 指定したステップまで実行し、その処理の前後のデータを返す（確認済みでないステップがあっても実行する） */
export function previewStep(flow: FlowDoc, bindings: Binding[], nodeId: string, limit = 50): Promise<PreviewResult> {
  return apiRequest<PreviewResult>('/api/flows/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(flow, bindings, { node_id: nodeId, limit }) })
}

/** 作業手順全体を実行する（すべてのステップが確認済みであること） */
export function runFlow(flow: FlowDoc, bindings: Binding[]): Promise<RunSummary> {
  return apiRequest<RunSummary>('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(flow, bindings) })
}

export function fetchRun(runId: string, limit = 50): Promise<RunDetail> {
  return apiRequest<RunDetail>(`/api/runs/${encodeURIComponent(runId)}?limit=${limit}`)
}

/** 実行結果を Excel ファイルで保存する。失敗した実行は「確認結果」「処理の記録」だけ（調査用） */
export function exportRun(runId: string): Promise<string> {
  return downloadFile(`/api/runs/${encodeURIComponent(runId)}/export`, 'flowcraft_result.xlsx')
}
