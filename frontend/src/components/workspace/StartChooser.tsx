import { ArrowRight, FileSpreadsheet, FolderOpen, MessageSquareText, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { StartMode } from '../../flow/journey'

/*
 * 「自分のExcelで試す」の最初の画面：3つの開始方法を選ぶ。
 * どれを選んでも、作業手順・実行・品質検証は同じ仕組みを使う（開始方法で処理を分けない）。
 * 「やりたい作業から始める」をおすすめとして強調するが、ほかの2つも同じ大きさで選びやすくする。
 */

type Way = { mode: StartMode; icon: LucideIcon; title: string; body: string; who: string[]; action: string; note?: string }

const WAYS: Way[] = [
  {
    mode: 'WORK_FIRST',
    icon: MessageSquareText,
    title: 'やりたい作業から始める',
    body: 'やりたい作業を説明し、必要なら改善診断を受けてから、処理手順を作成します。',
    who: ['業務は決まっているが、手順を整理できていない', 'Excel作業を見直したい', '自動化を初めて検討する'],
    action: '作業の説明から始める',
    note: 'AIによる手順の作成・改善診断は開発中です。処理部品を組み合わせて手順を作れます。',
  },
  {
    mode: 'FILE_FIRST',
    icon: FileSpreadsheet,
    title: 'Excelを読み込んで始める',
    body: '実際のExcel・CSVの列やデータを確認しながら、加工・集計の手順を作成します。',
    who: ['まずデータを見たい', '列構成を確認してから作業を決めたい', 'Excel加工をすぐに始めたい'],
    action: 'Excel・CSVを読み込む',
  },
  {
    mode: 'SAVED_WORKFLOW',
    icon: FolderOpen,
    title: '保存した手順を使う',
    body: '以前作成した手順と品質ルールを読み込み、新しいExcelで同じ作業を実行します。',
    who: ['毎月同じ集計を行う', '保存済みの業務手順を再利用したい'],
    action: '保存した手順を開く',
  },
]

export function StartChooser({ onChoose }: { onChoose: (mode: StartMode) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <p className="text-[0.85rem] font-bold text-mint">新しい作業を始める</p>
        <h1 className="mt-1 text-[1.75rem] leading-tight font-bold text-white">どこから始めますか？</h1>
        <p className="mt-1.5 text-subtle">どの方法でも、同じ処理の仕組みと品質の確認を使います。途中で入力した内容は、戻っても消えません。</p>
        <ul className="mt-6 grid gap-4 lg:grid-cols-3" aria-label="開始方法">
          {WAYS.map((w) => {
            const recommended = w.mode === 'WORK_FIRST'
            return (
              <li key={w.mode} className="flex">
                <section
                  className={`flex w-full flex-col rounded-2xl p-6 ring-1 ${recommended ? 'bg-mint/8 ring-mint/55' : 'bg-panel ring-edge'}`}
                  aria-label={w.title}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`grid size-11 place-items-center rounded-xl ring-1 ${recommended ? 'bg-mint/15 text-mint ring-mint/40' : 'bg-white/5 text-mint ring-edge'}`}>
                      <w.icon className="size-5.5" aria-hidden />
                    </span>
                    {recommended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mint px-2.5 py-0.5 text-[0.78rem] font-bold text-on-mint">
                        <Sparkles className="size-3.5" aria-hidden />
                        おすすめ
                      </span>
                    )}
                  </div>
                  <h2 className="mt-4 text-[1.2rem] font-bold text-white">{w.title}</h2>
                  <p className="mt-1.5 text-[0.92rem] leading-relaxed text-white/80">{w.body}</p>
                  <ul className="mt-3 space-y-1 text-[0.85rem] text-subtle" aria-label={`${w.title}が向いている人`}>
                    {w.who.map((x) => (
                      <li key={x} className="flex gap-1.5">
                        <span aria-hidden>・</span>
                        {x}
                      </li>
                    ))}
                  </ul>
                  {w.note && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[0.8rem] leading-relaxed text-warning ring-1 ring-warning/30">{w.note}</p>}
                  <div className="mt-auto pt-5">
                    <button
                      type="button"
                      onClick={() => onChoose(w.mode)}
                      className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint ${
                        recommended ? 'bg-mint text-on-mint hover:bg-mint-hover' : 'text-white ring-1 ring-white/25 ring-inset hover:bg-white/8 hover:ring-white/50'
                      }`}
                    >
                      {w.action}
                      <ArrowRight className="size-4" aria-hidden />
                    </button>
                  </div>
                </section>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
