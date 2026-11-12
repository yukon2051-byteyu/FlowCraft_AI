import { Check } from 'lucide-react'

/** 操作の段階（設計書 §3）。現在地と次の操作が常に分かるようにする。 */
const STEPS = ['データを読み込む', '作業を伝える', 'フローを確認する', '実行して検証する', '出力・保存する'] as const

/** current：現在のステップ番号（1始まり） */
export function Stepper({ current, hint }: { current: number; hint: string }) {
  return (
    <div className="flex h-13 shrink-0 items-center gap-5 border-b border-line bg-white px-5">
      <ol className="flex shrink-0 items-center gap-1" aria-label="操作の段階">
        {STEPS.map((label, i) => {
          const n = i + 1
          const state = n < current ? 'done' : n === current ? 'current' : 'todo'
          return (
            <li key={label} className="flex items-center gap-1.5" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={
                  'inline-flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[0.88rem] whitespace-nowrap ' +
                  (state === 'current' ? 'bg-accent-soft font-bold text-accent ring-1 ring-accent/30' : state === 'done' ? 'text-ink' : 'text-muted')
                }
              >
                <span
                  className={
                    'grid size-6 place-items-center rounded-full text-[0.78rem] font-bold ' +
                    (state === 'current' ? 'bg-accent text-white' : state === 'done' ? 'bg-success text-white' : 'bg-surface text-muted ring-1 ring-line')
                  }
                >
                  {state === 'done' ? <Check className="size-3.5" aria-label="完了" /> : n}
                </span>
                {label}
              </span>
              {n < STEPS.length && <span className="h-px w-3 bg-line xl:w-5" aria-hidden />}
            </li>
          )
        })}
      </ol>
      <p className="ml-auto min-w-0 truncate text-[0.88rem] text-muted" title={hint}>
        <span className="font-bold text-ink">次の操作：</span>
        {hint}
      </p>
    </div>
  )
}
