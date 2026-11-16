import { describe, expect, it } from 'vitest'
import { moveStep, newReview, newStep, removeStep, reviewProblems, toPayload, totalMinutes } from './review'
import type { ReviewStepDraft, WorkReviewDraft } from './review'

// 架空の業務：支店の経費Excelを受け取り、集計して、2つの資料へ書き写す
const step = (id: string, patch: Partial<ReviewStepDraft> = {}): ReviewStepDraft => ({ ...newStep([]), step_id: id, name: `工程${id}`, ...patch })
const draft = (steps: ReviewStepDraft[]): WorkReviewDraft => ({ ...newReview('経費をまとめる'), steps })
const S = () => [
  step('s1', { action: 'receive', repeat_count: 4, minutes: '10' }),
  step('s2', { action: 'aggregate', minutes: '30' }),
  step('s3', { action: 'copy', transcribes_from: 's2', deliverable: '経費一覧表', minutes: '15' }),
  step('s4', { action: 'transcribe', transcribes_from: 's2', deliverable: '役員会報告資料', minutes: '20' }),
]

describe('今の工程の表', () => {
  it('新しい工程は、使っていない識別を持つ（s1, s2 …）', () => {
    expect(newStep([step('s1'), step('s3')]).step_id).toBe('s2')
    expect(newReview('目的').steps).toHaveLength(1)
  })

  it('並べ替えで書き写し元が後ろになった行は、黙って消さずに入力の誤りとして示す', () => {
    const moved = moveStep(S(), 2, 0) // 工程3（s2 を書き写す）を先頭へ
    expect(moved.map((s) => s.step_id)).toEqual(['s3', 's1', 's2', 's4'])
    expect(moved[0].transcribes_from).toBe('s2')
    expect(reviewProblems(draft(moved))).toEqual([{ stepId: 's3', message: '工程1：書き写し元は、それより前の工程を選んでください' }])
    expect(moveStep(S(), 0, -1)).toEqual(S()) // 範囲の外へは動かさない
  })

  it('工程を消すと、その工程を書き写し元にしていた行は書き写し元が空になる', () => {
    const r = removeStep(S(), 's2')
    expect(r.map((s) => [s.step_id, s.transcribes_from])).toEqual([
      ['s1', ''],
      ['s3', ''],
      ['s4', ''],
    ])
  })

  it('入力の誤り：工程名なし・時間の形・工程0件。問題がなければ空', () => {
    expect(reviewProblems(draft(S()))).toEqual([])
    expect(reviewProblems(draft([step('s1', { name: ' ' }), step('s2', { minutes: '1.5' })])).map((p) => p.message)).toEqual([
      '工程1：工程名を入力してください',
      '工程2：時間は0〜1000の整数（分）で入力してください',
    ])
    expect(reviewProblems(draft([]))[0].message).toBe('工程を1つ以上入力してください')
  })

  it('サーバーへ送る形：空の項目は送らず、1行ずつの入力は一覧にする', () => {
    const p = toPayload({ ...draft(S()), pain_points: '書き写しが多い\n\n確認に時間がかかる ', must_keep: '' })
    expect(p.context.pain_points).toEqual(['書き写しが多い', '確認に時間がかかる'])
    expect(p.context.must_keep).toEqual([])
    expect(p.steps[0]).toMatchObject({ minutes: 10, transcribes_from: null, deliverable: null, repeat_count: 4 })
    expect(p.steps[2]).toMatchObject({ transcribes_from: 's2', deliverable: '経費一覧表' })
  })

  it('所要時間の合計は、すべての工程に時間があるときだけ（くり返しの回数を掛ける。想定値）', () => {
    expect(totalMinutes(draft(S()))).toBe(10 * 4 + 30 + 15 + 20)
    expect(totalMinutes(draft([...S(), step('s5')]))).toBeNull()
  })
})
