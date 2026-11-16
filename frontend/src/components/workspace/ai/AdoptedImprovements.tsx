import { ChevronDown, Hand, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { AdoptedImprovement } from '../../../flow/aiPlan'
import { BuildLine } from './ProposalList'

/*
 * 手順の画面（STEP 2）の上部に出す、AI業務改善診断で採用した改善の一覧（A-5）。
 * 手順を作りながら、どの改善をどの部品で反映するか・何が人の作業として残るかを確かめられるようにする。
 * 処理ステップは自動では作らない（ここは確かめるための表示だけ）。
 */
export function AdoptedImprovements({ items }: { items: AdoptedImprovement[] }) {
  const [open, setOpen] = useState(true)
  const withCriteria = items.some((a) => a.build.criteria_labels.length > 0)
  return (
    <section className="rounded-xl bg-panel px-4 py-2.5 ring-1 ring-edge" aria-label="採用した改善">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-[0.92rem] font-bold text-white">
        <Sparkles className="size-4 text-mint" aria-hidden />
        AIの診断で採用した改善（{items.length}件）
        <ChevronDown className={`ml-auto size-4 text-subtle transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <>
          <ul className="mt-2 space-y-1.5 text-[0.86rem] text-white/85">
            {items.map((a) => (
              <li key={a.proposal_id} className="grid grid-cols-[minmax(0,16rem)_1fr] gap-3">
                <span className="font-bold">{a.title}</span>
                {a.build.fit === 'no' ? (
                  <span className="flex items-center gap-1 text-subtle">
                    <Hand className="size-3.5 shrink-0" aria-hidden />
                    人が行う作業：{a.build.note || '手順の変更はありません'}
                  </span>
                ) : (
                  <BuildLine b={a.build} />
                )}
              </li>
            ))}
          </ul>
          {withCriteria && <p className="mt-2 text-[0.8rem] text-subtle">品質ルールは「② 何を満たせば完了？」で、「処理手順から基準を提案」を使って加えられます。</p>}
        </>
      )}
    </section>
  )
}
