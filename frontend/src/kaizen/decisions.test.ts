import { describe, expect, it } from 'vitest'
import type { Candidate } from '../api/kaizen'
import { adoptBlocker, answerConfirm, counts, decide, firstUndecided, initialDecisions, normalizeDecisions, pickPreset, problems, reasonOf, REASON_MAX, REASONS, setReason, toPayload } from './decisions'

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

  it('理由は判断ごとに持つ。判断を切り替えても消えず、戻すと元の理由が出る。長さには上限', () => {
    let ds = decide(D, initialDecisions(ALL), 'reject')
    ds = setReason('D', ds, '効果が小さい')
    ds = decide(D, ds, 'hold')
    expect(reasonOf(ds.D)).toBe('')
    ds = setReason('D', ds, '関係者への確認が必要')
    ds = decide(D, ds, 'reject')
    expect(reasonOf(ds.D)).toBe('効果が小さい')
    expect(ds.D.reasons.hold).toBe('関係者への確認が必要')
    expect(reasonOf(setReason('D', ds, 'あ'.repeat(300)).D)).toHaveLength(REASON_MAX)
    // 判断を選ぶ前は、理由を書き換えない
    expect(setReason('A', initialDecisions(ALL), 'x').A.reasons.adopt).toBe('')
  })

  it('サーバーへは、選んだ判断の理由だけを送る', () => {
    let ds = decide(D, initialDecisions(ALL), 'reject')
    ds = setReason('D', ds, '効果が小さい')
    ds = decide(D, ds, 'adopt')
    ds = setReason('D', ds, 'ミスを減らせる')
    expect(toPayload(ds).D).toEqual({ status: 'adopt', confirm: null, reason: 'ミスを減らせる' })
    expect(toPayload(ds).A).toEqual({ status: null, confirm: null, reason: '' })
  })
})

describe('まだ判断していない候補', () => {
  it('確認の問いに答えただけでは判断したことにならない。最初の未判断の候補を返す', () => {
    let ds = initialDecisions(ALL)
    ds = answerConfirm(A, ds, 'none')
    expect(firstUndecided(ALL, ds)).toBe('A')
    for (const c of ALL) ds = decide(c, decide(C, ds, 'adopt'), 'adopt')
    expect(firstUndecided(ALL, ds)).toBeNull()
  })
})

describe('理由の候補を押したときの動き', () => {
  const presets = REASONS.reject
  it('空・候補の文のままなら置き換え、同じ候補をもう一度押すと解除する', () => {
    expect(pickPreset('', '効果が小さい', presets)).toEqual({ kind: 'set', text: '効果が小さい' })
    expect(pickPreset('業務上の要件がある', '効果が小さい', presets)).toEqual({ kind: 'set', text: '効果が小さい' })
    expect(pickPreset('効果が小さい', '効果が小さい', presets)).toEqual({ kind: 'set', text: '' })
  })
  it('利用者が書き換えた文章は、確かめずに上書きしない', () => {
    expect(pickPreset('効果が小さい。来期に再検討', '別の方法で対応する', presets)).toEqual({ kind: 'confirm', text: '別の方法で対応する' })
  })
  it('判断ごとに候補が変わる', () => {
    expect(REASONS.adopt).toEqual(['作業時間を削減できる', 'ミスを減らせる', '手順を簡単にできる'])
    expect(REASONS.hold).toEqual(['関係者への確認が必要', '効果を検証したい', '実施条件が整っていない'])
  })
})

describe('前の形で保存した判断の復元', () => {
  it('理由が1つ（reason）の形を、判断ごとの理由に直す', () => {
    const ds = normalizeDecisions({ A: { status: 'reject', reason: '監査で必要', confirm: 'exists' }, B: { status: null, reason: '', confirm: null } })
    expect(ds.A).toEqual({ status: 'reject', confirm: 'exists', reasons: { adopt: '', hold: '', reject: '監査で必要' } })
    expect(reasonOf(ds.B)).toBe('')
  })
})
