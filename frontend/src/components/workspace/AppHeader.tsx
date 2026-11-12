import { FileOutput, FolderOpen, Save } from 'lucide-react'
import { Link } from 'react-router'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'

type Props = {
  flowName: string
  unsaved: boolean
  canExport: boolean
}

/** ワークスペース用のヘッダー。TOPと同じロゴ・ナビゲーション色で統一する。 */
export function AppHeader({ flowName, unsaved, canExport }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-nav px-5 text-white">
      <Link to="/" aria-label="トップへ戻る" className="rounded-md focus-visible:outline-2 focus-visible:outline-mint">
        <Logo />
      </Link>
      <span className="h-6 w-px bg-edge" aria-hidden />
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[1rem] font-bold">{flowName}</span>
        {unsaved && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-0.5 text-[0.78rem] text-warning ring-1 ring-warning/30">
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            未保存の変更があります
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghostDark" size="sm" disabled title="作業手順を開く機能は開発中です">
          <FolderOpen className="size-4" aria-hidden />
          作業手順を開く
        </Button>
        <Button variant="outlineDark" size="sm" disabled title="作業手順を保存する機能は開発中です">
          <Save className="size-4" aria-hidden />
          作業手順を保存
        </Button>
        <Button variant="primary" size="sm" disabled={!canExport} title="作業を実行すると、Excelに出力できます">
          <FileOutput className="size-4" aria-hidden />
          Excelに出力
        </Button>
      </div>
    </header>
  )
}
