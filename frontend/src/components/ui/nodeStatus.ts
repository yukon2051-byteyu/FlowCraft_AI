import { Circle, CircleCheck, CircleHelp, CircleX, Sparkles, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * ノード状態（設計書 §5.1 / 仕様 9.3）。
 * 色・アイコン・文字の3つで状態を示し、色の見分けが難しい人でも判別できるようにする。
 */
export type NodeStatus = 'unset' | 'ai_proposed' | 'pending' | 'confirmed' | 'warning' | 'error'

type StatusDef = { label: string; icon: LucideIcon; badge: string; ring: string }

export const NODE_STATUS: Record<NodeStatus, StatusDef> = {
  unset: { label: '未設定', icon: Circle, badge: 'bg-surface text-muted ring-line', ring: 'ring-line' },
  ai_proposed: {
    label: 'AI提案',
    icon: Sparkles,
    badge: 'bg-accent-soft text-accent ring-accent/30',
    ring: 'ring-accent/50',
  },
  pending: {
    label: '確認待ち',
    icon: CircleHelp,
    badge: 'bg-accent-soft text-accent ring-accent/30',
    ring: 'ring-accent/60',
  },
  confirmed: {
    label: '確定',
    icon: CircleCheck,
    badge: 'bg-success-soft text-success ring-success/30',
    ring: 'ring-success/40',
  },
  warning: {
    label: '警告',
    icon: TriangleAlert,
    badge: 'bg-warning-soft text-warning ring-warning/30',
    ring: 'ring-warning/60',
  },
  error: { label: 'エラー', icon: CircleX, badge: 'bg-error-soft text-error ring-error/30', ring: 'ring-error/60' },
}
