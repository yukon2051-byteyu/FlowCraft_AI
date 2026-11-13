import { CircleX, RotateCw, X } from 'lucide-react'
import type { ApiErrorBody } from '../../api/client'

/**
 * バックエンド共通形式のエラーを「何が起きたか・原因・直し方」の順で表示する。
 * 暗い面・明るい面のどちらに置いても読めるよう、自身は明るい下地を持つ。
 * onRetry を渡すと「もう一度試す」を出す（同じ操作をやり直す。ダミーの結果には切り替えない）。
 */
export function ErrorNotice({ error, title, onDismiss, onRetry }: { error: ApiErrorBody; title?: string; onDismiss?: () => void; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border-l-4 border-error bg-error-soft p-3.5 text-[0.9rem] text-ink">
      <div className="flex items-start gap-2">
        <CircleX className="mt-0.5 size-4.5 shrink-0 text-error-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-[0.82rem] font-bold text-error-ink/80">{title}</p>}
          <p className="font-bold text-error-ink">{error.message}</p>
          {error.cause && <p className="mt-1 text-ink/80">{error.cause}</p>}
          {error.how_to_fix && (
            <p className="mt-1.5">
              <span className="font-bold">対処方法：</span>
              {error.how_to_fix}
            </p>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.85rem] font-bold text-error-ink ring-1 ring-error/40 hover:bg-error-soft focus-visible:outline-2 focus-visible:outline-error"
            >
              <RotateCw className="size-3.5" aria-hidden />
              もう一度試す
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="閉じる"
            className="grid size-7 shrink-0 place-items-center rounded-md text-error-ink hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-error"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
