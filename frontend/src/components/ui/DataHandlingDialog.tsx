import { ShieldCheck, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { HANDLING_DETAILS } from '../../content/dataHandling'

/**
 * 「データの取り扱いを確認」の画面（データを読み込む画面から開く）。文章は src/content/dataHandling.ts の1か所だけに書く。
 * 毎回の同意や確認は求めない（読むだけ。操作の妨げにしない）。Esc・背景のクリック・閉じるボタンで閉じる。
 */
export function DataHandlingDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="light-panel flex max-h-[calc(100vh-3rem)] w-full max-w-[680px] flex-col rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-[1.2rem] font-bold">
            <ShieldCheck className="size-5 text-forest" aria-hidden />
            データの取り扱い
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-muted hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {HANDLING_DETAILS.map((d) => (
            <section key={d.title} aria-label={d.title}>
              <h3 className="text-[0.95rem] font-bold text-ink">{d.title}</h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.9rem] leading-relaxed text-ink/80 marker:text-forest/60">
                {d.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
