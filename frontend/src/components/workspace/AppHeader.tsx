import { FileOutput, FolderOpen, History, Save } from 'lucide-react'
import { Link } from 'react-router'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'

type Props = {
  flowName: string
  /** 保存の状態（never：一度も保存していない／changed：保存した後に変更した） */
  saveState: 'none' | 'never' | 'changed'
  /** 離れるときに確認するか */
  confirmLeave: boolean
  canExport: boolean
  /** Excelに出力する（結果の画面で使える） */
  onExport?: () => void
  exporting?: boolean
  /** 出力の前に確認が必要なときの理由（総合判定が注意・未検証で、まだ確認していない） */
  exportBlocked?: string | null
  /** 出力・保存の画面（ここで出力するのが主要な操作）か */
  exportPrimary?: boolean
  /** 作業手順を保存する（処理ステップがあるときに使える） */
  onSave?: () => void
  canSave?: boolean
  /** 保存した作業手順を開く */
  onOpen?: () => void
  /** 実行の履歴（このブラウザ）を開く */
  onHistory?: () => void
}

const LEAVE_MESSAGE = '保存していない変更があります。このページを離れると、変更は失われます。離れますか？'

/** ワークスペース用のヘッダー。TOPと同じロゴ・ナビゲーション色で統一する。 */
export function AppHeader({ flowName, saveState, confirmLeave, canExport, onExport, exporting = false, exportBlocked = null, exportPrimary = false, onSave, canSave = false, onOpen, onHistory }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-nav px-5 text-white">
      <Link
        to="/"
        aria-label="トップへ戻る"
        // 未保存の変更があるときは、離れる前に確認する（ブラウザを閉じる・再読み込みは WorkspacePage の beforeunload で確認）
        onClick={(e) => {
          if (confirmLeave && !window.confirm(LEAVE_MESSAGE)) e.preventDefault()
        }}
        className="rounded-md focus-visible:outline-2 focus-visible:outline-mint">
        <Logo />
      </Link>
      <span className="h-6 w-px bg-edge" aria-hidden />
      <div className="flex min-w-0 items-center gap-3">
        {/* 長い作業名は省略して、右側のボタンを押し出さない（マウスを重ねると全文を表示） */}
        <span className="max-w-[24rem] truncate text-[1rem] font-bold" title={flowName}>
          {flowName}
        </span>
        {/* 保存の状態は短く出し、詳しい説明はマウスを重ねたときに出す */}
        {saveState === 'changed' && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-0.5 text-[0.78rem] whitespace-nowrap text-warning ring-1 ring-warning/30"
            title="前回保存した後に変更しています。このページを離れると、変更は失われます。「作業手順を保存」で保存すると、次回も同じ内容で使えます"
          >
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            未保存の変更あり
          </span>
        )}
        {saveState === 'never' && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.78rem] whitespace-nowrap text-subtle ring-1 ring-edge"
            title="今回だけの作業なら、保存せずにExcelへ出力して終われます。毎月使うなら「作業手順を保存」から保存できます"
          >
            未保存（保存は任意）
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button variant="ghostDark" size="sm" disabled={!onHistory} onClick={onHistory} title="このブラウザに保存した、実行の記録を見ます">
          <History className="size-4" aria-hidden />
          実行の履歴
        </Button>
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
        {/* 実行結果があるときだけ出す（押せないボタンを常に出して迷わせない）。
            画面の主要ボタンと競わないように、出力・保存の画面（exportPrimary）以外では控えめにする */}
        {canExport && (
        <Button
          variant={exportPrimary ? 'primary' : 'outlineDark'}
          size="sm"
          disabled={exporting || exportBlocked !== null}
          onClick={onExport}
          title={exportBlocked ?? (exportPrimary ? '実行結果をExcelファイルで保存します' : '出力・保存の画面へ進みます')}
        >
          <FileOutput className="size-4" aria-hidden />
          Excelに出力
        </Button>
        )}
      </div>
    </header>
  )
}
