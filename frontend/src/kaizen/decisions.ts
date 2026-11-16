import type { Candidate } from '../api/kaizen'

/*
 * 改善候補への利用者の判断（業務改善デモ STEP 3）。
 * - 判断は 採用する／保留する／採用しない。すべての候補を判断するまで次へ進めない（勝手に確定しない）
 * - 確認の問いがある候補（廃止）は、「要件はない」と確かめたときだけ採用できる
 * - 前提の候補がある候補（簡素化 → 標準化）は、前提の候補を採用したときだけ採用できる
 *   前提を後から外したときは、利用者の判断を勝手に書き換えず、矛盾として知らせて先へ進めない
 * - 判断は画面の中だけに持つ（読み込み直す・「最初からやり直す」で初期状態に戻る）
 * - 理由は判断ごとに持つ（採用する理由・保留する理由・採用しない理由）。判断を切り替えても、入力した理由は消えない
 *   サーバーへは、選んだ判断の理由だけを送る（toPayload）
 */

export type DecisionStatus = 'adopt' | 'hold' | 'reject'
/** 確認の問いへの答え：none＝要件はない／exists＝要件がある／unknown＝分からない */
export type ConfirmAnswer = 'none' | 'exists' | 'unknown'

export type Decision = { status: DecisionStatus | null; reasons: Record<DecisionStatus, string>; confirm: ConfirmAnswer | null }
export type Decisions = Record<string, Decision>

export const STATUS_LABEL: Record<DecisionStatus, string> = { adopt: '採用する', hold: '保留する', reject: '採用しない' }
export const STATUS_DONE_LABEL: Record<DecisionStatus | 'none', string> = { adopt: '採用', hold: '保留', reject: '採用しない', none: '未判断' }

export const CONFIRM_LABEL: Record<ConfirmAnswer, string> = {
  none: '要件はない（別に作る必要な理由はない）',
  exists: '要件がある',
  unknown: '分からない',
}

/** 理由の候補（入力を補助するもの。AIの判断や推奨ではない。自由に書き足せる） */
export const REASONS: Record<DecisionStatus, string[]> = {
  adopt: ['作業時間を削減できる', 'ミスを減らせる', '手順を簡単にできる'],
  hold: ['関係者への確認が必要', '効果を検証したい', '実施条件が整っていない'],
  reject: ['業務上の要件がある', '効果が小さい', '別の方法で対応する'],
}

/** 理由の見出し（選んだ判断に合わせる） */
export const REASON_HEADING: Record<DecisionStatus, string> = { adopt: '採用する理由', hold: '保留する理由', reject: '採用しない理由' }

const NO_REASONS: Record<DecisionStatus, string> = { adopt: '', hold: '', reject: '' }

export const REASON_MAX = 100

export function initialDecisions(cands: Candidate[]): Decisions {
  return Object.fromEntries(cands.map((c) => [c.candidate_id, { status: null, reasons: { ...NO_REASONS }, confirm: null }]))
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
  // 理由は判断ごとに持つので、判断を切り替えても消さない
  return { ...ds, [c.candidate_id]: { ...ds[c.candidate_id], status } }
}

/** 確認の問いに答える。「要件はない」以外に変えたら、採用は取り消して未判断に戻す（採用の条件を満たさなくなるため） */
export function answerConfirm(c: Candidate, ds: Decisions, answer: ConfirmAnswer): Decisions {
  const cur = ds[c.candidate_id]
  const status = cur.status === 'adopt' && answer !== 'none' ? null : cur.status
  return { ...ds, [c.candidate_id]: { ...cur, confirm: answer, status } }
}

/** 選んでいる判断の理由 */
export function reasonOf(d: Decision | undefined): string {
  return d?.status ? d.reasons[d.status] : ''
}

/** 選んでいる判断の理由を書き換える（判断を選んでいなければ何もしない） */
export function setReason(id: string, ds: Decisions, reason: string): Decisions {
  const d = ds[id]
  if (!d?.status) return ds
  return { ...ds, [id]: { ...d, reasons: { ...d.reasons, [d.status]: reason.slice(0, REASON_MAX) } } }
}

/**
 * 理由の候補を押したとき、入力欄をどうするか（単一選択）。
 * - 入力欄がその候補と同じ → 選択を解除する（候補の文のままなので、消しても利用者の文章は失われない）
 * - 入力欄が空、またはほかの候補の文のまま → 押した候補に置き換える
 * - 利用者が書き換えた文章がある → 勝手に上書きせず、置き換えてよいかを確かめる（confirm）
 */
export type PresetAction = { kind: 'set'; text: string } | { kind: 'confirm'; text: string }

export function pickPreset(current: string, preset: string, presets: string[]): PresetAction {
  if (current === preset) return { kind: 'set', text: '' }
  if (!current.trim() || presets.includes(current)) return { kind: 'set', text: preset }
  return { kind: 'confirm', text: preset }
}

/** サーバーへ送る形（選んだ判断の理由だけを送る） */
export function toPayload(ds: Decisions): Record<string, { status: DecisionStatus | null; confirm: ConfirmAnswer | null; reason: string }> {
  return Object.fromEntries(Object.entries(ds).map(([id, d]) => [id, { status: d.status, confirm: d.confirm, reason: reasonOf(d) }]))
}

/** 前の形（理由が1つ：reason）で保存した判断を、今の形に直す（STEPを戻ったときの復元で、前の判断を壊さない） */
export function normalizeDecisions(raw: Record<string, unknown>): Decisions {
  return Object.fromEntries(
    Object.entries(raw).map(([id, v]) => {
      const d = (v ?? {}) as Partial<Decision> & { reason?: string }
      const status = d.status ?? null
      const reasons = { ...NO_REASONS, ...(d.reasons ?? {}) }
      if (typeof d.reason === 'string' && d.reason && status) reasons[status] = d.reason.slice(0, REASON_MAX)
      return [id, { status, confirm: d.confirm ?? null, reasons }]
    }),
  )
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

/** まだ判断していない最初の候補（なければ null）。「次へ進む」の横で、どの候補が足りないかを具体的に示すために使う */
export function firstUndecided(cands: Candidate[], ds: Decisions): string | null {
  return cands.find((c) => !ds[c.candidate_id]?.status)?.candidate_id ?? null
}
