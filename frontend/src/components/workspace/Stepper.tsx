import { Check } from 'lucide-react'
import type { StepView } from '../../flow/journey'

/**
 * 作業の「段階」（設計書 §3）。現在地と次の操作が常に分かるようにする。
 * 作業手順の中の「処理ステップ」と混同しないよう、画面では「段階」と呼ぶ（用語集 T1）。
 * 表示の順番と完了の状態は src/flow/journey.ts で決める（開始方法によって順番が変わる。段階のIDは共通）。
 * steps が空（開始画面）のときは、段階を出さずに案内だけ出す。
 */
export function Stepper({ steps, hint }: { steps: StepView[]; hint: string }) {
  return (
    <div className="flex h-13 shrink-0 items-center gap-5 border-b border-edge bg-canvas px-5">
      <ol className="flex shrink-0 items-center gap-1" aria-label="作業の段階">
        {steps.map((step, i) => {
          const n = i + 1
          const state = step.state
          return (
            <li
              key={step.id}
              className="flex items-center gap-1"
              aria-current={state === 'current' ? 'step' : undefined}
              title={step.reason ? `段階${n}：${step.label}（${step.reason}）` : `段階${n}：${step.label}`}
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
                {step.label}
                {state === 'skipped' && (
                  <span className="ml-1 rounded-full px-1.5 text-[0.72rem] text-subtle no-underline ring-1 ring-edge">
                    {step.id === 'describe' && step.reason?.includes('不要') ? '不要' : '省略'}
                    <span className="sr-only">：{step.reason}</span>
                  </span>
                )}
              </span>
              {n < steps.length && <span className={`h-px w-3 xl:w-5 ${state === 'done' ? 'bg-success/60' : 'bg-edge'}`} aria-hidden />}
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
