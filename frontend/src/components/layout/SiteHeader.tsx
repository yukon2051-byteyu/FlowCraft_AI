import { Link } from 'react-router'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'

const NAV = [
  { href: '/#features', label: '特長' },
  { href: '/#usecases', label: '利用例' },
  { href: '/#demo', label: 'デモ' },
  { href: '/#try', label: 'はじめ方' },
]

/** TOPなど紹介ページ用のヘッダー（ネイビー・画面上部に固定）。 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-8">
        <Link to="/" aria-label="FlowCraft AI トップへ" className="rounded-md focus-visible:outline-2 focus-visible:outline-white">
          <Logo />
        </Link>
        <nav aria-label="ページ内メニュー" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-2 text-[0.95rem] text-white/75 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto">
          <Button to="/workspace" variant="outlineDark" size="sm">
            <span className="sm:hidden">試してみる</span>
            <span className="hidden sm:inline">自分のExcelで試す</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
