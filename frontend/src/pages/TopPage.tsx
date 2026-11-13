import {
  ArrowRight,
  CalendarClock,
  Check,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  FolderOpen,
  KeyRound,
  Lightbulb,
  ListChecks,
  Lock,
  MessageSquareText,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Repeat,
  TriangleAlert,
  Upload,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FeatureKey } from '../content/featureStatus'
import { SiteFooter } from '../components/layout/SiteFooter'
import { SiteHeader } from '../components/layout/SiteHeader'
import { BackToTop } from '../components/top/BackToTop'
import { HeroVisual, HeroVisualCompact } from '../components/top/HeroVisual'
import { Button } from '../components/ui/Button'
import { DevBadge } from '../components/ui/DevBadge'

/*
 * TOPページ（全面改修：新しい製品コンセプト）
 * 伝えること：①その作業は本当に必要か ②不要な作業は減らし、必要な作業は効率化する ③処理して終わりではなく、結果の正しさまで確認する
 * 構成：ヒーロー → 選ばれる6つの理由 → 自動化だけでは終わらない（4つの段階）→ デモ → 自分のExcelで試す → 処理できた、だけで終わらせない
 * 未実装の機能には「開発中」を表示する（content/featureStatus.ts で一元管理）。
 */
export default function TopPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas">
      <SiteHeader />
      <main>
        <Hero />
        <Reasons />
        <Stages />
        <Demos />
        <TryOwnExcel />
        <Trust />
      </main>
      <SiteFooter />
      <BackToTop />
    </div>
  )
}

/* ================= ヒーロー ================= */

const HERO_POINTS = ['ムダを発見', '処理を自動化', '結果を検証']

