import { Check } from 'lucide-react'

/** 業務改善デモの5つのSTEP。done＝通過済み、current＝表示中、todo＝これから、soon＝まだ使えない（準備中） */
export type KaizenStepState = 'done' | 'current' | 'todo' | 'soon'

const KAIZEN_STEPS = ['現在の作業を確認', '改善候補を発見', '改善する作業を判断', '改善後の手順を作成', '改善前後を比較'] as const

export function KaizenProgress({ states }: { states: KaizenStepState[] }) {
  return (
    <ol aria-label="デモの進み具合" className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {KAIZEN_STEPS.map((label, i) => {
        const s = states[i]
        return (
          <li key={label} className="flex items-center gap-1" aria-current={s === 'current' ? 'step' : undefined}>
            <span
              className={
                'inline-flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[0.86rem] whitespace-nowrap ' +
                (s === 'current' ? 'bg-mint/12 font-bold text-mint ring-1 ring-mint/35' : s === 'done' ? 'text-white/85' : 'text-subtle/70')
              }
            >
              <span
                className={
                  'grid size-6 place-items-center rounded-full text-[0.78rem] font-bold ' +
                  (s === 'current' ? 'bg-mint text-on-mint' : s === 'done' ? 'bg-success text-white' : 'bg-panel text-subtle ring-1 ring-edge')
                }
              >
                {s === 'done' ? <Check className="size-3.5" aria-label="完了" /> : i + 1}
              </span>
              <span>
                <span className="sr-only">STEP {i + 1}：</span>
                {label}
              </span>
              {s === 'soon' && <span className="rounded-full px-1.5 text-[0.72rem] text-subtle ring-1 ring-edge">準備中</span>}
            </span>
            {i < KAIZEN_STEPS.length - 1 && <span className={`h-px w-3 ${s === 'done' ? 'bg-success/60' : 'bg-edge'}`} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
