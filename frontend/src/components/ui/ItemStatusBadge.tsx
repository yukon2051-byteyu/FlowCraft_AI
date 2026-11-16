import { ArrowRight, ChevronDown, ChevronUp, CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react'
import { ACTION_LABEL, CRITERION_STATUS_LABEL, STEP_STATUS_LABEL } from '../../flow/stepStatus'
import type { ItemStatus } from '../../flow/stepStatus'

/*
 * 処理ステップ・完了基準の「状態」と「操作ボタン」（2つの画面で同じ見た目・同じ言葉にする）。
 * 状態は flow/stepStatus.ts の deriveStatus で1か所で決める（カード・設定欄・画面下部で食い違わないように）。
 *   設定完了：控えめな緑 ／ 要確認：アンバー ／ 未設定：オレンジ ／ エラー：赤
 * 状態の表示はボタンの代わりにしない。操作はかならず文字付きのボタン（ItemActionButton）で示す。
 */
const STYLE: Record<ItemStatus, { icon: typeof CircleCheck; badge: string }> = {
  needs_setting: { icon: TriangleAlert, badge: 'bg-todo-soft text-todo-ink ring-todo/45' },
  error: { icon: CircleX, badge: 'bg-error-soft text-error-ink ring-error/45' },
  needs_review: { icon: CircleHelp, badge: 'bg-warning-soft text-warning-ink ring-warning/45' },
  ready: { icon: CircleCheck, badge: 'bg-success-soft/70 text-success-ink ring-success/20' },
}

export function ItemStatusBadge({ status, kind = 'step', className = '' }: { status: ItemStatus; kind?: 'step' | 'criterion'; className?: string }) {
  const s = STYLE[status]
  const label = (kind === 'step' ? STEP_STATUS_LABEL : CRITERION_STATUS_LABEL)[status]
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-bold whitespace-nowrap ring-1 ring-inset ${s.badge} ${className}`}
    >
      <s.icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}

/**
 * カード右端の操作ボタン。開いているときは「詳細を閉じる」。
 * 直す必要があるとき（未設定・要確認・エラー）は塗りのボタンにして、次に押す場所を一目で分かるようにする。
 */
export function ItemActionButton({ status, expanded, onClick, name }: { status: ItemStatus; expanded: boolean; onClick: () => void; name: string }) {
  const todo = status !== 'ready'
  const label = expanded ? '詳細を閉じる' : ACTION_LABEL[status]
  const Icon = expanded ? ChevronUp : todo ? ArrowRight : ChevronDown
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-expanded={expanded}
      aria-label={`${name}：${label}`}
      className={`inline-flex h-8 w-[7.6rem] shrink-0 items-center justify-center gap-1 rounded-lg text-[0.85rem] font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
        expanded
          ? 'text-muted ring-1 ring-line hover:bg-ink/6 hover:text-ink'
          : todo
            ? 'bg-ink text-white hover:bg-ink/85'
            : 'text-forest ring-1 ring-forest/35 hover:bg-mint-soft'
      }`}
    >
      {label}
      <Icon className="size-4" aria-hidden />
    </button>
  )
}
