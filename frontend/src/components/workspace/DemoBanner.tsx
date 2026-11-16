import { ChevronDown, CircleCheck, Repeat, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import type { DemoStart } from '../../api/demos'

/*
 * デモを体験している間、画面の上に出す帯。正常終了はミント、品質異常はコーラル（TOP と同じ色の意味）。
 * 常に出すのは「どのデモを、どちらのデータで実行しているか」と1行の説明、切り替えだけ（結果より目立たせない）。
 * 何を見ればよいかの手引きは「このデモの確認ポイントを見る」に折りたたむ（初めは閉じる）。結果の値はここには書かない。
 */
export function DemoBanner({ demo }: { demo: DemoStart }) {
  const ng = demo.pattern === 'ng'
  const Icon = ng ? TriangleAlert : CircleCheck
  const other = ng ? 'ok' : 'ng'
  return (
    <div role="note" aria-label="デモの案内" className={`shrink-0 border-b px-6 py-2 ${ng ? 'border-kaizen/40 bg-kaizen/10' : 'border-mint/35 bg-mint/8'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className={`flex items-center gap-1.5 font-bold ${ng ? 'text-kaizen-text' : 'text-mint'}`}>
          <Icon className="size-4.5" aria-hidden />
          {demo.title}｜{ng ? '品質異常のデータで実行' : '正常データで実行'}
          {/* 直したデータで再実行したときなど、どのデータの結果かを添える */}
          {demo.pattern_label !== '正常終了' && demo.pattern_label !== '品質異常' && <span className="font-normal">（{demo.pattern_label}）</span>}
        </p>
        <p className="min-w-0 flex-1 truncate text-[0.88rem] text-white/85" title={demo.description}>
          {demo.description}
        </p>
        <Link
          to={`/build?demo=${demo.demo_id}&pattern=${other}`}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.85rem] font-bold text-white/85 ring-1 ring-white/25 hover:bg-white/8"
        >
          <Repeat className="size-3.5" aria-hidden />
          {ng ? '正常終了のデモに切り替える' : '品質異常のデモに切り替える'}
        </Link>
      </div>
      <details className="group mt-1">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[0.82rem] font-bold text-white/75 hover:text-white focus-visible:outline-2 focus-visible:outline-mint [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
          このデモの確認ポイントを見る
        </summary>
        <div className="mt-1 max-w-4xl space-y-1 pb-1 pl-4.5 text-[0.85rem] text-white/80">
          <p>{demo.guide}</p>
          {ng && demo.fix_note && <p>品質異常のときは、正式な出力を止め、調査用の確認結果だけを出力できます。結果の画面では「直したデータで再実行する」も試せます（{demo.fix_note}）</p>}
        </div>
      </details>
    </div>
  )
}
