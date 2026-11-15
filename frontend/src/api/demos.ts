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

/** STEP 1・2 の内容（架空の業務シナリオ・事前に用意した改善例。refs は作業手順の処理ステップ n…・完了基準 c…） */
export type DemoStory = {
  business_name: string
  purpose: string
  current_work: string[]
  issues: string[]
  improvements: { before: string; after: string; refs: string[] }[]
  steps: { label: string; refs: string[] }[]
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
  /** 業務の説明（古いサーバーでは無い） */
  story?: DemoStory | null
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
