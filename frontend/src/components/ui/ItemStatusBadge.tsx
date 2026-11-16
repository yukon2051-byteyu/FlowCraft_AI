import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react'
import { CRITERION_STATUS_LABEL, STEP_STATUS_LABEL } from '../../flow/stepStatus'
import type { ItemStatus } from '../../flow/stepStatus'

/*
 * 処理ステップ・完了基準の状態バッジ（色・アイコン・文字の3つで示す）。
 * 状態は flow/stepStatus.ts の deriveStatus で1か所で決める（カードと設定欄で食い違わないように）。
 */
const STYLE: Record<ItemStatus, { icon: typeof CircleCheck; cls: string }> = {
  needs_setting: { icon: TriangleAlert, cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  error: { icon: CircleX, cls: 'bg-error-soft text-error-ink ring-error/40' },
  needs_review: { icon: CircleHelp, cls: 'bg-ink/6 text-muted ring-ink/15' },
  ready: { icon: CircleCheck, cls: 'bg-success-soft text-success-ink ring-success/30' },
}

export function ItemStatusBadge({ status, kind = 'step', className = '' }: { status: ItemStatus; kind?: 'step' | 'criterion'; className?: string }) {
  const s = STYLE[status]
  const label = (kind === 'step' ? STEP_STATUS_LABEL : CRITERION_STATUS_LABEL)[status]
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-bold whitespace-nowrap ring-1 ring-inset ${s.cls} ${className}`}
    >
      <s.icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}
