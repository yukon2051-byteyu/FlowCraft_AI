import { CircleCheck, Repeat, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import type { DemoStart } from '../../api/demos'

/*
 * デモを体験している間、画面の上に出す帯。正常終了はミント、品質異常はコーラル（TOP と同じ色の意味）。
 * 何を見ればよいかの手引きと、もう一方の体験への切り替え。結果の値はここには書かない（実際の実行結果を見てもらう）。
 */
export function DemoBanner({ demo }: { demo: DemoStart }) {
  const ng = demo.pattern === 'ng'
  const Icon = ng ? TriangleAlert : CircleCheck
  const other = ng ? 'ok' : 'ng'
  return (
    <div
      role="note"
      aria-label="デモの案内"
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-2.5 ${ng ? 'border-kaizen/40 bg-kaizen/10' : 'border-mint/35 bg-mint/8'}`}
    >
      <p className={`flex items-center gap-1.5 font-bold ${ng ? 'text-kaizen-text' : 'text-mint'}`}>
        <Icon className="size-4.5" aria-hidden />
        デモ：{demo.title}（{demo.pattern_label}）
      </p>
      <p className="min-w-0 flex-1 text-[0.88rem] text-white/85">
        {demo.description} {demo.guide}
      </p>
      <Link
        to={`/build?demo=${demo.demo_id}&pattern=${other}`}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.85rem] font-bold text-white/85 ring-1 ring-white/25 hover:bg-white/8"
      >
        <Repeat className="size-3.5" aria-hidden />
        {ng ? '正常終了のデモに切り替える' : '品質異常のデモに切り替える'}
      </Link>
    </div>
  )
}
