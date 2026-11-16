import { Eye, EyeOff, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { authenticateAi } from '../../api/ai'
import { ApiError } from '../../api/client'
import { Button } from '../ui/Button'

/**
 * AI使用パスワードの入力（docs/ai-auth-design.md §5）。AIを使う操作のときだけ開く。
 * 認証に成功したら onAuthed を呼ぶ（呼び出し側が、やろうとした操作を自動でもう一度行う）。
 * パスワードは画面に残さない（送ったら入力欄を空にする）。送信中は二重に送らない。
 */
export function AiAuthDialog({ onAuthed, onCancel }: { onAuthed: () => void; onCancel: () => void }) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = async () => {
    if (busy || !password) return
    setBusy(true)
    setError(null)
    try {
      await authenticateAi(password)
      setPassword('')
      onAuthed()
    } catch (e) {
      setPassword('')
      setError(e instanceof ApiError ? [e.body.message, e.body.how_to_fix].filter(Boolean).join(' ') : '認証できませんでした。もう一度お試しください。')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="light-panel w-full max-w-[460px] rounded-2xl p-6 shadow-2xl"
      >
        <h2 id={titleId} className="flex items-center gap-2 text-[1.15rem] font-bold">
          <Sparkles className="size-5 text-forest" aria-hidden />
          AI機能を利用する
        </h2>
        <p className="mt-2 text-[0.92rem] text-ink/80">この機能ではAIを使用します。利用するにはAIパスワードを入力してください。</p>
        <label className="mt-4 block">
          <span className="text-[0.85rem] font-bold">AI利用パスワード</span>
          <span className="mt-1 flex items-center gap-1">
            <input
              ref={inputRef}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              aria-label="AI利用パスワード"
              aria-invalid={error ? true : undefined}
              className={`h-10 min-w-0 flex-1 rounded-lg bg-paper px-3 focus:outline-none ${error ? 'ring-2 ring-error' : 'ring-1 ring-line focus:ring-2 focus:ring-forest'}`}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'パスワードを隠す' : 'パスワードを表示する'}
              className="grid size-10 place-items-center rounded-lg text-muted hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest"
            >
              {show ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
            </button>
          </span>
        </label>
        {error && (
          <p role="alert" className="mt-2 text-[0.85rem] font-bold text-error-ink">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" variant="dark" size="sm" disabled={busy || !password}>
            {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            認証して続ける
          </Button>
        </div>
      </form>
    </div>
  )
}
