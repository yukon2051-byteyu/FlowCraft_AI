import { Clock3, Eye, FileJson, FileSpreadsheet, Lock, Upload } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * ワークスペースの最初の画面（ステップ1：データを読み込む）。
 * アップロード処理はタスク1-8・1-9で実装する。それまでは操作できないことを明示する。
 */
export function UploadStart({ onShowSample }: { onShowSample: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-2xl bg-white p-7 shadow-sm ring-1 ring-line">
          <h1 className="text-[1.5rem] font-bold text-navy">データを読み込む</h1>
          <p className="mt-1.5 text-ink/80">処理に使うExcel・CSVファイルをすべて読み込んでください。複数ファイルの結合・統合にも対応しています。</p>

          <div className="mt-6 rounded-xl border-2 border-dashed border-accent/35 bg-accent-soft/50 px-6 py-10 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-white text-accent shadow-sm ring-1 ring-accent/20">
              <Upload className="size-6" aria-hidden />
            </span>
            <p className="mt-4 text-[1.1rem] font-bold text-navy">ここにファイルをドラッグ＆ドロップ</p>
            <p className="mt-1 text-muted">または</p>
            <div className="mt-3 flex justify-center">
              <Button variant="accent" disabled title="ファイル読込機能は開発中です">
                <FileSpreadsheet className="size-4.5" aria-hidden />
                ファイルを選択
              </Button>
            </div>
            <p className="mt-5 text-[0.88rem] text-muted">.xlsx ／ .csv（UTF-8・Shift_JIS）・最大5ファイル・1ファイル10MB・合計10万行まで</p>
          </div>

          <p className="mt-4 rounded-lg bg-warning-soft px-4 py-2.5 text-[0.92rem] text-warning ring-1 ring-warning/25">
            <span className="font-bold">開発中：</span>ファイルの読込機能は現在開発中のため、まだご利用いただけません。
          </p>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-line">
            <h2 className="flex items-center gap-2 font-bold text-navy">
              <FileJson className="size-5 text-accent" aria-hidden />
              保存したフローを使う
            </h2>
            <p className="mt-1.5 text-[0.92rem] text-ink/80">前回保存したフロー（.json）を開き、新しいファイルで再実行できます。</p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" disabled title="フローの読込は開発中です">
                フローを開く
              </Button>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 ring-1 ring-line">
            <h2 className="flex items-center gap-2 font-bold text-navy">
              <Eye className="size-5 text-accent" aria-hidden />
              編集画面を見てみる
            </h2>
            <p className="mt-1.5 text-[0.92rem] text-ink/80">サンプルのフローで、フローの確認・設定・プレビュー画面を表示します。</p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onShowSample}>
                サンプルフローで画面を見る
              </Button>
            </div>
          </div>

          <ul className="space-y-2 px-1 text-[0.85rem] text-muted">
            <li className="flex gap-2">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              AIには列名・型・一部のサンプル値のみ送信します。
            </li>
            <li className="flex gap-2">
              <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
              データは保存せず、60分で自動削除します。
            </li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
