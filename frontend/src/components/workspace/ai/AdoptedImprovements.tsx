import { ChevronDown, Hand, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { AdoptedImprovement } from '../../../flow/aiPlan'

/*
 * AI業務改善診断で採用した改善を、「今回の手順に取り入れる改善」として示す（A-5・レビュー指摘3）。
 * ファイルの読み込み・列の設定（compact：短く）と、手順の画面の上部に出す。
 * - 採用したものだけ（保留・採用しないは含めない。makePlan で決まる）
 * - 手順に反映するものは「これから設定」する処理・品質ルールとして示す（設定したかどうかは、この一覧では判定しない。「設定済み」とは書かない）
 * - 人の判断や作業が含まれるものは「人が行うこと」として分けて示す
 * 処理ステップは自動では作らない（ここは確かめるための表示だけ）。
 */
export function AdoptedImprovements({ items, compact = false }: { items: AdoptedImprovement[]; compact?: boolean }) {
  const [open, setOpen] = useState(!compact)
  const withCriteria = items.some((a) => a.build.criteria_labels.length > 0)
  return (
    <section className="rounded-xl bg-panel px-4 py-2.5 ring-1 ring-edge" aria-label="今回の手順に取り入れる改善">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-[0.92rem] font-bold text-white">
        <Sparkles className="size-4 text-mint" aria-hidden />
        今回の手順に取り入れる改善（{items.length}件）
        {!open && <span className="min-w-0 truncate font-normal text-subtle">：{items.map((a) => a.title).join('／')}</span>}
        <ChevronDown className={`ml-auto size-4 shrink-0 text-subtle transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <>
          <ul className="mt-2 space-y-2 text-[0.86rem] text-white/85">
            {items.map((a) => (
              <Item key={a.proposal_id} a={a} />
            ))}
          </ul>
          {withCriteria && <p className="mt-2 text-[0.8rem] text-subtle">品質ルールは、手順の画面の「② 何を満たせば完了？」で加えます（「処理手順から基準を提案」も使えます）。</p>}
        </>
      )}
    </section>
  )
}

function Item({ a }: { a: AdoptedImprovement }) {
  const b = a.build
  const parts = [
    b.template_title && `ひな形「${b.template_title}」`,
    b.step_labels.length > 0 && `処理${b.step_labels.map((s) => `「${s}」`).join('')}`,
    b.criteria_labels.length > 0 && `品質ルール${b.criteria_labels.map((s) => `「${s}」`).join('')}`,
  ].filter(Boolean)
  // 人が行うこと：手順に反映できない提案、または一部だけ反映できる提案の残り
  const human = b.fit !== 'yes' ? b.note || '手順の変更はありません（業務の進め方の見直しです）' : null
  return (
    <li className="grid grid-cols-[minmax(0,15rem)_1fr] gap-3" aria-label={`取り入れる改善：${a.title}`}>
      <span className="font-bold text-white">{a.title}</span>
      <span className="space-y-0.5">
        {b.fit !== 'no' && parts.length > 0 && (
          <span className="flex items-start gap-1">
            <Wrench className="mt-0.5 size-3.5 shrink-0 text-mint" aria-hidden />
            <span>
              <span className="font-bold text-mint">これから設定：</span>
              {parts.join('・')}
            </span>
          </span>
        )}
        {human && (
          <span className="flex items-start gap-1 text-subtle">
            <Hand className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-bold text-white/80">人が行うこと：</span>
              {human}
            </span>
          </span>
        )}
      </span>
    </li>
  )
}
