import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { selectIsDirty, useFlowStore } from '../../flow/store'
import { Button } from '../ui/Button'

/** デモ選択（TOPのデモ欄）。すべてのデモで、戻り先をここに統一する */
const DEMO_LIST_PATH = '/#demo'

/**
 * すべてのデモに共通の「デモ選択へ戻る」（画面下部の左端に置く。主要な操作より目立たせない枠線だけのボタン）。
 * 失われる変更があるときだけ確認する（dirty を渡さなければ、開いた作業手順を変えたかで判定する）。
 * 保存済みの作業手順や実行の履歴は消さない。onLeave：戻る直前の後片付け（そのデモの一時的な状態だけを消す）
 */
export function BackToDemos({ dirty, label = 'デモ選択へ戻る', onLeave, size = 'sm' }: { dirty?: boolean; label?: string; onLeave?: () => void; size?: 'sm' | 'md' }) {
  const navigate = useNavigate()
  const flowDirty = useFlowStore(selectIsDirty)
  const [asking, setAsking] = useState(false)
  const changed = dirty ?? flowDirty
  const leave = () => {
    setAsking(false)
    onLeave?.()
    navigate(DEMO_LIST_PATH)
  }
  return (
    <>
      <Button variant="outlineDark" size={size} onClick={() => (changed ? setAsking(true) : leave())} className="shrink-0">
        <ArrowLeft className="size-4" aria-hidden />
        {label}
      </Button>
      {asking && <ConfirmLeave onStay={() => setAsking(false)} onLeave={leave} />}
    </>
  )
}

function ConfirmLeave({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const titleId = useId()
  const descId = useId()
  const stayRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // 誤って戻らないよう、初めは「このまま続ける」を選んだ状態にする
    stayRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onStay()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStay])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onStay()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="light-panel w-full max-w-[460px] rounded-2xl p-6 shadow-2xl">
        <h2 id={titleId} className="text-[1.15rem] font-bold">
          デモ選択へ戻りますか？
        </h2>
        <p id={descId} className="mt-2 text-[0.92rem] text-ink/80">
          このデモで保存していない変更内容は失われます。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={stayRef}
            type="button"
            onClick={onStay}
            className="h-9 rounded-full bg-forest px-4 text-[0.9rem] font-bold text-white hover:bg-[#0f4f43] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            このまま続ける
          </button>
          <Button variant="secondary" size="sm" onClick={onLeave}>
            デモ選択へ戻る
          </Button>
        </div>
      </div>
    </div>
  )
}
