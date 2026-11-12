import { Check } from 'lucide-react'

/**
 * 作業の「段階」（設計書 §3）。現在地と次の操作が常に分かるようにする。
 * 作業手順の中の「処理ステップ」と混同しないよう、画面では「段階」と呼ぶ（用語集 T1）。
 */
const STEPS = ['データを読み込む', '作業を伝える', '作業手順を確認する', '作業を実行する', '出力・保存する'] as const

/**
 * current：現在の段階の番号（1始まり）
 * skipped：今回は通らない段階（例：AIの機能が開発中のため「作業を伝える」を省略）
 */
export function Stepper({ current, hint, skipped = [] }: { current: number; hint: string; skipped?: { step: number; reason: string }[] }) {
  return (
    <div className="flex h-13 shrink-0 items-center gap-5 border-b border-edge bg-canvas px-5">
      <ol className="flex shrink-0 items-center gap-1" aria-label="作業の段階">
        {STEPS.map((label, i) => {
          const n = i + 1
          const skip = skipped.find((s) => s.step === n)
          const state = skip ? 'skipped' : n < current ? 'done' : n === current ? 'current' : 'todo'
          return (
            <li
              key={label}
              className="flex items-center gap-1"
              aria-current={state === 'current' ? 'step' : undefined}
              title={skip ? `段階${n}：${label}（${skip.reason}）` : `段階${n}：${label}`}
            >
              <span
                className={
                  'inline-flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[0.88rem] whitespace-nowrap ' +
                  (state === 'current'
                    ? 'bg-mint/12 font-bold text-mint ring-1 ring-mint/35'
                    : state === 'done'
                      ? 'text-white/85'
                      : state === 'skipped'
                        ? 'text-subtle/60'
                        : 'text-subtle/70')
                }
              >
                <span
                  className={
                    'grid size-6 place-items-center rounded-full text-[0.78rem] font-bold ' +
                    (state === 'current'
                      ? 'bg-mint text-on-mint'
                      : state === 'done'
                        ? 'bg-success text-white'
                        : 'bg-panel text-subtle ring-1 ring-edge')
                  }
                >
                  {state === 'done' ? <Check className="size-3.5" aria-label="完了" /> : n}
                </span>
                {label}
                {skip && (
                  <span className="ml-1 rounded-full px-1.5 text-[0.72rem] text-subtle no-underline ring-1 ring-edge">
                    省略<span className="sr-only">：{skip.reason}</span>
                  </span>
                )}
              </span>
              {n < STEPS.length && <span className={`h-px w-3 xl:w-5 ${n < current ? 'bg-success/60' : 'bg-edge'}`} aria-hidden />}
            </li>
          )
        })}
      </ol>
      <p className="ml-auto min-w-0 truncate text-[0.88rem] text-subtle" title={hint}>
        <span className="font-bold text-white">次の操作：</span>
        {hint}
      </p>
    </div>
  )
}
