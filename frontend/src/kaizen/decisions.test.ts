import { describe, expect, it } from 'vitest'
import type { Candidate } from '../api/kaizen'
import { adoptBlocker, answerConfirm, counts, decide, initialDecisions, problems, setReason, REASON_MAX } from './decisions'

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  candidate_id: id,
  rule_id: 'KD-x',
  direction: 'automate',
  direction_label: '自動化',
  title: id,
  detail: '',
  target_steps: [],
  evidence: [],
  effect: '',
  checks: [],
  confirm_question: null,
  depends_on: [],
  unsupported_steps: [],
  column_diffs: [],
  ...over,
})

const A = cand('A', { direction: 'eliminate', confirm_question: '要件がありますか？' })
const B = cand('B', { direction: 'simplify', depends_on: ['C'] })
const C = cand('C', { direction: 'standardize' })
const D = cand('D')
const ALL = [A, B, C, D]

describe('改善候補への判断', () => {
  it('初めはすべて未判断で、次へ進めない', () => {
    const ds = initialDecisions(ALL)
    expect(counts(ALL, ds)).toEqual({ adopt: 0, hold: 0, reject: 0, none: 4 })
    expect(problems(ALL, ds)).toEqual(['まだ判断していない候補があります（候補A・B・C・D）'])
  })

  it('廃止は、確認の問いに「要件はない」と答えるまで採用できない', () => {
    let ds = initialDecisions(ALL)
    expect(adoptBlocker(A, ds)).toContain('要件はない')
    expect(decide(A, ds, 'adopt')).toBe(ds) // 採用にならない
    ds = answerConfirm(A, ds, 'unknown')
    expect(decide(A, ds, 'adopt').A.status).toBeNull()
    ds = answerConfirm(A, ds, 'none')
    ds = decide(A, ds, 'adopt')
    expect(ds.A.status).toBe('adopt')
    // 後から「要件がある」に変えたら、採用は取り消して未判断に戻す
    ds = answerConfirm(A, ds, 'exists')
    expect(ds.A).toMatchObject({ status: null, confirm: 'exists' })
  })

  it('採用しない・保留は、確認なしでも選べる', () => {
    const ds = decide(A, initialDecisions(ALL), 'reject')
    expect(ds.A.status).toBe('reject')
    expect(decide(A, ds, 'hold').A.status).toBe('hold')
  })

  it('簡素化は、前提の標準化を採用したときだけ採用できる', () => {
    let ds = initialDecisions(ALL)
    expect(adoptBlocker(B, ds)).toBe('前提の候補Cを採用すると選べます')
    expect(decide(B, ds, 'adopt').B.status).toBeNull()
    ds = decide(C, ds, 'adopt')
    ds = decide(B, ds, 'adopt')
    expect(ds.B.status).toBe('adopt')
  })

  it('前提を後から外しても判断は書き換えず、矛盾として知らせて進めない', () => {
    let ds = initialDecisions(ALL)
    ds = decide(C, ds, 'adopt')
    ds = decide(B, ds, 'adopt')
    ds = decide(A, ds, 'reject')
    ds = decide(D, ds, 'adopt')
    expect(problems(ALL, ds)).toEqual([])
    ds = decide(C, ds, 'reject')
    expect(ds.B.status).toBe('adopt')
    expect(problems(ALL, ds)).toEqual(['候補B：前提の候補Cを採用すると選べます（判断を見直してください）'])
  })

  it('理由は判断ごと。判断を変えると前の理由は消える。長さには上限', () => {
    let ds = decide(D, initialDecisions(ALL), 'reject')
    ds = setReason('D', ds, '効果が小さい')
    expect(decide(D, ds, 'reject').D.reason).toBe('効果が小さい')
    expect(decide(D, ds, 'hold').D.reason).toBe('')
    expect(setReason('D', ds, 'あ'.repeat(300)).D.reason).toHaveLength(REASON_MAX)
  })
})
