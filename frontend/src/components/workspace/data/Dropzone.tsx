import { FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Button } from '../../ui/Button'

type Props = {
  onFiles: (files: File[]) => void
  disabled?: boolean
  disabledReason?: string
  /** compact：ファイル読込後に一覧の下へ置く小さい版 */
  compact?: boolean
}

const ACCEPT = '.xlsx,.csv'

/** ファイルをドラッグ＆ドロップ、またはボタンから選ぶ場所。 */
export function Dropzone({ onFiles, disabled = false, disabledReason, compact = false }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const pick = () => input.current?.click()
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }
  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!disabled) setOver(true)
  }

  const frame =
    'rounded-xl border-2 border-dashed text-center transition-colors ' +
    (disabled
      ? 'border-line bg-surface'
      : over
        ? 'border-accent bg-accent-soft'
        : 'border-accent/35 bg-accent-soft/40 hover:border-accent/60')

  return (
    <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={() => setOver(false)} className={`${frame} ${compact ? 'px-4 py-5' : 'px-6 py-10'}`}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // 同じファイルを続けて選んでも反応するように
          if (files.length) onFiles(files)
        }}
      />
      {compact ? (
        <>
          <p className="text-[0.88rem] text-muted">ここにドラッグ＆ドロップ、または</p>
          <div className="mt-2 flex justify-center">
            <Button variant="secondary" size="sm" onClick={pick} disabled={disabled} title={disabledReason}>
              <Upload className="size-4" aria-hidden />
              ファイルを追加
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-white text-accent shadow-sm ring-1 ring-accent/20">
            <Upload className="size-6" aria-hidden />
          </span>
          <p className="mt-4 text-[1.1rem] font-bold text-navy">ここにファイルをドラッグ＆ドロップ</p>
          <p className="mt-1 text-muted">または</p>
          <div className="mt-3 flex justify-center">
            <Button variant="accent" onClick={pick} disabled={disabled} title={disabledReason}>
              <FileSpreadsheet className="size-4.5" aria-hidden />
              ファイルを選択
            </Button>
          </div>
        </>
      )}
      {disabled && disabledReason && <p className="mt-2 text-[0.85rem] font-bold text-warning">{disabledReason}</p>}
    </div>
  )
}
