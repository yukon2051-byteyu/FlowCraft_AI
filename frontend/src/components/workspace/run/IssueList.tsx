import { CircleX, Info, TriangleAlert } from 'lucide-react'
import type { EngineIssue } from '../../../api/flows'

const STYLE = {
  error: { icon: CircleX, label: 'エラー', box: 'bg-error-soft ring-error/30', ink: 'text-error-ink' },
  warning: { icon: TriangleAlert, label: '確認が必要', box: 'bg-warning-soft ring-warning/35', ink: 'text-warning-ink' },
  info: { icon: Info, label: 'お知らせ', box: 'bg-paper ring-line', ink: 'text-muted' },
} as const

/**
 * 処理のお知らせ・警告・エラー。重い順に並べ、原因と直し方があれば添える。
 * 色だけでなく、アイコンと文字（エラー／確認が必要／お知らせ）で区別する。
 */
export function IssueList({ issues, label = '処理のお知らせ' }: { issues: EngineIssue[]; label?: string }) {
  if (issues.length === 0) return null
  const order = { error: 0, warning: 1, info: 2 } as Record<string, number>
  const sorted = [...issues].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {sorted.map((i, n) => {
        const s = STYLE[(i.severity as keyof typeof STYLE) in STYLE ? (i.severity as keyof typeof STYLE) : 'info']
        const Icon = s.icon
        return (
          <li key={`${i.code}-${n}`} className={`rounded-lg px-3 py-2 text-[0.85rem] ring-1 ${s.box}`}>
            <p className="flex gap-1.5 text-ink">
              <Icon className={`mt-0.5 size-4 shrink-0 ${s.ink}`} aria-hidden />
              <span>
                <span className={`mr-1 font-bold ${s.ink}`}>{s.label}：</span>
                {i.message}
              </span>
            </p>
            {i.cause && <p className="mt-1 pl-5.5 text-[0.82rem] text-ink/80">原因：{i.cause}</p>}
            {i.how_to_fix && <p className="mt-0.5 pl-5.5 text-[0.82rem] text-ink/80">直し方：{i.how_to_fix}</p>}
          </li>
        )
      })}
    </ul>
  )
}
