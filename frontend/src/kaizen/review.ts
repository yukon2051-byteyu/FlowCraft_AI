/*
 * 自分の業務の見直し（Phase K-1）：業務の情報と、今の作業の工程の表。画面から切り離した関数（単体テストで確かめる）。
 * サーバーの入力の形（backend/app/kaizen/models.py の WorkReview）と同じ決まりで、送る前に入力の誤りを示す。
 * 規則が見るのは、作業の種類・書き写し元・くり返しの回数・必ず残す工程などの事実だけ（工程名の文字では判定しない）。
 */

import { nextId } from '../flow/ops'

export type WorkAction = 'receive' | 'inspect' | 'aggregate' | 'copy' | 'transcribe' | 'reconcile' | 'share'

/** 作業の種類（業務の言葉で）。処理エンジンで自動化できるかは、改善候補の画面で示す */
export const ACTION_LABEL: Record<WorkAction, string> = {
  receive: 'ファイルを受け取る',
  inspect: '中身を確認する',
  aggregate: '集計する',
  copy: 'Excelに書き写す',
  transcribe: '資料（スライド・文書）に書き写す',
  reconcile: '合計・件数を照合する',
  share: '送付・共有する',
}
export const ACTION_ORDER = Object.keys(ACTION_LABEL) as WorkAction[]

export type ReviewStepDraft = {
  step_id: string
  name: string
  action: WorkAction
  mode: 'manual' | 'auto'
  /** 1回の所要時間（分）。任意。空なら '' */
  minutes: string
  /** 書き写し元（前の工程の step_id）。なければ '' */
  transcribes_from: string
  /** 書き写し先の成果物の名前 */
  deliverable: string
  /** 何部署分（何回）くり返しているか */
  repeat_count: number
  must_keep: boolean
}

export type WorkReviewDraft = {
  purpose: string
  frequency: string
  users: string
  /** 1行に1つ */
  pain_points: string
  /** 1行に1つ */
  must_keep: string
  steps: ReviewStepDraft[]
}

export const MAX_STEPS = 30

export function newStep(existing: ReviewStepDraft[]): ReviewStepDraft {
  return {
    step_id: nextId('s', existing.map((s) => s.step_id)),
    name: '',
    action: 'receive',
    mode: 'manual',
    minutes: '',
    transcribes_from: '',
    deliverable: '',
    repeat_count: 1,
    must_keep: false,
  }
}

export function newReview(purpose = ''): WorkReviewDraft {
  return { purpose, frequency: '', users: '', pain_points: '', must_keep: '', steps: [newStep([])] }
}

/** 工程を並べ替える。書き写し元が後ろの工程になった行は、入力の誤りとして示す（黙って消さない） */
export function moveStep(steps: ReviewStepDraft[], from: number, to: number): ReviewStepDraft[] {
  if (to < 0 || to >= steps.length || from === to) return steps
  const next = [...steps]
  const [s] = next.splice(from, 1)
  next.splice(to, 0, s)
  return next
}

/** 工程を消す。その工程を書き写し元にしていた行は、書き写し元を空にする（存在しない工程を指さない） */
export function removeStep(steps: ReviewStepDraft[], stepId: string): ReviewStepDraft[] {
  return steps.filter((s) => s.step_id !== stepId).map((s) => (s.transcribes_from === stepId ? { ...s, transcribes_from: '' } : s))
}

/** 工程の番号（画面の表示は「工程1」から） */
export const stepNo = (steps: ReviewStepDraft[], stepId: string) => steps.findIndex((s) => s.step_id === stepId) + 1

export type ReviewProblem = { stepId: string | null; message: string }

/** 入力の誤り（サーバーの WorkReview と同じ決まり）。空なら判定に送れる */
export function reviewProblems(r: WorkReviewDraft): ReviewProblem[] {
  const out: ReviewProblem[] = []
  if (!r.steps.length) out.push({ stepId: null, message: '工程を1つ以上入力してください' })
  if (r.steps.length > MAX_STEPS) out.push({ stepId: null, message: `工程は${MAX_STEPS}個までです` })
  r.steps.forEach((s, i) => {
    const no = `工程${i + 1}`
    if (!s.name.trim()) out.push({ stepId: s.step_id, message: `${no}：工程名を入力してください` })
    else if (s.name.trim().length > 200) out.push({ stepId: s.step_id, message: `${no}：工程名は200文字以内にしてください` })
    const m = s.minutes.trim()
    if (m && !(/^\d+$/.test(m) && Number(m) <= 1000)) out.push({ stepId: s.step_id, message: `${no}：時間は0〜1000の整数（分）で入力してください` })
    if (!(Number.isInteger(s.repeat_count) && s.repeat_count >= 1 && s.repeat_count <= 50)) out.push({ stepId: s.step_id, message: `${no}：くり返しの回数は1〜50で入力してください` })
    if (s.transcribes_from) {
      const at = r.steps.findIndex((x) => x.step_id === s.transcribes_from)
      if (at < 0 || at >= i) out.push({ stepId: s.step_id, message: `${no}：書き写し元は、それより前の工程を選んでください` })
    }
    if (s.deliverable.trim().length > 200) out.push({ stepId: s.step_id, message: `${no}：書き写し先は200文字以内にしてください` })
  })
  return out
}

const lines = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

/** サーバーへ送る形（空の項目は送らない。サーバーの初期値と同じ扱いにする） */
export function toPayload(r: WorkReviewDraft) {
  return {
    context: {
      purpose: r.purpose.trim(),
      frequency: r.frequency.trim(),
      users: r.users.trim(),
      pain_points: lines(r.pain_points).slice(0, 10),
      must_keep: lines(r.must_keep).slice(0, 10),
    },
    steps: r.steps.map((s) => ({
      step_id: s.step_id,
      name: s.name.trim(),
      action: s.action,
      mode: s.mode,
      minutes: s.minutes.trim() ? Number(s.minutes) : null,
      transcribes_from: s.transcribes_from || null,
      deliverable: s.deliverable.trim() || null,
      repeat_count: s.repeat_count,
      must_keep: s.must_keep,
    })),
  }
}

/** 所要時間の合計（すべての工程に時間が入っているときだけ。想定値） */
export function totalMinutes(r: WorkReviewDraft): number | null {
  if (!r.steps.length || r.steps.some((s) => !s.minutes.trim())) return null
  return r.steps.reduce((sum, s) => sum + Number(s.minutes) * s.repeat_count, 0)
}
