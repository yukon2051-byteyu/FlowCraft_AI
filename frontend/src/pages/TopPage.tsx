import {
  ArrowRight,
  ChartColumn,
  Check,
  Clock3,
  Copy,
  FileSpreadsheet,
  FolderOpen,
  KeyRound,
  ListChecks,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FeatureKey } from '../content/featureStatus'
import { SiteFooter } from '../components/layout/SiteFooter'
import { SiteHeader } from '../components/layout/SiteHeader'
import { HeroVisual, HeroVisualCompact } from '../components/top/HeroVisual'
import { UseCaseTabs } from '../components/top/UseCaseTabs'
import { Button } from '../components/ui/Button'
import { DevBadge } from '../components/ui/DevBadge'

/*
 * TOPページ（改修 Ver.2.0）
 * 構成：ヒーロー → できること（4つ）→ 活用例（3タブ）→ デモ → 自分のExcelで試す → 安心して使うための仕組み
 * 未実装の機能には「開発中」を表示する（content/featureStatus.ts で一元管理）。
 */
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
        <Trust />
      </main>
      <SiteFooter />
    </div>
  )
}

/* ================= ヒーロー ================= */

const HERO_POINTS = ['Excel（.xlsx）・CSVに対応', 'AIの提案は確認してから実行', '翌月はファイルを選んで再実行']

function Hero() {
  return (
    <section className="relative">
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
            <span className="whitespace-nowrap text-mint">次からワンクリック</span>
          </h1>
          <p className="mt-5 max-w-[36rem] text-[1.07rem] leading-relaxed text-subtle">
            Excel・CSVの加工、集計、分析、レポート作成まで。
            <br className="hidden sm:block" />
            AIと一緒に作業手順を作り、保存して繰り返し使えます。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="#demo" variant="primary" size="lg">
              <Play className="size-4.5" aria-hidden />
              デモを体験する
            </Button>
            <Button to="/build" variant="outlineDark" size="lg">
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

        {/* 幅640px以上：処理の流れの図／スマートフォン：4段階の簡易版 */}
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

/* ================= できること（4つの主要価値） ================= */

type Feature = { icon: LucideIcon; title: string; body: string; note: string; feature: FeatureKey }

const FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: 'AIが作業手順を提案',
    body: '普段のExcel作業を日本語で説明するだけ。AIが必要な処理を組み合わせ、作業手順を提案します。',
    note: '提案内容は実行前に確認・修正できます。',
    feature: 'aiFlow',
  },
  {
    icon: ChartColumn,
    title: '加工から分析まで対応',
    body: 'データの抽出・結合・集計から、比較分析やグラフ作成まで。一連の作業をまとめて実行できます。',
    note: '集計結果と分析レポートをExcelに出力できます。',
    feature: 'analysis',
  },
  {
    icon: RefreshCw,
    title: '作業手順を保存・再利用',
    body: '一度作った作業手順を保存。翌月は新しいファイルを指定して、同じ処理を繰り返せます。',
    note: '毎回AIに作業内容を説明し直す必要はありません。',
    feature: 'saveReuse',
  },
  {
    icon: Copy,
    title: '別の業務にも応用',
    body: '保存した作業手順をもとに、別部署や別業務に合わせた変更をAIが提案します。',
    note: '元の手順を残したまま、新しい手順を作成できます。',
    feature: 'derive',
  },
]

function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading
          eyebrow="できること"
          title="プログラムを作らず、処理の組み合わせで自動化"
          lead="抽出・結合・集計・分析などの共通の処理を組み合わせて、部署や業務ごとに違う作業手順を作れます。"
        />
        <DevNote />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="flex gap-4 rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
                <f.icon className="size-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[0.85rem] font-bold text-subtle/70 tabular-nums">0{i + 1}</span>
                  <h3 className="text-[1.2rem] font-bold text-white">{f.title}</h3>
                  <DevBadge feature={f.feature} />
                </div>
                <p className="mt-2 leading-relaxed text-white/85">{f.body}</p>
                <p className="mt-2 flex items-start gap-1.5 text-[0.9rem] text-subtle">
                  <Check className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
                  {f.note}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================= 活用例（3タブ） ================= */

