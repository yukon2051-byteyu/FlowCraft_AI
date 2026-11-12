import { Circle, CircleCheck, CircleHelp, CircleX, Sparkles, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * ノードの「処理状態」（設計書 §5.1 / 仕様 9.3）。
 * 色・アイコン・文字の3つで示す。選択中かどうか（ミントの枠）とは別に表現する。
 *   未設定：グレー ／ AI提案・確認待ち：ミント（AIの確認事項） ／ 確定：グリーン ／ 警告：アンバー ／ エラー：レッド
 */
export type NodeStatus = 'unset' | 'ai_proposed' | 'pending' | 'confirmed' | 'warning' | 'error'

type StatusDef = {
  label: string
  icon: LucideIcon
  /** 明るい面に置くバッジ */
  badge: string
  /** ノードカード左端の色帯 */
  stripe: string
}

export const NODE_STATUS: Record<NodeStatus, StatusDef> = {
  unset: { label: '未設定', icon: Circle, badge: 'bg-ink/6 text-muted ring-ink/15', stripe: 'bg-idle' },
  ai_proposed: { label: 'AI提案', icon: Sparkles, badge: 'bg-mint-soft text-forest ring-forest/25', stripe: 'bg-mint' },
  pending: { label: '確認待ち', icon: CircleHelp, badge: 'bg-mint-soft text-forest ring-forest/40', stripe: 'bg-mint' },
  confirmed: { label: '確定', icon: CircleCheck, badge: 'bg-success-soft text-success-ink ring-success/30', stripe: 'bg-success' },
  warning: { label: '警告', icon: TriangleAlert, badge: 'bg-warning-soft text-warning-ink ring-warning/40', stripe: 'bg-warning' },
  error: { label: 'エラー', icon: CircleX, badge: 'bg-error-soft text-error-ink ring-error/40', stripe: 'bg-error' },
}
