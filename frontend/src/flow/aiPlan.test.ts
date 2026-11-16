import { describe, expect, it } from 'vitest'
import type { Proposal } from '../api/ai'
import { makePlan } from './aiPlan'

const build = (fit: Proposal['build']['fit'], template: [string, string] | null = null): Proposal['build'] => ({
  fit,
  template_id: template?.[0] ?? null,
  template_title: template?.[1] ?? null,
  step_types: [],
  step_labels: [],
  criteria_kinds: [],
  criteria_labels: [],
  note: '',
  adjusted: false,
})
const P = (id: string, b: Proposal['build']): Proposal => ({
  proposal_id: id,
  direction: 'automate',
  title: `提案${id}`,
  target: '',
  problem: '',
  change: `${id}にする`,
  evidence: [],
  effect: '',
  estimate: null,
  risks: [],
  recommendation: '',
  priority: 1,
  build: b,
})

describe('採用した改善の反映の計画', () => {
  const proposals = [
    P('p1', build('no')),
    P('p2', build('yes', ['monthly_sales', '月次売上集計'])),
    P('p3', build('partial', ['product_match', '商品マスタ照合'])),
    P('p4', build('yes', ['product_match', '商品マスタ照合'])),
    P('p5', build('yes', ['inventory', '在庫差異検出'])),
  ]

  it('採用したものだけを集め、反映できるもの・人が行うものに分ける（一部できるものは両方に入る）', () => {
    const plan = makePlan(proposals, {
      p1: { status: 'adopt', reason: ' 監査は不要と確認 ' },
      p2: { status: 'adopt', reason: '' },
      p3: { status: 'adopt', reason: '' },
      p5: { status: 'reject', reason: '在庫は対象外' },
    })
    expect(plan.adopted.map((a) => a.proposal_id)).toEqual(['p1', 'p2', 'p3'])
    expect(plan.adopted[0].reason).toBe('監査は不要と確認')
    expect(plan.buildable.map((a) => a.proposal_id)).toEqual(['p2', 'p3'])
    expect(plan.manual.map((a) => a.proposal_id)).toEqual(['p1', 'p3'])
  })

  it('もとにするひな形は、反映できる提案でいちばん多く挙げられたもの（同数なら重要な提案のもの）', () => {
    const adoptAll = Object.fromEntries(proposals.map((p) => [p.proposal_id, { status: 'adopt' as const, reason: '' }]))
    expect(makePlan(proposals, adoptAll).template).toEqual({ id: 'product_match', title: '商品マスタ照合' })
    expect(makePlan(proposals, { p2: { status: 'adopt', reason: '' }, p5: { status: 'adopt', reason: '' } }).template).toEqual({ id: 'monthly_sales', title: '月次売上集計' })
  })

  it('採用がない・反映できるものがなければ、ひな形は選ばない', () => {
    expect(makePlan(proposals, {}).template).toBeNull()
    expect(makePlan(proposals, { p1: { status: 'adopt', reason: '' } })).toMatchObject({ buildable: [], template: null })
  })
})
