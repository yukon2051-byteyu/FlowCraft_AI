import { ArrowRight, CircleCheck, CircleX, Lightbulb, MinusCircle } from 'lucide-react'
import type { DemoStory } from '../../../api/demos'
import type { CriterionResult } from '../../../api/flows'
import { useFlowStore } from '../../../flow/store'
import { refLabel } from './refs'

const STATUS: Record<string, { label: string; cls: string; icon: typeof CircleCheck }> = {
  passed: { label: '満たした', cls: 'text-success-ink', icon: CircleCheck },
  failed: { label: '満たさなかった', cls: 'text-error-ink', icon: CircleX },
}

/**
 * デモ STEP 5 の「改善内容の振り返り」：改善前 → 改善後と、それを確かめた品質ルールの今回の実際の判定。
 * 判定は今回の実行結果（criteria）から出す（固定の文言で「成功」と見せない）。
 */
export function DemoReview({ story, criteria }: { story: DemoStory; criteria: CriterionResult[] }) {
  const flow = useFlowStore((s) => s.flow)
  const defs = flow.completion_criteria?.items ?? []
  const result = new Map(criteria.map((c) => [c.criterion_id, c]))
  return (
    <section className="light-panel rounded-2xl p-5" aria-label="改善内容の振り返り">
      <h2 className="flex items-center gap-2 font-bold">
        <Lightbulb className="size-5 text-kaizen-ink" aria-hidden />
        改善内容の振り返り
        <span className="text-[0.82rem] font-normal text-muted">（{story.business_name}。事前に用意した改善例）</span>
      </h2>
      <ul className="mt-3 space-y-2.5">
        {story.improvements.map((x) => {
          const checks = x.refs.filter((r) => result.has(r))
          return (
            <li key={x.before} className="rounded-xl bg-paper px-4 py-3 ring-1 ring-line">
              <p className="flex flex-wrap items-center gap-x-2 text-[0.92rem]">
                <span className="text-muted">{x.before}</span>
                <ArrowRight className="size-4 text-forest" aria-hidden />
                <span className="font-bold">{x.after}</span>
              </p>
              {checks.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[0.85rem]">
                  {checks.map((r) => {
                    const c = result.get(r)!
                    const s = STATUS[c.status] ?? { label: '確認できなかった', cls: 'text-warning-ink', icon: MinusCircle }
                    return (
                      <li key={r} className={`flex items-center gap-1.5 ${s.cls}`}>
                        <s.icon className="size-4 shrink-0" aria-hidden />
                        今回の実行：{refLabel(r, flow.nodes, defs)}を{s.label}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
