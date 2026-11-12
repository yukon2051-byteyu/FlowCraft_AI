import { Link } from 'react-router'
import { Logo } from '../brand/Logo'

export function SiteFooter() {
  return (
    <footer className="border-t border-edge bg-nav text-subtle">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Logo />
          <p className="text-[0.9rem]">Excel定型業務を、正確に・分かりやすく・何度でも。</p>
        </div>
        <div className="flex flex-col gap-2 text-[0.85rem] md:items-end">
          <nav aria-label="フッターメニュー" className="flex flex-wrap gap-x-5 gap-y-1">
            <a href="/#features" className="hover:text-white">できること</a>
            <a href="/#demo" className="hover:text-white">デモ</a>
            <a href="/#trust" className="hover:text-white">データの取り扱い</a>
            <Link to="/dev/diagnostics" className="hover:text-white">システム状態（開発者向け）</Link>
          </nav>
          <p className="text-subtle/70">© 2026 FlowCraft AI ・ 転職用ポートフォリオとして開発中の製品です</p>
        </div>
      </div>
    </footer>
  )
}
