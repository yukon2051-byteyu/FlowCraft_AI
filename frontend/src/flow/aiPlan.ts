import type { Proposal } from '../api/ai'

/*
 * AI業務改善診断の、採用した改善の反映の計画（A-5）。画面から切り離した関数（単体テストで確かめる）。
 * - 採用した提案だけを集める（保留・採用しないは入れない）
 * - 手順に反映できるもの（処理エンジンの部品がある）と、反映できないもの（人が行う作業・業務の判断）に分ける
 * - もとにするひな形：反映できる提案で、いちばん多く挙げられたひな形（同数なら重要な提案のもの）
 * 処理ステップは自動で組み立てない（利用者が手順の画面で確かめながら作る）。
 */

export type Decision = { status: 'adopt' | 'hold' | 'reject' | null; reason: string }

export type AdoptedImprovement = Pick<Proposal, 'proposal_id' | 'direction' | 'title' | 'change' | 'build'> & { reason: string }

export type ImprovementPlan = {
  adopted: AdoptedImprovement[]
  buildable: AdoptedImprovement[]
  manual: AdoptedImprovement[]
  template: { id: string; title: string } | null
}

export function makePlan(proposals: Proposal[], decisions: Record<string, Decision>): ImprovementPlan {
  const adopted: AdoptedImprovement[] = proposals
    .filter((p) => decisions[p.proposal_id]?.status === 'adopt')
    .map((p) => ({ proposal_id: p.proposal_id, direction: p.direction, title: p.title, change: p.change, build: p.build, reason: decisions[p.proposal_id]?.reason.trim() ?? '' }))
  const buildable = adopted.filter((a) => a.build.fit !== 'no')
  const manual = adopted.filter((a) => a.build.fit !== 'yes')
  const votes = new Map<string, { title: string; count: number; first: number }>()
  buildable.forEach((a, i) => {
    const { template_id: id, template_title: title } = a.build
    if (!id || !title) return
    const v = votes.get(id)
    votes.set(id, v ? { ...v, count: v.count + 1 } : { title, count: 1, first: i })
  })
  const best = [...votes.entries()].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)[0]
  return { adopted, buildable, manual, template: best ? { id: best[0], title: best[1].title } : null }
}
