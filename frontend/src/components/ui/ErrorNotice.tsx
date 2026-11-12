import { CircleX, X } from 'lucide-react'
import type { ApiErrorBody } from '../../api/client'

/**
 * バックエンド共通形式のエラーを「何が起きたか・原因・直し方」の順で表示する。
 * 暗い面・明るい面のどちらに置いても読めるよう、自身は明るい下地を持つ。
 */
export function ErrorNotice({ error, title, onDismiss }: { error: ApiErrorBody; title?: string; onDismiss?: () => void }) {
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
