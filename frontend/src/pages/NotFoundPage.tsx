import { SiteHeader } from '../components/layout/SiteHeader'
import { Button } from '../components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-[0.9rem] font-bold text-mint">404</p>
        <h1 className="mt-2 text-[1.6rem] font-bold text-white">ページが見つかりません</h1>
        <p className="mt-3 text-subtle">URLが間違っているか、ページが移動した可能性があります。</p>
        <div className="mt-6 flex justify-center">
          <Button to="/" variant="primary">
            トップへ戻る
          </Button>
        </div>
      </main>
    </div>
  )
}
