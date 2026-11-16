import type { Proposal } from '../api/ai'
import type { DiagnosisRecord } from './types'

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

/** 利用者のパソコンの時刻で、時差つきの日時にする（例：2026-11-17T08:30:00+09:00）。先頭10文字が、その地域の日付になる */
export function localIso(d: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
}

/**
 * 改善の記録（作業手順ファイル 1.5）の1回分を作る（A-6）。
 * - 回答は、答えた質問だけ（空欄は残さない）
 * - 判断は、判断した提案だけ（未判断は残さない）。理由は空でもよい
 */
export function makeRecord(
  qa: { question: string; answer: string }[],
  proposals: Proposal[],
  decisions: Record<string, Decision>,
  now: Date = new Date(),
): DiagnosisRecord {
  return {
    diagnosed_at: localIso(now),
    answers: qa
      .map((a) => ({ question: a.question.trim().slice(0, 300), answer: a.answer.trim().slice(0, 1000) }))
      .filter((a) => a.question && a.answer)
      .slice(0, 10),
    decisions: proposals.flatMap((p) => {
      const d = decisions[p.proposal_id]
      if (!d?.status) return []
      return [{ direction: p.direction, title: p.title, change: p.change, decision: d.status, reason: d.reason.trim().slice(0, 300), fit: p.build.fit }]
    }).slice(0, 10),
  }
}
