import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'

/*
 * 画面の右下に常に置く「ページの先頭に戻る」ボタン（TOPページ用）。
 * - 少しスクロールしたら表示する（先頭にいるときは押す意味がないため隠す）
 * - 押すと、瞬間的に切り替えずに滑らかにスクロールして戻る
 * - 「動きを減らす」を設定している利用者には、滑らかなスクロールを使わない
 */
const SHOW_AFTER_PX = 320

export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const toTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="ページの先頭に戻る"
      title="ページの先頭に戻る"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      // 少し内側（左上）に置き、大きく・ミントの縁取りと影で目立たせる（利用者の指示）
      className={`fixed right-8 bottom-8 z-40 grid size-14 place-items-center rounded-full bg-panel-hi text-mint shadow-[0_8px_24px_-6px_rgba(57,217,173,0.45)] ring-2 ring-mint/70 transition duration-200 hover:bg-mint hover:text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ArrowUp className="size-6" aria-hidden />
    </button>
  )
}