function Hero() {
  return (
    <section className="relative">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-10 pb-12 sm:px-8 lg:pt-12 lg:pb-14 xl:grid-cols-[minmax(0,1fr)_640px] xl:gap-10">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 text-[0.85rem] font-bold tracking-wider text-mint uppercase">
            <Workflow className="size-4" aria-hidden />
            FlowCraft AI — Excel業務改善
          </p>
          {/* 2行で必ず区切る（行の途中では改行しない）。2行目が長いため、前の版より文字を小さくしている */}
          <h1 className="text-[1.62rem] leading-[1.3] font-bold tracking-tight text-white sm:text-[2.5rem] xl:text-[2.6rem]">
            <span className="whitespace-nowrap">そのExcel作業、</span>
            <br />
            <span className="whitespace-nowrap text-mint">自動化する前に、見直そう。</span>
          </h1>
          <p className="mt-5 max-w-[34rem] text-[1.05rem] leading-relaxed text-subtle">
            その作業、本当に必要ですか？
            <br />
            AIがムダや改善点を見つけ、必要な処理は簡単に自動化。
            <br className="hidden sm:block" />
            結果の正しさまで確認します。
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button to="/build" variant="primary" size="lg">
              <Upload className="size-4.5" aria-hidden />
              自分のExcelで試す
            </Button>
            <Button href="#demo" variant="outlineDark" size="lg">
              <Play className="size-4.5" aria-hidden />
              デモを体験する
            </Button>
          </div>
          <p className="mt-3 text-[0.9rem] text-subtle">見直しは任意。すぐに自動化から始めることもできます。</p>
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-edge pt-5 text-[0.92rem] text-white/85">
            {HERO_POINTS.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-mint" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[0.82rem] text-subtle">
            <Clock3 className="size-3.5 text-warning" aria-hidden />
            一部の機能は開発中です（各所に「開発中」と表示）。
          </p>
        </div>

        {/* 幅640px以上：見直す→改善する→実行する→確かめる の図／スマートフォン：4段階の簡易版 */}
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

/* ================= 選ばれる6つの理由 ================= */

type Reason = { icon: LucideIcon; title: string; body: string; feature: FeatureKey }

const REASONS: Reason[] = [
  { icon: MessageSquareText, title: '手順を簡単に作れる', body: '作業を日本語で説明すると、AIが処理の手順を組み立てます。内容は確認してから使います。', feature: 'aiFlow' },
  { icon: ShieldCheck, title: '結果を検証できる', body: '結果が業務の「完了基準」を満たしているかを確認し、判定の理由を示します。', feature: 'criteria' },
  { icon: Repeat, title: '単発にも定型にも', body: '一度きりの集計にも、毎月の定型業務にも。保存するかは後から選べます。', feature: 'saveReuse' },
  { icon: SlidersHorizontal, title: '業務に合わせて変えられる', body: '処理の手順も、確認の条件も、自分の業務に合わせて変更できます。', feature: 'processing' },
]

const KAIZEN_WAYS = [
  { label: '廃止', note: 'その作業はなくせないか' },
  { label: '簡素化', note: '工程を減らせないか' },
  { label: '標準化', note: '手順をそろえられないか' },
  { label: '自動化', note: '残った作業を自動化できないか' },
]

function Reasons() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading
          eyebrow="選ばれる6つの理由"
          title="Excelの処理だけでなく、その前と後ろまで。"
          lead="作業そのものを見直し、処理した結果が正しいかまで確かめる。生成AIに個別に頼むときに、利用者が自分で行っている部分を受け持ちます。"
        />
        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* ⑤ 新しい価値：大きく見せる */}
          <article className="relative overflow-hidden rounded-2xl bg-panel p-6 ring-1 ring-edge sm:p-7">
            <span className="absolute inset-x-0 top-0 h-1 bg-kaizen" aria-hidden />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-kaizen/12 text-kaizen ring-1 ring-kaizen/35">
                  <Lightbulb className="size-5" aria-hidden />
                </span>
                <span className="text-[0.85rem] font-bold text-kaizen-text tabular-nums">05</span>
                <h3 className="text-[1.35rem] font-bold text-white">作業そのものを改善できる</h3>
                <DevBadge feature="kaizen" />
              </div>
              <p className="mt-3 leading-relaxed text-white/85">
                作業の必要性・<span className="font-bold text-kaizen-text">ムダ・重複している工程を見直します。</span>
                <span className="font-bold text-white">不要な作業は、わざわざ自動化しません。</span>
              </p>
              <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {KAIZEN_WAYS.map((w, i) => (
                  <li key={w.label} className={`rounded-xl px-3 py-2.5 ring-1 ${i === 3 ? 'bg-mint/12 ring-mint/40' : 'bg-panel-hi ring-edge'}`}>
                    <span className={`block font-bold ${i === 3 ? 'text-mint' : 'text-white'}`}>
                      {i + 1}. {w.label}
                    </span>
                    <span className="mt-0.5 block text-[0.82rem] leading-snug text-subtle">{w.note}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex items-start gap-1.5 text-[0.88rem] text-subtle">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                診断するかどうかは自由です。業務上必要な作業の廃止を強制することはありません。
              </p>
            </div>
          </article>

          {/* ①〜④ */}
          <div className="grid gap-4 sm:grid-cols-2">
            {REASONS.map((r, i) => (
              <article key={r.title} className="rounded-2xl bg-panel p-5 ring-1 ring-edge">
                <div className="flex items-start justify-between gap-2">
                  <span className="grid size-10 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
                    <r.icon className="size-5" aria-hidden />
                  </span>
                  <DevBadge feature={r.feature} />
                </div>
                <h3 className="mt-3 flex items-baseline gap-2 text-[1.08rem] font-bold text-white">
                  <span className="text-[0.8rem] text-subtle/70 tabular-nums">0{i + 1}</span>
                  {r.title}
                </h3>
                <p className="mt-1.5 text-[0.92rem] leading-relaxed text-subtle">{r.body}</p>
              </article>
            ))}
          </div>
        </div>

        {/* ⑥ 無人定期実行：横長の帯で、縦に伸ばさない */}
        <ScheduleCard />
      </div>
    </section>
  )
}

/** 無人で実行する前に必ず通る5つの段階（設定しただけでは動かない） */
const SAFE_START = ['設定を保存', '接続テスト', 'テスト実行', '品質検証', '利用者が有効化']

function ScheduleCard() {
  return (
    <article
      aria-label="決まった日時に無人で実行できる"
      className="mt-4 grid gap-5 rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
            <CalendarClock className="size-5" aria-hidden />
          </span>
          <span className="text-[0.8rem] text-subtle/70 tabular-nums">06</span>
          <h3 className="text-[1.2rem] font-bold text-white">毎月の作業は、もう開かなくていい。</h3>
          <DevBadge feature="schedule" />
        </div>
        <p className="mt-2.5 text-[0.92rem] leading-relaxed text-subtle">
          参照先・処理手順・実行日時・出力先を一度設定。ファイルの取得から加工・集計、品質検証、保存、結果の通知までを、決まった日時に自動で実行します。
        </p>
        <p className="mt-2 text-[0.92rem] leading-relaxed">
          <span className="font-bold text-white">通常時は、結果を確認するだけ。</span>
          <span className="text-subtle">確認が必要な結果やエラーのときは、正式なファイルを出力せずに止めてお知らせします。その後の対応は人が行います。</span>
        </p>
      </div>
      <div>
        <p className="text-[0.85rem] font-bold text-white/90">設定しただけでは動きません。5つの確認を通ってから始めます</p>
        <ol className="mt-2 grid grid-cols-5 gap-1.5">
          {SAFE_START.map((s, i) => (
            <li
              key={s}
              className={`rounded-lg px-2 py-2 text-center text-[0.8rem] leading-snug font-bold ring-1 ${i === 4 ? 'bg-mint/12 text-mint ring-mint/40' : 'bg-panel-hi text-white/90 ring-edge'}`}
            >
              <span className="block text-[0.72rem] font-normal text-subtle tabular-nums">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[0.82rem] text-subtle">設定を変えたときは、もう一度確認してから実行します（以前の確認結果は使い回しません）。</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="outlineDark" size="sm" disabled title="開発中です。完成後、サンプルデータで試せます">
            <CalendarClock className="size-4" aria-hidden />
            3分後に自動実行を試す
          </Button>
          <span className="text-[0.82rem] text-subtle">完成後、サンプルデータを使い、実際のExcel処理をクラウド上で3分後に自動実行できます（開発中）。</span>
        </div>
      </div>
    </article>
  )
}

/* ================= 自動化だけでは終わらない（4つの段階） ================= */

type Stage = { icon: LucideIcon; title: string; body: string; example: string; feature?: FeatureKey }

const STAGES: Stage[] = [
  { icon: ScanSearch, title: '見直す', body: 'その作業は本当に必要か。ムダや重複はないか。', example: '会議資料への転記は、今も使われている？', feature: 'kaizen' },
  { icon: Lightbulb, title: '改善する', body: '廃止・簡素化・標準化・自動化から、合う方法を選ぶ。', example: '転記をやめ、集計表をそのまま共有する', feature: 'kaizen' },
  { icon: Play, title: '実行する', body: '必要なExcel処理を組み立てて実行する。', example: '3つのファイルをまとめ、部署別に集計', feature: 'processing' },
  { icon: ListChecks, title: '確かめる', body: '完了基準に沿って、結果を確認する。', example: '集計の前後で売上の合計が一致するか', feature: 'criteria' },
]

function Stages() {
  return (
    <section id="flow" className="scroll-mt-16 bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading eyebrow="使い方" title="自動化だけでは終わらない" lead="月次の売上集計を例にした進め方です。見直し（1・2）は任意で、手順が決まっている作業は「実行する」から始められます。途中で切り替えても、作った内容は残ります。" />
        <ol className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map((s, i) => (
            <li key={s.title} className="relative flex flex-col rounded-2xl bg-panel p-5 ring-1 ring-edge">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-bold text-white">
                  <span className="grid size-7 place-items-center rounded-full bg-mint text-[0.85rem] text-on-mint">{i + 1}</span>
                  <s.icon className="size-5 text-mint" aria-hidden />
                  <span className="text-[1.15rem]">{s.title}</span>
                </span>
                {s.feature && <DevBadge feature={s.feature} />}
              </div>
              <p className="mt-2.5 flex-1 text-[0.95rem] leading-relaxed text-white/85">{s.body}</p>
              <p className="mt-3 hidden rounded-lg bg-canvas/70 px-3 py-2 text-[0.85rem] text-subtle ring-1 ring-edge sm:block">例：{s.example}</p>
              {i < STAGES.length - 1 && (
                <ArrowRight className="absolute top-1/2 -right-3 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-canvas text-mint xl:block" aria-hidden />
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 inline-flex items-center gap-1.5 text-[0.9rem] text-subtle">
          <RefreshCw className="size-4 text-mint" aria-hidden />
          作った手順と完了基準は保存でき、次からは新しいファイルを選んで、確かめながら実行できます。
        </p>
      </div>
    </section>
  )
}

/* ================= デモ ================= */

type Demo = { title: string; summary: string; inputs: string[]; outputs: string[] }

const DEMOS: Demo[] = [
  {
    title: '月次売上集計デモ',
    summary: '売上に商品・部署の情報を付け、部署別・カテゴリ別に集計。照合できない商品コードなどの問題も確認します。',
    inputs: ['売上実績.xlsx', '商品マスタ.xlsx', '部署マスタ.csv'],
    outputs: ['部署別・カテゴリ別の集計表', '照合漏れ・重複の確認結果'],
  },
  {
    title: '在庫差異検出デモ',
    summary: '入出庫履歴から理論上の在庫を計算し、在庫台帳と合わない商品を一覧にします。',
    inputs: ['在庫台帳.xlsx', '入出庫履歴.xlsx'],
    outputs: ['差異のある商品の一覧', '差異の件数と確認結果'],
  },
]

function Demos() {
  return (
    <section id="demo" className="scroll-mt-16 border-y border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading
          eyebrow="デモ"
          title="サンプルデータで、実際の処理を体験"
          lead="架空の業務データで、加工・集計から結果の確認まで、実際の処理を行います。"
        />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {DEMOS.map((d) => (
            <article key={d.title} className="flex flex-col rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[1.2rem] font-bold text-white">{d.title}</h3>
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
        <p className="mt-4 text-[0.88rem] text-subtle">AI業務改善診断を体験できるデモは、機能の完成後に追加する予定です。</p>
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
  { icon: Upload, title: 'ファイルを読み込んで作業する', body: 'Excel・CSVを読み込み、必要な処理を作って実行します。今回だけの作業なら、保存しなくてもかまいません。', feature: 'upload' },
  { icon: FolderOpen, title: '保存した作業手順を使う', body: '以前保存した手順を開き、新しいファイルで同じ処理と確認を行います。', feature: 'saveReuse' },
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
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14 lg:py-14">
        <div>
          <SectionHeading
            eyebrow="自分のExcelで試す"
            title="一度きりの作業でも、毎月の作業でも。"
            lead="作った手順は、必要なときだけ保存して再利用できます。保存しなければ使えない、ということはありません。"
          />
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

        {/*
          対応形式・AIの利用条件は、必要なときに確かめる補足情報。
          以前は明るいパネルで左側のボタンより目立っていたため、暗い面にそろえ、横幅もやや狭くした
        */}
        <div className="self-start rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6" aria-label="対応形式とAI機能の利用について">
          <h3 className="flex items-center gap-2 text-[1.05rem] font-bold text-white">
            <FileSpreadsheet className="size-5 text-mint" aria-hidden />
            対応形式
          </h3>
          <dl className="mt-3 divide-y divide-edge rounded-xl ring-1 ring-edge">
            {SPECS.map((s) => (
              <div key={s.k} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
                <dt className="text-[0.86rem] font-bold text-subtle">{s.k}</dt>
                <dd className="text-[0.92rem] text-white/90">{s.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-xl bg-mint-deep p-4 ring-1 ring-mint-line">
            <p className="flex items-center gap-2 font-bold text-mint-title">
              <KeyRound className="size-4.5" aria-hidden />
              AI機能の利用について
            </p>
            <p className="mt-1.5 text-[0.9rem] leading-relaxed text-mint-body">
              AIによる作業手順の作成や改善の提案には、<span className="font-bold text-white">AI使用パスワード</span>が必要です。AIを使う操作のときにだけ入力を求めます。
            </p>
            <p className="mt-1 text-[0.88rem] leading-relaxed text-subtle">ファイルの読み込みや、Excelの加工・集計など、AIを使わない機能はパスワードなしで使えます。</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ================= 処理できた、だけで終わらせない ================= */

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: '処理結果の整合性を確認', body: '結合で行が増えていないか、集計の前後で合計が合うかを、毎回自動で確認します。' },
  { icon: ListChecks, title: '業務の完了基準を設定', body: '対象期間・照合できない件数の上限など、業務ごとの条件を加えられます。' },
  { icon: TriangleAlert, title: '異常や未検証の項目を表示', body: '重大な問題があれば、結果を出力しません。確かめられなかった項目も隠しません。' },
  { icon: RefreshCw, title: '記録して、再利用', body: '確認の結果を記録し、保存した手順と基準で次回も同じ確認を行います。' },
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
          <SectionHeading eyebrow="品質の確認" title="処理できた、だけで終わらせない。" />
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
        <p className="mt-3 text-[0.85rem] text-subtle">
          確認できるのは、自動で行う確認と、設定した完了基準の範囲です。すべての誤りを見つけられるわけではありません。単発の作業にも同じ確認を行います。
        </p>
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

function SectionHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-[0.88rem] font-bold text-mint">{eyebrow}</p>
      <h2 className="mt-2 text-[1.6rem] leading-snug font-bold text-white sm:text-[2rem]">{title}</h2>
      {lead && <p className="mt-3 leading-relaxed text-subtle">{lead}</p>}
    </div>
  )
}
