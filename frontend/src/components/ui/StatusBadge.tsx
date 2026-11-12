import { NODE_STATUS } from './nodeStatus'
import type { NodeStatus } from './nodeStatus'

/** ノード状態のバッジ（色・アイコン・文字）。定義は nodeStatus.ts にまとめている。 */
export function StatusBadge({ status, className = '' }: { status: NodeStatus; className?: string }) {
  const def = NODE_STATUS[status]
  const Icon = def.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-bold whitespace-nowrap ring-1 ring-inset ${def.badge} ${className}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {def.label}
    </span>
  )
}
