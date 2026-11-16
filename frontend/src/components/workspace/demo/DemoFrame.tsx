import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { BackToDemos } from '../../demo/BackToDemos'
import { Button } from '../../ui/Button'

type Nav = { label: string; onClick: () => void }

/**
 * デモ専用の段階の枠（中身はスクロール）。画面下部：
 *   左端「デモ選択へ戻る」（すべてのデモで共通）｜区切り｜「前へ：…」（同じデモの前の段階） … 右端に主要な操作「次へ：…」
 * 「デモ選択へ戻る」と「前へ」を区切りで分け、どちらへ戻るのかを混同しないようにする
 */
export function DemoFrame({ children, back, next }: { children: ReactNode; back?: Nav; next: Nav }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-5 px-8 py-7">{children}</div>
      </div>
      {/* 操作は中身と同じ幅の中に並べる（画面の左右の端に寄せない）。3つのボタンの高さをそろえる */}
      <nav aria-label="デモの段階の移動" className="shrink-0 border-t border-edge bg-nav py-3">
        <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-8">
        <BackToDemos size="md" />
        {back && (
          <>
            <span className="h-6 w-px bg-edge" aria-hidden />
            <Button variant="ghostDark" onClick={back.onClick}>
              <ArrowLeft className="size-4" aria-hidden />
              {back.label}
            </Button>
          </>
        )}
        <div className="ml-auto">
          <Button variant="primary" onClick={next.onClick}>
            {next.label}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
        </div>
      </nav>
    </>
  )
}
