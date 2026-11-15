import type { Improvement } from '../api/kaizen'
import type { Decisions } from './decisions'

/*
 * 業務改善デモ ⇄ 作業手順の画面 の受け渡し（このタブの sessionStorage。サーバーには保存しない）。
 * - 改善後の作業手順：STEP 4 で「開いて実行する」を押すと置き、作業手順の画面（/build?kaizen=…）が読む
 * - デモの状態（判断・改善後の手順）：作業手順の画面の「業務改善デモに戻る」（/kaizen-demo?resume=1）のときだけ戻す
 *   ふつうに /kaizen-demo を開いたときは消して、初期状態から始める（前の判断が意図せず残らない。指示書 §10）
 * 保存できない環境（プライベートモード等）では受け渡さない（呼び出し側が案内を出す）。
 */

const FLOW_KEY = 'flowcraft.kaizen.flow'
const STATE_KEY = 'flowcraft.kaizen.state'

const RUN_KEY = 'flowcraft.kaizen.run'

export type KaizenState = { step: number; decisions: Decisions; improvement: Improvement | null }

/**
 * 改善後の作業手順を、作業手順の画面でサンプルのExcelで実行した結果の要約（STEP 5 の比較に、実際の結果として出す）。
 * 実行した作業手順（flow_id）が、今の改善後の作業手順と同じときだけ使う。
 */
export type KaizenRunResult = {
  flow_id: string
  executed_at: string
  verdict: 'normal' | 'caution' | 'critical' | 'unverified' | null
  headline: string | null
  can_export: boolean
  criteria_total: number
  criteria_passed: number
}

export function saveRunResult(r: KaizenRunResult): void {
  put(RUN_KEY, r)
}

export function runResultFor(flowId: string | undefined): KaizenRunResult | null {
  const r = get<KaizenRunResult>(RUN_KEY)
  return r && flowId && r.flow_id === flowId ? r : null
}

function put(key: string, value: unknown): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function get<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function handOffFlow(flow: unknown, state: KaizenState): boolean {
  return put(FLOW_KEY, flow) && put(STATE_KEY, state)
}

export function handedFlow(): unknown {
  return get<unknown>(FLOW_KEY)
}

export function resumeState(): KaizenState | null {
  const s = get<KaizenState>(STATE_KEY)
  return s && typeof s.step === 'number' && s.decisions && typeof s.decisions === 'object' ? s : null
}

export function clearKaizenState(): void {
  try {
    sessionStorage.removeItem(FLOW_KEY)
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(RUN_KEY)
  } catch {
    // 消せなくても動きは止めない
  }
}
