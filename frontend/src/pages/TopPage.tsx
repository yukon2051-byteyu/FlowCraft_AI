import {
  ArrowRight,
  Check,
  Clock3,
  FileSpreadsheet,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SiteFooter } from '../components/layout/SiteFooter'
import { SiteHeader } from '../components/layout/SiteHeader'
import { HeroVisual, HeroVisualCompact } from '../components/top/HeroVisual'
import { UseCaseVisual } from '../components/top/UseCaseVisual'
import { Button } from '../components/ui/Button'

export default function TopPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas">
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <UseCases />
        <Demos />
        <TryOwnExcel />
      </main>
      <SiteFooter />
    </div>
  )
}

/* ================= ヒーロー ================= */

const HERO_POINTS = ['Excel（.xlsx）・CSVに対応', 'AIの提案は確認してから実行', '保存した手順で翌月も再実行']

function Hero() {
  return (
    <section className="relative">
      {/* 控えめな背景装飾：細い方眼と、右側のミントの光 */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-10 pb-12 sm:px-8 lg:pt-12 lg:pb-14 xl:grid-cols-[minmax(0,1fr)_640px] xl:gap-10">
        <div>
          <p className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-mint/10 px-3 py-1 text-[0.85rem] font-bold text-mint ring-1 ring-mint/30">
            <Sparkles className="size-4" aria-hidden />
            Excel定型業務の自動化 × AI
          </p>
          {/* 2行で必ず区切る（行の途中では改行しない）。スマートフォンでは文字を小さくして収める */}
          <h1 className="text-[1.95rem] leading-[1.22] font-bold tracking-tight text-white sm:text-[2.9rem] xl:text-[3.1rem]">
            <span className="whitespace-nowrap">そのExcel作業、</span>
            <br />
            <span className="whitespace-nowrap">
              次から<span className="text-mint">ワンクリック</span>
            </span>
          </h1>
          <p className="mt-5 max-w-[34rem] text-[1.07rem] leading-relaxed text-subtle">
            複数のExcelから必要な列を抽出し、結合・集計・照合。AIが処理フローを提案し、一度作った手順は何度でも再利用できます。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="#demo" variant="primary" size="lg">
              <Play className="size-4.5" aria-hidden />
              デモを体験する
            </Button>
            <Button to="/workspace" variant="outlineDark" size="lg">
              <Upload className="size-4.5" aria-hidden />
              自分のExcelで試す
            </Button>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[0.9rem] text-subtle">
            {HERO_POINTS.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-mint" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* 幅640px以上：フロー図／スマートフォン：縦並びの簡易版 */}
        <div className="hidden justify-center sm:flex xl:justify-end">
          <HeroVisual />
        </div>
        <div className="sm:hidden">
          <HeroVisualCompact />
        </div>
      </div>
    </section>
  )
}

/* ================= 3つの特長 ================= */

type Feature = { icon: LucideIcon; title: string; body: string; points: string[] }

const FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: 'AIでフロー作成',
    body: '日本語で業務を説明すると、AIが処理手順を提案します。結合キーなど重要な条件は、人が確認してから確定します。',
    points: ['関数やマクロの知識は不要', 'AIの提案と確定済みを区別して表示'],
  },
  {
    icon: ShieldCheck,
    title: 'データ品質を検証',
    body: '重複、欠損、結合漏れ、集計結果の不整合を自動で検出。重大な問題があれば処理を止め、原因と直し方を示します。',
    points: ['結合前後の件数・金額を照合', '未照合レコードを一覧で確認'],
  },
  {
    icon: RefreshCw,
    title: '何度でも再実行',
    body: '一度作った処理フローを保存し、翌月は新しいExcelを指定するだけ。列名の変更などは実行前に知らせます。',
    points: ['フローはファイルで保存・共有', '担当者が替わっても同じ手順'],
  },
]