function UseCases() {
  return (
    <section id="usecases" className="scroll-mt-16 bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading eyebrow="活用例" title="同じ仕組みで、さまざまな定型業務に" />
        <div className="mt-7">
          <UseCaseTabs />
        </div>
      </div>
    </section>
  )
}

/* ================= デモ ================= */

type Demo = { title: string; summary: string; inputs: string[]; outputs: string[] }

const DEMOS: Demo[] = [
  {
    title: '月次売上集計デモ',
    summary: '売上を商品・部署の情報とまとめ、部署別・商品別に集計。グラフとExcelの集計表を作成します。',
    inputs: ['売上実績.xlsx', '商品マスタ.xlsx', '部署マスタ.xlsx'],
    outputs: ['部署別・商品別の集計とグラフ', '照合漏れ・重複の確認結果'],
  },
  {
    title: '在庫差異検出デモ',
    summary: '入出庫履歴から理論上の在庫を計算し、在庫台帳と合わない商品を抽出。差異の根拠も確認できます。',
    inputs: ['在庫台帳.xlsx', '入出庫履歴.xlsx'],
    outputs: ['差異のある商品の一覧', '差異件数と確認レポート'],
  },
]

function Demos() {
  return (
    <section id="demo" className="scroll-mt-16 border-y border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading
          eyebrow="デモ"
          title="サンプルデータで、実際の処理を体験"
          lead="架空の業務データで、加工・集計・確認まで実際の処理を行います。デモ用にあらかじめ用意したAIの提案を使う場合は、その旨を表示します。"
        />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {DEMOS.map((d) => (
            <article key={d.title} className="flex flex-col rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[1.25rem] font-bold text-white">{d.title}</h3>
                <DevBadge feature="demo" />
              </div>
              <p className="mt-2 leading-relaxed text-subtle">{d.summary}</p>
              <div className="mt-4 grid flex-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <IoList label="使うファイル" items={d.inputs} icon={FileSpreadsheet} />
                <ArrowRight className="mx-auto hidden size-5 self-center text-mint sm:block" aria-hidden />
                <IoList label="得られる結果" items={d.outputs} icon={Check} />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled title="デモは現在準備中です">
                  <Play className="size-4" aria-hidden />
                  このデモを始める
                </Button>
                <span className="text-[0.88rem] text-subtle">準備が整い次第、ここから開始できます。</span>
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

type StartWay = { icon: LucideIcon; title: string; body: string; feature: FeatureKey }

const START_WAYS: StartWay[] = [
  { icon: Upload, title: '新しい作業手順を作る', body: 'Excel・CSVを読み込み、AIの提案または手動で処理内容を決めます。', feature: 'upload' },
  { icon: FolderOpen, title: '保存した作業手順を使う', body: '以前作った手順を開き、新しいファイルで同じ処理を実行します。', feature: 'saveReuse' },
  { icon: Copy, title: '既存の手順をもとに新しく作る', body: '保存した手順をもとに、別の業務に合わせて変更します。', feature: 'derive' },
]

const SPECS = [
  { k: 'ファイル形式', v: 'Excel（.xlsx）、CSV' },
  { k: 'CSVの文字コード', v: 'UTF-8、Shift_JIS（CP932）' },
  { k: '上限', v: '5ファイル、1ファイル10MB、合計10万行まで' },
]

function TryOwnExcel() {
  return (
    <section id="try" className="relative scroll-mt-16 overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute -bottom-48 -left-24 h-[460px] w-[680px] bg-[radial-gradient(closest-side,rgba(56,217,173,0.12),transparent)]" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14 lg:py-14">
        <div>
          <SectionHeading eyebrow="はじめ方" title="自分のExcelで試す" lead="ボタンを押した後の画面で、3つの始め方から選べます。" />
          <ol className="mt-6 space-y-3">
            {START_WAYS.map((w) => (
              <li key={w.title} className="flex gap-3.5 rounded-xl bg-panel p-4 ring-1 ring-edge">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-mint/12 text-mint ring-1 ring-mint/30">
                  <w.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-white">{w.title}</p>
                    <DevBadge feature={w.feature} />
                  </div>
                  <p className="mt-0.5 text-[0.92rem] text-subtle">{w.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7">
            <Button to="/build" variant="primary" size="lg">
              <Upload className="size-4.5" aria-hidden />
              自分のExcelで試す
            </Button>
          </div>
        </div>

        {/* 対応形式・AIの利用条件は「読む」情報なので明るいパネルにする */}
        <div className="light-panel self-start rounded-2xl p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:p-7">
          <h3 className="text-[1.1rem] font-bold">対応形式</h3>
          <dl className="mt-3 divide-y divide-line rounded-lg bg-paper ring-1 ring-line">
            {SPECS.map((s) => (
              <div key={s.k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-[0.88rem] font-bold text-muted">{s.k}</dt>
                <dd className="text-[0.95rem]">{s.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 rounded-xl bg-mint-soft p-4 ring-1 ring-forest/20">
            <p className="flex items-center gap-2 font-bold text-forest">
              <KeyRound className="size-4.5" aria-hidden />
              AI機能の利用について
            </p>
            <p className="mt-1.5 text-[0.92rem] leading-relaxed">
              AIによる作業手順の作成・変更の提案・分析コメントには、<span className="font-bold">AI使用パスワード</span>が必要です。AIを使う操作のときにだけ入力を求めます。
            </p>
            <p className="mt-1 text-[0.92rem] leading-relaxed text-muted">ファイルの読み込みや、Excelの加工・集計など、AIを使わない機能はパスワードなしで使えます。</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ================= 安心して繰り返し使うために ================= */

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ListChecks, title: '実行前に内容を確認', body: 'AIの提案も、処理内容を確認・修正してから実行します。' },
  { icon: ShieldCheck, title: 'データの品質を確認', body: '空欄・重複・照合漏れや、想定外の件数の増加を確認します。' },
  { icon: TriangleAlert, title: '問題があれば止める', body: '集計の前後で金額が合わないなどの問題があれば、結果を出力しません。' },
  { icon: RefreshCw, title: '同じ手順で同じ結果', body: '保存した手順は、同じデータなら毎回同じ結果になります。' },
]

const CAUTIONS: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: 'AIに送るのは列名・データの形式・一部のサンプル値だけです。個人情報と思われる列の値は送信前に伏せます。' },
  { icon: Clock3, text: '読み込んだデータは保存せず、最後の操作から60分で自動的に削除します。' },
  { icon: TriangleAlert, text: 'パスワード付きのExcel、マクロ（VBA）の実行には対応していません。' },
  { icon: ShieldCheck, text: '公開版では、機密情報や実在の個人情報を含むファイルは使わないでください。' },
]

function Trust() {
  return (
    <section id="trust" className="scroll-mt-16 border-t border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8 lg:py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading eyebrow="安心して使うための仕組み" title="安心して繰り返し使うために" />
          <DevBadge feature="quality" className="mb-1" />
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <li key={t.title} className="rounded-xl bg-panel p-4 ring-1 ring-edge">
              <p className="flex items-center gap-2 font-bold text-white">
                <t.icon className="size-4.5 text-mint" aria-hidden />
                {t.title}
              </p>
              <p className="mt-1.5 text-[0.9rem] leading-relaxed text-subtle">{t.body}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-8 text-[0.95rem] font-bold text-white">データの取り扱い・ご利用上の注意</h3>
        <ul className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2">
          {CAUTIONS.map((c) => (
            <li key={c.text} className="flex gap-2.5 text-[0.9rem] leading-relaxed text-subtle">
              <c.icon className="mt-0.5 size-4 shrink-0 text-mint/80" aria-hidden />
              {c.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ================= 共通 ================= */

function DevNote() {
  return (
    <p className="mt-4 inline-flex items-center gap-1.5 text-[0.88rem] text-subtle">
      <Clock3 className="size-4 text-warning" aria-hidden />
      現在開発中の機能には「開発中」と表示しています。
    </p>
  )
}

function SectionHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-[0.88rem] font-bold text-mint">{eyebrow}</p>
      <h2 className="mt-2 text-[1.7rem] leading-snug font-bold text-white sm:text-[2rem]">{title}</h2>
      {lead && <p className="mt-3 leading-relaxed text-subtle">{lead}</p>}
    </div>
  )
}
