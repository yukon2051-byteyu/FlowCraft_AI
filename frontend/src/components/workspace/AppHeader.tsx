import { FileOutput, FolderOpen, Save } from 'lucide-react'
import { Link } from 'react-router'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'

type Props = {
  flowName: string
  unsaved: boolean
  canExport: boolean
  /** Excelに出力する（結果の画面で使える） */
  onExport?: () => void
  exporting?: boolean
  /** 作業手順を保存する（処理ステップがあるときに使える） */
  onSave?: () => void
  canSave?: boolean
  /** 保存した作業手順を開く */
  onOpen?: () => void
}

const LEAVE_MESSAGE = '保存していない変更があります。このページを離れると、変更は失われます。離れますか？'

/** ワークスペース用のヘッダー。TOPと同じロゴ・ナビゲーション色で統一する。 */
export function AppHeader({ flowName, unsaved, canExport, onExport, exporting = false, onSave, canSave = false, onOpen }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-nav px-5 text-white">
      <Link
        to="/"
        aria-label="トップへ戻る"
        // 未保存の変更があるときは、離れる前に確認する（ブラウザを閉じる・再読み込みは WorkspacePage の beforeunload で確認）
        onClick={(e) => {
          if (unsaved && !window.confirm(LEAVE_MESSAGE)) e.preventDefault()
        }}
        className="rounded-md focus-visible:outline-2 focus-visible:outline-mint">
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
        <Button variant="ghostDark" size="sm" disabled={!onOpen} onClick={onOpen} title="保存した作業手順を、ブラウザの一覧またはファイルから開きます">
          <FolderOpen className="size-4" aria-hidden />
          作業手順を開く
        </Button>
        <Button
          variant="outlineDark"
          size="sm"
          disabled={!canSave}
          onClick={onSave}
          title={canSave ? '作業手順を、このブラウザの一覧とファイルに保存します' : '使う列を決めて作業手順を作ると、保存できます'}
        >
          <Save className="size-4" aria-hidden />
          作業手順を保存
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!canExport || exporting}
          onClick={onExport}
          title={canExport ? '実行結果をExcelファイルで保存します' : '作業手順全体を実行すると、結果の画面からExcelに出力できます'}
        >
          <FileOutput className="size-4" aria-hidden />
          Excelに出力
        </Button>
      </div>
    </header>
  )
}
