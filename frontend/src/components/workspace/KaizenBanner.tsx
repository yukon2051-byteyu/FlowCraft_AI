import { ArrowLeft, Lightbulb } from 'lucide-react'
import { Link } from 'react-router'

/** 業務改善デモで作った作業手順を開いているときの案内（作業手順の画面の上部） */
export function KaizenBanner() {
  return (
    <div role="note" aria-label="業務改善デモの案内" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-mint/35 bg-mint/8 px-6 py-2.5">
      <p className="flex items-center gap-1.5 font-bold text-mint">
        <Lightbulb className="size-4.5" aria-hidden />
        業務改善デモ：改善後の作業手順
      </p>
      <p className="min-w-0 flex-1 text-[0.88rem] text-white/85">
        採用した改善案から作った作業手順です。サンプルのExcel（架空の3部署・2026年10月分）を割り当て済みです。「作業手順全体を実行する」を押すと、通常の作業手順と同じように処理・品質の確認を行います。編集・保存もできます。
      </p>
      <Link
        to="/kaizen-demo?resume=1"
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.85rem] font-bold text-white/85 ring-1 ring-white/25 hover:bg-white/8"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        業務改善デモに戻る
      </Link>
    </div>
  )
}
