import { LoaderCircle, RotateCw, ServerCrash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { checkServer } from '../../api/serverVersion'
import type { ServerCheck } from '../../api/serverVersion'

/**
 * 画面とサーバーの版の食い違い・サーバーの停止を、起動時に確かめて知らせる（全画面共通・上部の帯）。
 * 問題がなければ何も表示しない。結果を隠したり、ダミーの結果に切り替えたりはしない。
 * 「もう一度確かめる」を押したことが分かるよう、確かめている間の表示と、確かめた時刻を出す
 * （2026-11-16：結果が同じだと、押せていないように見えたため）。
 */
export function ServerNotice() {
  const [check, setCheck] = useState<ServerCheck | null>(null)
  // 起動時は確かめている状態から始める
  const [checking, setChecking] = useState(true)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const fetchCheck = useCallback(() => {
    void checkServer()
      .then((c) => {
        setCheck(c)
        setCheckedAt(new Date())
      })
      .finally(() => setChecking(false))
  }, [])
  useEffect(fetchCheck, [fetchCheck])
  const run = () => {
    setChecking(true)
    fetchCheck()
  }
  if (!check || check.state === 'ok') return null
  const old = check.state === 'old'
  const time = checkedAt?.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div role="alert" aria-label="サーバーの状態" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-warning/50 bg-warning-soft px-6 py-2.5 text-[0.9rem] text-ink">
      <ServerCrash className="size-5 shrink-0 text-warning-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-bold text-warning-ink">{old ? 'サーバーが古い版のまま動いています。' : 'サーバーに接続できません。'}</span>{' '}
        {old
          ? '画面が使う機能の一部（デモなど）が見つからず、「HTTP 404」になります。開発環境では、サーバーを止めて起動し直してください。起動し直しても消えないときは、前のサーバーの残りのプロセスが動いています（README「困ったとき」）。'
          : `サーバーが起動していない可能性があります${check.status ? `（HTTP ${check.status}）` : ''}。サーバーを起動してから、もう一度確かめてください。`}
        {time && !checking && <span className="ml-1 text-[0.82rem] text-ink/70">（{time}に確認）</span>}
      </p>
      <button
        type="button"
        onClick={run}
        disabled={checking}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[0.85rem] font-bold text-warning-ink ring-1 ring-warning/50 hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-warning disabled:cursor-wait disabled:opacity-70"
      >
        {checking ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <RotateCw className="size-3.5" aria-hidden />}
        {checking ? '確かめています…' : 'もう一度確かめる'}
      </button>
    </div>
  )
}
