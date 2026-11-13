import { Monitor } from 'lucide-react'
import { Logo } from '../components/brand/Logo'

/** スマートフォンから開いたときの案内（PC専用化。アプリ本体の操作は提供しない） */
export default function PcOnlyNotice() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="max-w-sm text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Monitor className="mx-auto mt-8 size-10 text-mint" aria-hidden />
        <h1 className="mt-4 text-[1.3rem] font-bold text-white">FlowCraft AIはPC専用です</h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-subtle">
          FlowCraft AIは、Excel業務の作成・編集・実行を行うため、PCでの利用を推奨しています。Windows PCのChromeまたはEdgeからアクセスしてください。
        </p>
      </div>
    </main>
  )
}
