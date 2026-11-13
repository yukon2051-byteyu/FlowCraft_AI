import type { Candidate } from '../api/kaizen'

/*
 * 改善候補への利用者の判断（業務改善デモ STEP 3）。
 * - 判断は 採用する／保留する／採用しない。すべての候補を判断するまで次へ進めない（勝手に確定しない）
 * - 確認の問いがある候補（廃止）は、「要件はない」と確かめたときだけ採用できる
 * - 前提の候補がある候補（簡素化 → 標準化）は、前提の候補を採用したときだけ採用できる
 *   前提を後から外したときは、利用者の判断を勝手に書き換えず、矛盾として知らせて先へ進めない
 * - 判断は画面の中だけに持つ（読み込み直す・「最初からやり直す」で初期状態に戻る）
 */

export type DecisionStatus = 'adopt' | 'hold' | 'reject'
/** 確認の問いへの答え：none＝要件はない／exists＝要件がある／unknown＝分からない */
export type ConfirmAnswer = 'none' | 'exists' | 'unknown'

export type Decision = { status: DecisionStatus | null; reason: string; confirm: ConfirmAnswer | null }
export type Decisions = Record<string, Decision>

export const STATUS_LABEL: Record<DecisionStatus, string> = { adopt: '採用する', hold: '保留する', reject: '採用しない' }
export const STATUS_DONE_LABEL: Record<DecisionStatus | 'none', string> = { adopt: '採用', hold: '保留', reject: '採用しない', none: '未判断' }

export const CONFIRM_LABEL: Record<ConfirmAnswer, string> = {
  none: '要件はない（別に作る必要な理由はない）',
  exists: '要件がある',
  unknown: '分からない',
}

/** 理由の選択肢（簡単に選べるように。自由に書き足せる） */
export const REASONS: Record<DecisionStatus, string[]> = {
  adopt: ['効果が大きい', '関係者の了承を得られる', 'すぐに実施できる'],
  hold: ['関係者への確認が必要', '情報が足りない', '今回は見送る'],
  reject: ['業務上の要件がある', '効果が小さい', '別の方法で対応する'],
}

export const REASON_MAX = 100

export function initialDecisions(cands: Candidate[]): Decisions {
  return Object.fromEntries(cands.map((c) => [c.candidate_id, { status: null, reason: '', confirm: null }]))
}

/** 採用できない理由（採用できるなら null） */
export function adoptBlocker(c: Candidate, ds: Decisions): string | null {
  const d = ds[c.candidate_id]
  if (c.confirm_question && d?.confirm !== 'none') return '確認の問いに「要件はない」と答えたときだけ採用できます'
  const missing = c.depends_on.filter((id) => ds[id]?.status !== 'adopt')
  if (missing.length) return `前提の候補${missing.join('・')}を採用すると選べます`
  return null
}

/** 判断を変える。採用できない候補は採用にしない（変更前のまま返す） */
export function decide(c: Candidate, ds: Decisions, status: DecisionStatus): Decisions {
  if (status === 'adopt' && adoptBlocker(c, ds)) return ds
  const cur = ds[c.candidate_id]
  // 判断を変えたら、前の判断の理由は消す（別の判断の理由が残らないように）
  const reason = cur.status === status ? cur.reason : ''
  return { ...ds, [c.candidate_id]: { ...cur, status, reason } }
}

/** 確認の問いに答える。「要件はない」以外に変えたら、採用は取り消して未判断に戻す（採用の条件を満たさなくなるため） */
export function answerConfirm(c: Candidate, ds: Decisions, answer: ConfirmAnswer): Decisions {
  const cur = ds[c.candidate_id]
  const status = cur.status === 'adopt' && answer !== 'none' ? null : cur.status
  return { ...ds, [c.candidate_id]: { ...cur, confirm: answer, status, reason: status === cur.status ? cur.reason : '' } }
}

export function setReason(id: string, ds: Decisions, reason: string): Decisions {
  return { ...ds, [id]: { ...ds[id], reason: reason.slice(0, REASON_MAX) } }
}

/** 次へ進めない理由の一覧（空なら進める） */
export function problems(cands: Candidate[], ds: Decisions): string[] {
  const out: string[] = []
  const undecided = cands.filter((c) => !ds[c.candidate_id]?.status).map((c) => c.candidate_id)
  if (undecided.length) out.push(`まだ判断していない候補があります（候補${undecided.join('・')}）`)
  for (const c of cands) {
    if (ds[c.candidate_id]?.status !== 'adopt') continue
    const blocker = adoptBlocker(c, ds)
    if (blocker) out.push(`候補${c.candidate_id}：${blocker}（判断を見直してください）`)
  }
  return out
}

export function counts(cands: Candidate[], ds: Decisions): Record<DecisionStatus | 'none', number> {
  const out = { adopt: 0, hold: 0, reject: 0, none: 0 }
  for (const c of cands) out[ds[c.candidate_id]?.status ?? 'none'] += 1
  return out
}
