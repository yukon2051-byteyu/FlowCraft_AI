/**
 * TOPページの区画（#features・#demo など）へ移動する。移動先は区画の見出し（data-section-heading）で、
 * 固定ヘッダーのすぐ下に見出しが来る（見出しの scroll-mt で余白を決める）。区画の上端に合わせると、区画の内側の余白が余分に空くため。
 * - smooth：同じページの中での移動。動きを減らす設定では、滑らかにせず強調もしない
 * - instant：別の画面から /#demo などで来たとき（長い距離を数秒かけて動かさない）
 * キーボードで操作している人のために、移動先の見出しへフォーカスを移す（スクロールはしない）。
 */
export function scrollToSection(id: string, behavior: 'smooth' | 'instant' = 'smooth'): boolean {
  const section = document.getElementById(id)
  if (!section) return false
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const anchor = section.querySelector<HTMLElement>('[data-section-heading]') ?? section
  anchor.scrollIntoView({ behavior: behavior === 'instant' ? 'instant' : reduce ? 'auto' : 'smooth', block: 'start' })
  const heading = section.querySelector<HTMLElement>('h2')
  if (!heading) return true
  heading.tabIndex = -1
  heading.focus({ preventScroll: true })
  if (behavior === 'smooth' && !reduce) {
    heading.classList.remove('section-flash')
    void heading.offsetWidth // 続けて押したときも、もう一度強調する
    heading.classList.add('section-flash')
    window.setTimeout(() => heading.classList.remove('section-flash'), 1600)
  }
  return true
}

/**
 * 同じページの中の区画へのリンク（href が "#demo" や "/#demo"）か。そうなら区画の名前を返す。
 * 新しいタブで開く操作（Ctrl・Shift・中クリックなど）や、ほかの処理がすでに扱ったクリックは対象にしない。
 */
export function samePageSection(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return null
  const link = (e.target as Element | null)?.closest?.('a[href]')
  if (!link || (link as HTMLAnchorElement).target === '_blank') return null
  const href = link.getAttribute('href') ?? ''
  const m = /^\/?#([A-Za-z][\w-]*)$/.exec(href)
  return m ? m[1] : null
}
