import { computeDependencies } from '../flow/ops'
import type { FlowDoc } from '../flow/types'
import { apiRequest } from './client'

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

/** 形の誤りの場所（例 "nodes.3.join.parameters.keys"）から、ステップの番号（0始まり）を取り出す */
export function stepIndexOf(location: string): number | null {
  const m = /^nodes\.(\d+)/.exec(location)
  return m ? Number(m[1]) : null
}
