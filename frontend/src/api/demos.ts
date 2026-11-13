import type { Binding } from '../flow/types'
import { apiRequest } from './client'

/*
 * デモ（M1・docs/demo-design.md）。backend/app/api/demos.py と同じ形。
 * 開始すると、デモのファイルがセッションに読み込まれ、作業手順・割当・実行時に指定する値が返る。
 */

export type DemoPattern = 'ok' | 'ng'

export type DemoSummary = {
  demo_id: string
  title: string
  summary: string
  available: boolean
  patterns: Record<string, { label: string; description: string }>
}

export type DemoStart = {
  demo_id: string
  title: string
  pattern: DemoPattern
  pattern_label: string
  description: string
  guide: string
  flow: unknown
  bindings: Omit<Binding, 'column_mapping'>[]
  run_parameters: Record<string, string>
  /** 品質異常のとき：何を直して再実行するか */
  fix_note: string | null
  /** 品質異常のとき：直したデータの体験（いつも 'ok'） */
  fixed_pattern: DemoPattern | null
}

export function listDemos(): Promise<DemoSummary[]> {
  return apiRequest<DemoSummary[]>('/api/demos')
}

export function startDemo(demoId: string, pattern: DemoPattern): Promise<DemoStart> {
  return apiRequest<DemoStart>(`/api/demos/${encodeURIComponent(demoId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern }),
  })
}
