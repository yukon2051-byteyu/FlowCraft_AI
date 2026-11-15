import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../ui/Button'

type Nav = { label: string; onClick: () => void }

/** デモ専用の段階の枠（中身はスクロール、下に「前へ」「次へ」） */
export function DemoFrame({ children, back, next }: { children: ReactNode; back?: Nav; next: Nav }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-5 px-8 py-7">{children}</div>
      </div>
      <nav aria-label="デモの段階の移動" className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        {back && (
          <Button variant="outlineDark" size="sm" onClick={back.onClick}>
            <ArrowLeft className="size-4" aria-hidden />
            {back.label}
          </Button>
        )}
        <div className="ml-auto">
          <Button variant="primary" onClick={next.onClick}>
            {next.label}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </nav>
    </>
  )
}
