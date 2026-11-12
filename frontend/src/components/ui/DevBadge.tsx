import { Clock3 } from 'lucide-react'
import { isAvailable } from '../../content/featureStatus'
import type { FeatureKey } from '../../content/featureStatus'

/** 開発中の機能に付ける表示。提供済みの機能では何も表示しない。 */
export function DevBadge({ feature, tone = 'dark', className = '' }: { feature: FeatureKey; tone?: 'dark' | 'light'; className?: string }) {
  if (isAvailable(feature)) return null
  const style =
    tone === 'dark' ? 'bg-warning/12 text-warning ring-warning/35' : 'bg-warning-soft text-warning-ink ring-warning/40'
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-bold whitespace-nowrap ring-1 ${style} ${className}`}>
      <Clock3 className="size-3" aria-hidden />
      開発中
    </span>
  )
}
