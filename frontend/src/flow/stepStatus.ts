/*
 * 処理ステップ・完了基準の状態（「手順を確認する」「何を満たせば完了？」の画面で共通に使う）。
 * 状態は、利用者が押した記録（confirmation_status）だけで決めず、実際の設定の不足と検証の結果から決める。
 * 2026-11-16：カードは「確認済み」なのに、下では「設定が必要」と出る矛盾があったため、1つの状態にまとめた。
 *
 * 優先の順番：要設定（必要な設定が足りない）→ エラー（作業手順の検証で問題）→ 要確認（利用者の確認がまだ）→ 設定完了
 */

export type ItemStatus = 'needs_setting' | 'error' | 'needs_review' | 'ready'

export const STEP_STATUS_LABEL: Record<ItemStatus, string> = {
  needs_setting: '要設定',
  error: 'エラー',
  needs_review: '要確認',
  ready: '設定完了',
}

/** 完了基準は「設定済み・未設定・要確認」と呼ぶ（指示書の言葉） */
export const CRITERION_STATUS_LABEL: Record<ItemStatus, string> = {
  needs_setting: '未設定',
  error: 'エラー',
  needs_review: '要確認',
  ready: '設定済み',
}

export function deriveStatus(settingProblems: string[], checkProblems: string[], confirmed: boolean): ItemStatus {
  if (settingProblems.length) return 'needs_setting'
  if (checkProblems.length) return 'error'
  if (!confirmed) return 'needs_review'
  return 'ready'
}

/** 状態ごとの件数（画面の上のまとめに使う） */
export function countStatus(list: ItemStatus[]): Record<ItemStatus, number> {
  const out: Record<ItemStatus, number> = { needs_setting: 0, error: 0, needs_review: 0, ready: 0 }
  for (const s of list) out[s] += 1
  return out
}

/** 直す必要がある最初の項目の位置（要設定・エラー・要確認。なければ -1）。from より後ろから探し、なければ先頭から */
export function nextToFix(list: ItemStatus[], from = -1): number {
  const bad = (s: ItemStatus) => s !== 'ready'
  for (let i = from + 1; i < list.length; i++) if (bad(list[i])) return i
  for (let i = 0; i <= Math.min(from, list.length - 1); i++) if (bad(list[i])) return i
  return -1
}

/** 状態ごとの操作の言葉（処理ステップ・完了基準で共通。状態の表示とは別にボタンで示す） */
export const ACTION_LABEL: Record<ItemStatus, string> = {
  ready: '詳細・編集',
  needs_setting: '設定する',
  needs_review: '内容を確認',
  error: '修正する',
}

/** カード左端の色帯（未設定・エラー・要確認のカードを見つけやすくする。設定完了は目立たせない） */
const STRIPE: Record<ItemStatus, string> = {
  needs_setting: 'border-l-todo',
  error: 'border-l-error',
  needs_review: 'border-l-warning',
  ready: 'border-l-transparent',
}
export const statusStripe = (s: ItemStatus) => `border-l-4 ${STRIPE[s]}`
