import type { FlowDoc } from '../flow/types'
import { apiRequest } from './client'

/*
 * AIの土台（docs/ai-auth-design.md）と、AI業務改善診断の材料（A-2）の API。
 * APIキー・パスワード・費用の金額は、サーバーから返ってこない（画面には持たない）。
 */

export type AiStatus = {
  /** off：使わない（未設定）／fixed：固定応答（テスト用・AIは呼ばない）／live：実際のAI */
  status: 'off' | 'fixed' | 'live'
  authenticated: boolean
  expires_in_seconds: number | null
  calls_left_this_hour: number
}

export function getAiStatus(): Promise<AiStatus> {
  return apiRequest<AiStatus>('/api/ai/status')
}

export function authenticateAi(password: string): Promise<AiStatus> {
  return apiRequest<AiStatus>('/api/ai/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
}

export function endAi(): Promise<void> {
  return apiRequest<void>('/api/ai/auth', { method: 'DELETE' })
}

/** AIに送る材料の元（画面にある情報）。ファイルは今回読み込んだもの（見出し行・シートは割当と同じ） */
export type ContextRequest = {
  name: string
  purpose: string
  flow?: FlowDoc | null
  files?: { file_id: string; sheet?: string | null; header_row?: number; label?: string | null }[]
}

export type ContextPreview = {
  sections: { key: string; title: string; lines: string[] }[]
  /** 送らない情報（個人情報の可能性など） */
  excluded: string[]
  /** 足りない情報（ないものとして扱う） */
  missing: string[]
  /** AIに送る文章（画面に見せるものと同じ） */
  text: string
  chars: number
  /** 同じ材料を何度も送らないための指紋 */
  fingerprint: string
}

/** AI業務改善診断に送る材料を作る（AIは呼ばない・パスワード不要） */
export function buildDiagnosisContext(req: ContextRequest): Promise<ContextPreview> {
  return apiRequest<ContextPreview>('/api/ai/diagnosis/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
}

export type DiagnosisQuestion = { question: string; why: string; examples: string[] }

export type QuestionsResponse = {
  /** 材料から把握したこと（1〜2文） */
  understanding: string
  /** 初回は3問まで */
  questions: DiagnosisQuestion[]
  fingerprint: string
  /** 前回の結果を返した（AIは呼んでいない） */
  cached: boolean
  mode: 'fixed' | 'live'
}

/** AIに、データからは分からない業務の背景を質問してもらう（AIを使う。認証が必要） */
export function askDiagnosisQuestions(req: ContextRequest): Promise<QuestionsResponse> {
  return apiRequest<QuestionsResponse>('/api/ai/diagnosis/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
}

export type ProposalEvidence = { source: 'data' | 'answer' | 'inference'; text: string; ref: string; downgraded: boolean }

export type Proposal = {
  proposal_id: string
  direction: 'eliminate' | 'simplify' | 'standardize' | 'automate'
  title: string
  target: string
  problem: string
  change: string
  evidence: ProposalEvidence[]
  effect: string
  estimate: { kind: 'estimated' | 'assumed'; text: string } | null
  risks: string[]
  recommendation: string
  priority: number
}

export type ProposalsResponse = {
  /** 重要な順 */
  proposals: Proposal[]
  /** 初めに見せる数（ほかは開いて見る） */
  shown_first: number
  note: string
  fingerprint: string
  cached: boolean
  mode: 'fixed' | 'live'
}

/** AIに改善提案を作ってもらう（AIを使う。認証が必要） */
export function askDiagnosisProposals(req: ContextRequest & { answers: { question: string; answer: string }[] }): Promise<ProposalsResponse> {
  return apiRequest<ProposalsResponse>('/api/ai/diagnosis/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
}
