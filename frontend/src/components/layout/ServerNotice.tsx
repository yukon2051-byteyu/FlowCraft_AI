import { RotateCw, ServerCrash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { checkServer } from '../../api/serverVersion'
import type { ServerCheck } from '../../api/serverVersion'

/**
 * 画面とサーバーの版の食い違い・サーバーの停止を、起動時に一度だけ確かめて知らせる（全画面共通・上部の帯）。
 * 問題がなければ何も表示しない。結果を隠したり、ダミーの結果に切り替えたりはしない。
 */
export function ServerNotice() {
  const [check, setCheck] = useState<ServerCheck | null>(null)
  const run = useCallback(() => {
    void checkServer().then(setCheck)
  }, [])
  useEffect(run, [run])
  if (!check || check.state === 'ok') return null
  const old = check.state === 'old'
  return (
    <div role="alert" aria-label="サーバーの状態" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-warning/50 bg-warning-soft px-6 py-2.5 text-[0.9rem] text-ink">
      <ServerCrash className="size-5 shrink-0 text-warning-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-bold text-warning-ink">{old ? 'サーバーが古い版のまま動いています。' : 'サーバーに接続できません。'}</span>{' '}
        {old
          ? '画面が使う機能の一部（デモなど）が見つからず、「HTTP 404」になります。開発環境では、サーバーを止めて起動し直してください（README「使い方」）。'
          : `サーバーが起動していない可能性があります${check.status ? `（HTTP ${check.status}）` : ''}。サーバーを起動してから、もう一度確かめてください。`}
      </p>
      <button
        type="button"
        onClick={run}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.85rem] font-bold text-warning-ink ring-1 ring-warning/50 hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-warning"
      >
        <RotateCw className="size-3.5" aria-hidden />
        もう一度確かめる
      </button>
    </div>
  )
}
