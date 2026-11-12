import { CircleHelp } from 'lucide-react'
import { useId, useRef, useState } from 'react'

const WIDTH = 256
const GAP = 6

/**
 * 用語の短い説明（ツールチップ）。マウスを重ねるか、キーボードで選ぶと表示される。
 * 読まなくても操作は進められるよう、補足に限って使う（説明で作業領域を圧迫しない）。
 *
 * スクロールする領域の中に置いても切れないよう、画面全体を基準に位置を計算して表示する。
 * 画面の下の方では上向きに表示する。
 */
export function HelpTip({ text, label = 'この言葉の説明', tone = 'dark' }: { text: string; label?: string; tone?: 'dark' | 'light' }) {
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8)
    const below = r.bottom + GAP + 120 < window.innerHeight
    setPos(below ? { left, top: r.bottom + GAP } : { left, bottom: window.innerHeight - r.top + GAP })
  }
  const hide = () => setPos(null)

  return (
    <span className="inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label={`${label}の説明`}
        aria-describedby={pos ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        className={`grid size-5 cursor-help place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-mint ${tone === 'dark' ? 'text-subtle hover:text-white' : 'text-muted hover:text-ink'}`}
      >
        <CircleHelp className="size-3.5" aria-hidden />
      </span>
      {pos && (
        <span
          id={id}
          role="tooltip"
          style={{ position: 'fixed', width: WIDTH, ...pos }}
          className="pointer-events-none z-[100] rounded-lg bg-ink px-3 py-2 text-[0.82rem] leading-relaxed font-normal tracking-normal text-white shadow-xl ring-1 ring-white/15"
        >
          {text}
        </span>
      )}
    </span>
  )
}