function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-20">
        <SectionHeading
          eyebrow="特長"
          title="Excel作業の「手間」と「不安」を、まとめて解消"
          lead="作業を自動化するだけでなく、結果が正しいかを確かめ、同じ手順を繰り返し使えるようにします。"
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="group rounded-2xl bg-panel p-6 ring-1 ring-edge transition-colors hover:ring-mint/40">
              <div className="flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
                  <f.icon className="size-6" aria-hidden />
                </span>
                <span className="text-[0.85rem] font-bold text-subtle/60 tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-[1.3rem] font-bold text-white">{f.title}</h3>
              <p className="mt-2 leading-relaxed text-subtle">{f.body}</p>
              <ul className="mt-5 space-y-1.5 border-t border-edge pt-4">
                {f.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-[0.92rem] text-white/85">
                    <Check className="size-4 shrink-0 text-mint" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================= 利用例 ================= */

const OTHER_USES = ['月次売上集計', 'マスタとの照合', '在庫差異の検出', '勤怠データの集計', 'データのクレンジング', '定型レポート作成']

function UseCases() {
  return (
    <section id="usecases" className="scroll-mt-16 bg-canvas">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-14 lg:py-20">
        <div>
          <SectionHeading
            eyebrow="利用例"
            title="バラバラなExcelから、必要な列だけを集めて1つに"
            lead="支店や担当者ごとに列の並びや名前が違うファイルでも、使う列を対応付けて1つの表に統合できます。足りない列があれば、統合前に知らせます。"
          />
          <p className="mt-6 mb-2 text-[0.85rem] font-bold text-subtle">こんな業務にも</p>
          <ul className="flex flex-wrap gap-2">
            {OTHER_USES.map((u) => (
              <li key={u} className="rounded-full bg-panel px-3 py-1 text-[0.88rem] text-white/90 ring-1 ring-edge">
                {u}
              </li>
            ))}
          </ul>
        </div>
        <UseCaseVisual />
      </div>
    </section>
  )
}

/* ================= デモ ================= */

type Demo = {
  title: string
  summary: string
  inputs: string[]
  outputs: string[]
  /** 実装状態。'ready' になるまでは開始ボタンを押せない */
  status: 'ready' | 'coming_soon'
}

const DEMOS: Demo[] = [
  {
    title: '月次売上集計デモ',
    summary: '売上実績を商品・部署マスタと結合し、部署別・商品別に集計します。翌月分のデータでの再実行も体験できます。',
    inputs: ['売上実績.xlsx', '商品マスタ.xlsx', '部署マスタ.xlsx'],
    outputs: ['部署別・商品別の売上集計', '結合漏れ・重複の検証結果'],
    status: 'coming_soon',
  },
  {
    title: '在庫差異検出デモ',
    summary: '入出庫履歴から理論在庫を計算し、在庫台帳との差異がある商品を抽出します。差異の根拠も確認できます。',
    inputs: ['在庫台帳.xlsx', '入出庫履歴.xlsx'],
    outputs: ['差異のある商品の一覧', '差異件数と検証レポート'],
    status: 'coming_soon',
  },
]

function Demos() {
  return (
    <section id="demo" className="scroll-mt-16 border-y border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-20">
        <SectionHeading
          eyebrow="デモ"
          title="架空の業務データで、一連の流れを体験"
          lead="ファイル読込からAIによるフロー作成、品質検証、Excel出力まで。実際の処理エンジンで動作します。"
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {DEMOS.map((d) => (
            <article key={d.title} className="flex flex-col rounded-2xl bg-panel p-6 ring-1 ring-edge sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[1.3rem] font-bold text-white">{d.title}</h3>
                {d.status === 'coming_soon' && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-[0.8rem] font-bold text-warning ring-1 ring-warning/40">
                    <Clock3 className="size-3.5" aria-hidden />
                    準備中
                  </span>
                )}
              </div>
              <p className="mt-2 leading-relaxed text-subtle">{d.summary}</p>

              <div className="mt-5 grid flex-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <IoList label="入力するファイル" items={d.inputs} icon={FileSpreadsheet} />
                <ArrowRight className="mx-auto hidden size-5 self-center text-mint sm:block" aria-hidden />
                <IoList label="得られる結果" items={d.outputs} icon={Check} />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={d.status !== 'ready'} title="デモは現在準備中です">
                  <Play className="size-4" aria-hidden />
                  このデモを始める
                </Button>
                {d.status === 'coming_soon' && <span className="text-[0.88rem] text-subtle">公開準備が整い次第、ここから開始できます。</span>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function IoList({ label, items, icon: Icon }: { label: string; items: string[]; icon: LucideIcon }) {
  return (
    <div className="rounded-xl bg-canvas/70 p-4 ring-1 ring-edge">
      <p className="mb-2 text-[0.82rem] font-bold text-subtle">{label}</p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex items-center gap-2 text-[0.92rem] text-white/90">
            <Icon className="size-4 shrink-0 text-mint" aria-hidden />
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ================= 自分のExcelで試す ================= */

const STEPS_TO_START = [
  { title: 'ファイルを読み込む', body: 'Excel・CSVを最大5つまで' },
  { title: '作業を日本語で伝える', body: 'AIが処理フローを提案' },
  { title: '確認して実行・保存', body: '品質検証の結果とExcelを出力' },
]

const SPECS = [
  { k: 'ファイル形式', v: 'Excel（.xlsx）、CSV' },
  { k: 'CSVの文字コード', v: 'UTF-8、Shift_JIS（CP932）' },
  { k: '上限', v: '5ファイル、1ファイル10MB、合計10万行まで' },
]

const CAUTIONS: { icon: LucideIcon; text: string }[] = [
  { icon: TriangleAlert, text: 'パスワード付きのExcel、マクロ（VBA）の実行には対応していません。' },
  { icon: Lock, text: 'AIには列名・データ型・一部のサンプル値のみ送信します。個人情報と思われる列の値は送信前に伏せます。' },
  { icon: Clock3, text: '読み込んだデータは保存せず、最後の操作から60分で自動的に削除します。' },
  { icon: ShieldCheck, text: '公開版では、機密情報や実在の個人情報を含むファイルは使用しないでください。' },
]

function TryOwnExcel() {
  return (
    <section id="try" className="relative scroll-mt-16 overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute -bottom-48 -left-24 h-[460px] w-[680px] bg-[radial-gradient(closest-side,rgba(56,217,173,0.14),transparent)]" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:py-20">
        <div>
          <p className="text-[0.88rem] font-bold text-mint">はじめ方</p>
          <h2 className="mt-2 text-[1.9rem] leading-snug font-bold text-white sm:text-[2.2rem]">自分のExcelで試す</h2>
          <p className="mt-3 leading-relaxed text-subtle">いつもの業務ファイルで、3ステップで始められます。</p>
          <ol className="mt-7 space-y-4">
            {STEPS_TO_START.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-mint/12 font-bold text-mint ring-1 ring-mint/35">{i + 1}</span>
                <div>
                  <p className="font-bold text-white">{s.title}</p>
                  <p className="text-[0.92rem] text-subtle">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Button to="/workspace" variant="primary" size="lg">
              <Upload className="size-4.5" aria-hidden />
              ファイルを選んで始める
            </Button>
          </div>
        </div>

        {/* 対応形式・注意は「読む」情報なので明るいパネルにする */}
        <div className="light-panel rounded-2xl p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:p-7">
          <h3 className="text-[1.1rem] font-bold">対応形式</h3>
          <dl className="mt-3 divide-y divide-line rounded-lg bg-paper ring-1 ring-line">
            {SPECS.map((s) => (
              <div key={s.k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-[0.88rem] font-bold text-muted">{s.k}</dt>
                <dd className="text-[0.95rem]">{s.v}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-6 text-[1.1rem] font-bold">ご利用上の注意</h3>
          <ul className="mt-3 space-y-2.5">
            {CAUTIONS.map((c) => (
              <li key={c.text} className="flex gap-2.5 text-[0.92rem] leading-relaxed">
                <c.icon className="mt-0.5 size-4.5 shrink-0 text-forest" aria-hidden />
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ================= 共通 ================= */

function SectionHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-[0.88rem] font-bold text-mint">{eyebrow}</p>
      <h2 className="mt-2 text-[1.75rem] leading-snug font-bold text-white sm:text-[2.1rem]">{title}</h2>
      <p className="mt-3 leading-relaxed text-subtle">{lead}</p>
    </div>
  )
}
