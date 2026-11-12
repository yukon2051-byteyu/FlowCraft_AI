import { FileOutput, FolderOpen, Save } from 'lucide-react'
import { Link } from 'react-router'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'

type Props = {
  flowName: string
  unsaved: boolean
  canExport: boolean
}

/** ワークスペース用のヘッダー。TOPと同じネイビー・ロゴで統一する。 */
export function AppHeader({ flowName, unsaved, canExport }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 bg-navy px-5 text-white">
      <Link to="/" aria-label="トップへ戻る" className="rounded-md focus-visible:outline-2 focus-visible:outline-white">
        <Logo />
      </Link>
      <span className="h-6 w-px bg-white/20" aria-hidden />
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[1rem] font-bold">{flowName}</span>
        {unsaved && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[0.78rem] text-white/85">
            <span className="size-2 rounded-full bg-[#F0B44C]" aria-hidden />
            未保存の変更があります
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outlineDark" size="sm" disabled title="フローの読込は開発中です">
          <FolderOpen className="size-4" aria-hidden />
          フローを開く
        </Button>
        <Button variant="outlineDark" size="sm" disabled title="フローの保存は開発中です">
          <Save className="size-4" aria-hidden />
          フローを保存
        </Button>
        <Button variant="primary" size="sm" disabled={!canExport} title="実行が完了すると出力できます">
          <FileOutput className="size-4" aria-hidden />
          Excel出力
        </Button>
      </div>
    </header>
  )
}
