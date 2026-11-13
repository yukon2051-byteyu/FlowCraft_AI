import { apiRequest } from './client'

/*
 * 業務改善診断（デモ①「その集計、本当に必要？」。backend/app/api/kaizen.py）。
 * 改善候補は決まった規則で検出する（AIは使わない。ai_used は常に false）。
 */

export type WorkAction = 'receive' | 'inspect' | 'aggregate' | 'copy' | 'transcribe' | 'reconcile' | 'share'

export type WorkStep = {
  step_id: string
  name: string
  detail: string
  minutes: number
  mode: 'manual' | 'auto'
  action: WorkAction
  must_keep: boolean
  deliverable: string | null
  quality_rules: string[]
  repeats_per_department: boolean
  transcribes_from: string | null
  uses_files: boolean
}

export type BusinessContext = {
  purpose: string
  frequency: string
  minutes_per_run: number
  users: string
  deliverables: string[]
  pain_points: string[]
  quality_concerns: string[]
  must_keep: string[]
  unsure_to_remove: string[]
}

export type Scenario = {
  scenario_id: string
  business_name: string
  goal: string
  period: string
  time_note: string
  context: BusinessContext
  deliverables: { deliverable_id: string; name: string }[]
  steps: WorkStep[]
  department_files: { department: string; filename: string; sheet: string }[]
}

export type FileFacts = { department: string; filename: string; sheet: string; columns: string[]; rows: number; kinds: string[] }

export type ScenarioResponse = { scenario: Scenario; total_minutes: number; files: FileFacts[]; ai_used: boolean }

export type Evidence = { source: 'step' | 'context' | 'file'; ref: string; text: string }

export type Direction = 'eliminate' | 'simplify' | 'standardize' | 'automate'

export type Candidate = {
  candidate_id: string
  rule_id: string
  direction: Direction
  direction_label: string
  title: string
  detail: string
  target_steps: string[]
  evidence: Evidence[]
  effect: string
  checks: string[]
  confirm_question: string | null
  depends_on: string[]
  unsupported_steps: string[]
  column_diffs: { position: number; standard: string; names: Record<string, string> }[]
}

export type Diagnosis = { candidates: Candidate[]; kept: { step_id: string; reason: string }[]; method: string; ai_used: boolean }

export const KAIZEN_DEMO = 'monthly_report'

export function fetchScenario(id: string = KAIZEN_DEMO): Promise<ScenarioResponse> {
  return apiRequest<ScenarioResponse>(`/api/kaizen/scenarios/${encodeURIComponent(id)}`)
}

export function diagnoseScenario(id: string = KAIZEN_DEMO): Promise<Diagnosis> {
  return apiRequest<Diagnosis>(`/api/kaizen/scenarios/${encodeURIComponent(id)}/diagnose`, { method: 'POST' })
}

export type AfterStep = {
  name: string
  mode: 'manual' | 'auto' | 'mixed'
  minutes: number
  from_steps: string[]
  node_ids: string[]
  criteria: string[]
  changed_by: string[]
  note: string
}

export type Improvement = {
  after_steps: AfterStep[]
  /** 実行できる作業手順（通常の作業手順と同じ形）。自動化を採用しなかったときは null */
  flow: Record<string, unknown> | null
  flow_note: string
  changes: { candidate_id: string; status: 'adopt' | 'hold' | 'reject'; text: string }[]
  minutes_before: number
  minutes_after: number
  kept_rules: string[]
  unsupported: string[]
  ai_used: boolean
}

export type DecisionPayload = Record<string, { status: 'adopt' | 'hold' | 'reject' | null; confirm: 'none' | 'exists' | 'unknown' | null; reason: string }>

export function buildImprovement(decisions: DecisionPayload, id: string = KAIZEN_DEMO): Promise<Improvement> {
  return apiRequest<Improvement>(`/api/kaizen/scenarios/${encodeURIComponent(id)}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions }),
  })
}

export type KaizenStart = { bindings: { input_id: string; file_id: string; sheet: string | null; header_row: number }[]; run_parameters: Record<string, string> }

/** 部署のExcel（架空のデータ）をセッションに読み込み、改善後の作業手順の入力に割り当てる */
export function startKaizen(id: string = KAIZEN_DEMO): Promise<KaizenStart> {
  return apiRequest<KaizenStart>(`/api/kaizen/scenarios/${encodeURIComponent(id)}/start`, { method: 'POST' })
}
