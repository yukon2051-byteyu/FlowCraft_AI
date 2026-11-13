import {
  Building2,
  Cloud,
  Monitor,
  CalendarClock,
  Check,
  CircleCheck,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  FolderOpen,
  KeyRound,
  Lightbulb,
  ListChecks,
  Lock,
  Play,
  ScanSearch,
  ShieldCheck,
  CopyPlus,
  Repeat,
  TriangleAlert,
  Upload,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { isAvailable } from '../content/featureStatus'
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
 * 構成：ヒーロー → FlowCraft AIの6つの特徴 → 自動化だけでは終わらない（4つの段階）→ デモ → 自分のExcelで試す → 処理できた、だけで終わらせない
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

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-10 pb-12 sm:px-8 lg:pt-9 lg:pb-[37px] xl:grid-cols-[minmax(0,1fr)_640px] xl:gap-10">
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
        {/* 図（幅668px）は、列（640px）より28px広い。左端をそろえ、右端の余白の側へはみ出させる（見出しと重ならないように） */}
        {/* 画面幅 1340px 以上では③④を25px右へ動かすため、図の幅が 693px になり、右の余白へ（従来の 1.75rem ＋ 25px）はみ出させる。25px は HeroVisual の GROUP34_SHIFT、1340px は WIDE_HERO_QUERY と同じ */}
        <div className="hidden justify-center sm:flex xl:justify-end min-[1280px]:-mr-7 min-[1340px]:-mr-[calc(1.75rem+25px)]">
          <HeroVisual />
        </div>
        <div className="sm:hidden">
          <HeroVisualCompact />
        </div>
      </div>
    </section>
  )
}

/* ================= FlowCraft AIの6つの特徴 =================
 * 表示の番号は、画面での並び（左上の大きなカードが01）に合わせて、各カードのデータに明示的に持たせる。
 * 並び順から計算しない（カードの順番を変えても番号が勝手に変わらないように）。React の key はタイトル。
 */

type Reason = { no: string; icon: LucideIcon; title: string; body: ReactNode; feature: FeatureKey }

const REASONS: Reason[] = [
  {
    no: '02',
    icon: Workflow,
    title: 'AIの提案を、実行できる手順に',
    body: (
      <>
        日本語で伝えた作業を、<span className="font-semibold text-mint">編集・検証・実行できる手順</span>に変換。AIの回答だけで終わらせません。
      </>
    ),
    feature: 'aiFlow',
  },
  {
    no: '03',
    icon: ShieldCheck,
    title: '結果を検証できる',
    body: (
      <>
        完了基準で結果を確かめ、<span className="font-bold text-kaizen-text">期間外・照合漏れ・重複などの異常</span>を見つけます。重大なら出力を止めます。
      </>
    ),
    feature: 'criteria',
  },
  {
    no: '04',
    icon: Repeat,
    // 「同じ品質」ではなく「同じルール」：品質を保証するのではなく、同じ検証基準で毎回確かめる
    title: '一度作れば、次回も同じルールで',
    body: (
      <>
        処理手順と確認ルールをセットで保存。次回はデータを入れ替えるだけで、<span className="font-semibold text-mint">同じ条件で再実行</span>できます。
      </>
    ),
    feature: 'saveReuse',
  },
  {
    no: '05',
    icon: CopyPlus,
    title: '作業を部品として再利用できる',
    body: (
      <>
        作成済みの処理ステップを<span className="font-semibold text-mint">複製・組み合わせ・変更</span>。ゼロから作り直さず、別の業務にも活用できます。
      </>
    ),
    // 部品単位の保存・複製・組み合わせは未実装（作業手順全体の保存・再実行とは別の機能）
    feature: 'stepReuse',
  },
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
          eyebrow="FlowCraft AIの6つの特徴"
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
                <span className="text-[0.85rem] font-bold text-kaizen-text tabular-nums">01</span>
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
            {REASONS.map((r) => (
              <article key={r.title} className="rounded-2xl bg-panel p-5 ring-1 ring-edge">
                <div className="flex items-start justify-between gap-2">
                  <span className="grid size-10 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
                    <r.icon className="size-5" aria-hidden />
                  </span>
                  <DevBadge feature={r.feature} />
                </div>
                <h3 className="mt-3 flex items-baseline gap-2 text-[1.08rem] font-bold text-white">
                  <span className="text-[0.8rem] text-subtle/70 tabular-nums">{r.no}</span>
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
      className="mt-4 grid gap-x-6 gap-y-4 rounded-2xl bg-panel p-5 ring-1 ring-edge sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center"
    >
      <div>
        {/* 利用者が得られるメリットを見出しに（技術的な説明は後ろ）。最も伝えたいのは「正常時は、結果を確認するだけ。」 */}
        <div className="flex items-center gap-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint/12 text-mint ring-1 ring-mint/30">
            <CalendarClock className="size-5" aria-hidden />
          </span>
          <span className="text-[0.8rem] text-subtle/70 tabular-nums">06</span>
          <h3 className="min-w-0 flex-1 text-[1.2rem] leading-snug font-bold text-white">毎月のExcel作業を、確認するだけの業務へ。</h3>
          <span className="shrink-0">
            <DevBadge feature="schedule" />
          </span>
        </div>
        <p className="mt-3 text-[0.92rem] leading-relaxed text-subtle">ファイルの取得から加工・集計、品質検証、保存まで、決まった日時に自動実行します。</p>
        <div className="mt-3 rounded-xl border px-4 py-3" style={{ backgroundColor: '#17362E', borderColor: '#327D69' }} aria-label="正常時は、結果を確認するだけ">
          <p className="flex items-center gap-2 text-[1.12rem] font-bold" style={{ color: '#39D9AD' }}>
            <CircleCheck className="size-5 shrink-0" aria-hidden />
            正常時は、結果を確認するだけ。
          </p>
          <p className="mt-1 text-[0.86rem] leading-relaxed" style={{ color: '#D1DED8' }}>
            異常があれば<span className="font-bold text-kaizen-text">正式な出力を止め</span>、確認が必要なことをお知らせします。
          </p>
        </div>
      </div>
      <div>
        <p className="text-[0.85rem] font-bold text-white/90">設定しただけでは動きません。5つの確認を通ってから始めます</p>
        <ol className="mt-2 grid grid-cols-5 gap-1.5" aria-label="無人で実行する前の5つの確認">
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
      </div>

      {/* 試し方の3つの区分：今使えるものと、対応予定のものを混同させない（docs/windows-worker-design.md §7） */}
      <ul className="grid gap-2.5 border-t border-edge pt-4 lg:col-span-2 lg:grid-cols-3" aria-label="無人実行の試し方">
        <li className="rounded-xl bg-panel-hi p-3.5 ring-1 ring-edge">
          <p className="flex flex-wrap items-center gap-1.5 text-[0.92rem] font-bold text-white">
            <Cloud className="size-4 text-mint" aria-hidden />
            {isAvailable('scheduleCloud') ? '今すぐ試せる' : 'クラウドで試す'}
            <DevBadge feature="scheduleCloud" />
          </p>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-subtle">サンプルのExcelを、クラウド上で3分後に実際に処理。ブラウザを閉じても実行されます。</p>
          <div className="mt-2.5">
            <Button variant="outlineDark" size="sm" disabled={!isAvailable('scheduleCloud')} title="開発中です。完成後、サンプルデータで試せます">
              <CalendarClock className="size-4" aria-hidden />
              3分後に自動実行を試す
            </Button>
          </div>
        </li>
        <li className="rounded-xl bg-panel-hi p-3.5 ring-1 ring-edge">
          <p className="flex flex-wrap items-center gap-1.5 text-[0.92rem] font-bold text-white">
            <Monitor className="size-4 text-mint" aria-hidden />
            Windows Workerで試せる
            <DevBadge feature="scheduleWindows" />
          </p>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-subtle">PC内のExcel・CSVを、指定時刻に自動で処理・検証・保存。ファイルはPCの外に出ません。</p>
        </li>
        <li className="rounded-xl p-3.5 ring-1 ring-edge ring-dashed">
          <p className="flex flex-wrap items-center gap-1.5 text-[0.92rem] font-bold text-white/85">
            <Building2 className="size-4 text-subtle" aria-hidden />
            製品版で対応予定
          </p>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-subtle">社内共有フォルダや、企業内サーバーでの無人定期実行に対応予定です。</p>
        </li>
      </ul>
    </article>
  )
}

/* ================= 自動化だけでは終わらない（4つの段階） ================= */

/*
 * ヒーローの図（見直す→改善する→実行する→確かめる）と同じ並びを繰り返さず、「なぜこの順番なのか」を伝える。
 * 見直さずに自動化したとき（コーラル＝ムダ・リスク）と、見直してから自動化したとき（ミント＝改善後）を比べる。
 */
const WITHOUT_REVIEW = ['使われていない会議資料への転記も、毎月そのまま自動で繰り返す', '同じ集計を2つの表で作る重複が、そのまま残る', '誤ったデータでも、速く・大量に結果を出してしまう']
const WITH_REVIEW = ['やめられる作業はやめ、残った作業だけを自動化する', '手順を1つにまとめ、毎回同じ処理を行う', '完了基準で、結果の正しさまで確かめてから出力する']

type Stage = { icon: LucideIcon; title: string; why: string; feature?: FeatureKey }

const STAGES: Stage[] = [
  { icon: ScanSearch, title: '見直す', why: 'ムダな作業を自動化しないため', feature: 'kaizen' },
  { icon: Lightbulb, title: '改善する', why: '手順を少なく、そろえるため', feature: 'kaizen' },
  { icon: Play, title: '実行する', why: '決めた手順で、毎回同じ処理をするため', feature: 'processing' },
  { icon: ListChecks, title: '確かめる', why: '「処理できた」と「正しい」は違うため', feature: 'criteria' },
]

function Stages() {
  return (
    <section id="flow" className="scroll-mt-16 bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <SectionHeading
          eyebrow="使い方"
          title="自動化だけでは終わらない"
          lead="見直さずに自動化すると、ムダな作業や誤りまで、毎月自動で繰り返してしまいます。だから FlowCraft AI は、自動化の前に見直し、自動化の後に確かめます。"
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-kaizen/6 p-5 ring-1 ring-kaizen/35" aria-label="見直さずに自動化すると">
            <p className="flex items-center gap-2 font-bold text-kaizen-text">
              <TriangleAlert className="size-5" aria-hidden />
              見直さずに自動化すると
            </p>
            <ul className="mt-3 space-y-2">
              {WITHOUT_REVIEW.map((t) => (
                <li key={t} className="flex gap-2 text-[0.95rem] leading-relaxed text-white/85">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-kaizen" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-mint/6 p-5 ring-1 ring-mint/35" aria-label="見直してから自動化すると">
            <p className="flex items-center gap-2 font-bold text-mint">
              <CircleCheck className="size-5" aria-hidden />
              見直してから自動化すると
            </p>
            <ul className="mt-3 space-y-2">
              {WITH_REVIEW.map((t) => (
                <li key={t} className="flex gap-2 text-[0.95rem] leading-relaxed text-white/85">
                  <Check className="mt-1 size-4 shrink-0 text-mint" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ol className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="4つの段階と、その理由">
          {STAGES.map((st, i) => (
            <li key={st.title} className="flex items-center gap-3 rounded-xl bg-panel px-4 py-3 ring-1 ring-edge">
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[0.85rem] font-bold ${i === 0 ? 'bg-kaizen text-canvas' : 'bg-mint text-on-mint'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold text-white">
                  {st.title}
                  {st.feature && <DevBadge feature={st.feature} />}
                </p>
                <p className="text-[0.86rem] text-subtle">{st.why}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[0.88rem] text-subtle">見直し（1・2）は任意です。手順が決まっている作業は「実行する」から始められ、途中で切り替えても作った内容は残ります。</p>
      </div>
    </section>
  )
}

/* ================= デモ ================= */

/*
 * デモ（docs/demo-design.md）：案件ごとに「正常終了」と「品質異常」を選べる。品質異常の原因は案件ごとに変える。
 * 色の意味：ミント＝正常・成功、コーラル＝異常・リスク（ページ全体で統一）。デモはまだ動かないため「開発中」で押せない。
 */
type Demo = { id: string; feature: FeatureKey; title: string; summary: string; inputs: string; ok: string; ng: string }

const DEMOS: Demo[] = [
  {
    id: 'monthly_sales',
    feature: 'demo',
    title: '月次売上集計デモ',
    summary: '売上に商品・部署の情報を付け、部署別に集計します。',
    inputs: '売上実績・商品マスタ・部署マスタ',
    ok: '対象月（10月）の伝票だけを集計・検証・出力',
    ng: '10月分に混ざった11月の伝票を検出 → 出力を停止',
  },
  {
    id: 'product_match',
    feature: 'demoProductMatch',
    title: '商品マスタ照合デモ',
    summary: '売上の商品コードを商品マスタと照合し、商品名・カテゴリを付けます。',
    inputs: '売上実績・商品マスタ',
    ok: 'すべての商品コードを照合して出力',
    ng: '未登録コード・表記揺れを検出 → 原因ごとの直し方',
  },
  {
    id: 'inventory',
    feature: 'demoInventory',
    title: '在庫差異検出デモ',
    summary: '入出庫履歴から理論上の在庫を計算し、在庫台帳と合わない商品を一覧にします。',
    inputs: '在庫台帳・入出庫履歴',
    ok: '差異の一覧を作り、検証して出力',
    ng: '伝票番号の重複（二重計上）を検出 → 出力を停止',
  },
]

function Demos() {
  return (
    <section id="demo" className="scroll-mt-16 border-y border-edge/60 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 lg:py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading
            eyebrow="デモ"
            title="正常終了も、品質異常の検出も体験できる"
            lead="架空の業務データで、実際の処理と品質の確認を行います。問題を含むデータでは、異常を見つけ、根拠を示し、誤った結果の出力を止めます。"
          />
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {DEMOS.map((d) => (
            <article key={d.title} className="flex flex-col rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label={d.title}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[1.15rem] font-bold text-white">{d.title}</h3>
                <DevBadge feature={d.feature} />
              </div>
              <p className="mt-1.5 text-[0.92rem] leading-relaxed text-subtle">{d.summary}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[0.85rem] text-white/75">
                <FileSpreadsheet className="size-4 shrink-0 text-subtle" aria-hidden />
                {d.inputs}
              </p>
              <div className="mt-4 grid flex-1 grid-cols-2 gap-2.5" role="group" aria-label={`${d.title}の体験の選び方`}>
                <DemoChoice to={`/build?demo=${d.id}&pattern=ok`} ready={isAvailable(d.feature)} className="bg-mint/8 ring-mint/40 hover:bg-mint/15">
                  <span className="flex items-center gap-1.5 font-bold text-mint">
                    <CircleCheck className="size-4.5" aria-hidden />
                    正常終了
                  </span>
                  <span className="mt-1 text-[0.82rem] leading-snug text-white/80">{d.ok}</span>
                </DemoChoice>
                <DemoChoice to={`/build?demo=${d.id}&pattern=ng`} ready={isAvailable(d.feature)} className="bg-kaizen/8 ring-kaizen/45 hover:bg-kaizen/15">
                  <span className="flex items-center gap-1.5 font-bold text-kaizen-text">
                    <TriangleAlert className="size-4.5" aria-hidden />
                    品質異常
                  </span>
                  <span className="mt-1 text-[0.82rem] leading-snug text-white/80">{d.ng}</span>
                </DemoChoice>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-4 text-[0.88rem] text-subtle">
          品質異常のデモでは、問題を直したデータで再実行し、直す前と後の結果を比べることもできる予定です。AI業務改善診断のデモは、機能の完成後に追加します。
        </p>
      </div>
    </section>
  )
}

/** デモの「正常終了」「品質異常」の選択肢。使えるときはデモの開始へのリンク、開発中は押せない */
function DemoChoice({ to, ready, className, children }: { to: string; ready: boolean; className: string; children: ReactNode }) {
  const base = `flex flex-col rounded-xl p-3 text-left ring-1 transition ${className}`
  if (!ready) {
    return (
      <span aria-disabled="true" title="このデモは開発中です" className={`${base} cursor-not-allowed opacity-60 hover:bg-transparent`}>
        {children}
      </span>
    )
  }
  return (
    <Link to={to} className={`${base} focus-visible:outline-2 focus-visible:outline-mint`}>
      {children}
    </Link>
  )
}

/* ================= 自分のExcelで試す ================= */

type StartWay = { icon: LucideIcon; title: string; body: string; feature: FeatureKey }

const START_WAYS: StartWay[] = [
  { icon: Upload, title: '今回だけ実行する', body: '読み込んで、手順を作り、実行して、Excelに出力して終わり。保存は必要ありません。', feature: 'upload' },
  { icon: FolderOpen, title: '手順を保存して、必要なときに再実行する', body: '保存した手順を開き、新しいファイルを選ぶだけ。完了基準も一緒に使い、同じ確認を行います。', feature: 'saveReuse' },
  { icon: CalendarClock, title: '決まった日時に、無人で実行する', body: '保存した手順と完了基準を、指定した日時に自動で実行します。問題があれば出力を止めます。', feature: 'schedule' },
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
            lead="使い方は3つ。今回だけの作業は保存しなくても終われます。毎月の作業は、保存して再実行するか、決まった日時に無人で実行します。"
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
                    {isAvailable(w.feature) ? (
                      <span className="rounded-full bg-mint/12 px-2 py-0.5 text-[0.75rem] font-bold text-mint ring-1 ring-mint/35">利用可能</span>
                    ) : (
                      <DevBadge feature={w.feature} />
                    )}
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

/** 見つける品質異常の例（コーラル＝異常・リスク） */
const ANOMALIES = ['集計結果の不一致', '商品コードの照合漏れ', '必須項目の欠損', '対象期間外のデータ', '重複データ']

/** 見つけてから止めるまで */
const TRUST_FLOW: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ScanSearch, title: '検出する', body: '自動で行う確認（結合で行が増えていないか、集計前後の合計など）と、業務ごとの完了基準を、毎回プログラムで確かめます。' },
  { icon: ListChecks, title: '根拠と原因を示す', body: '件数・該当する行・判定の理由を示します。照合漏れは「空白」「マスタにない」「空欄」など原因ごとに分けます。' },
  { icon: ShieldCheck, title: '出力を止める', body: '重大な問題があれば、正式な結果を出力しません。原因を調べるための確認結果だけを出力できます。' },
]

/** 判定の色（ページ全体で同じ意味） */
const VERDICTS: { label: string; note: string; cls: string }[] = [
  { label: '正常', note: 'そのまま出力', cls: 'bg-mint/12 text-mint ring-mint/40' },
  { label: '注意・未検証', note: '確認してから出力', cls: 'bg-warning/12 text-warning ring-warning/40' },
  { label: '重大', note: '出力を停止', cls: 'bg-kaizen/12 text-kaizen-text ring-kaizen/45' },
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
          <SectionHeading eyebrow="品質の確認" title="処理できた、だけで終わらせない。" lead="エラーなく処理が終わっても、業務として正しいとは限りません。問題を見つけ、根拠を示し、誤った結果の出力を止めます。" />
          <DevBadge feature="quality" className="mb-1" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="見つける品質異常の例">
            <p className="flex items-center gap-2 font-bold text-white">
              <TriangleAlert className="size-4.5 text-kaizen" aria-hidden />
              こんな品質異常を見つけます
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {ANOMALIES.map((a) => (
                <li key={a} className="rounded-full bg-kaizen/10 px-3 py-1 text-[0.88rem] font-bold text-kaizen-text ring-1 ring-kaizen/40">
                  {a}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[0.85rem] font-bold text-white/85">判定と出力</p>
            <ul className="mt-2 grid grid-cols-3 gap-2" aria-label="判定と出力">
              {VERDICTS.map((v) => (
                <li key={v.label} className={`rounded-lg px-2.5 py-2 text-center ring-1 ${v.cls}`}>
                  <span className="block text-[0.9rem] font-bold">{v.label}</span>
                  <span className="block text-[0.78rem] text-white/75">{v.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3" aria-label="見つけてから止めるまで">
            {TRUST_FLOW.map((t, i) => (
              <li key={t.title} className="rounded-2xl bg-panel p-4 ring-1 ring-edge">
                <p className="flex items-center gap-2 font-bold text-white">
                  <span className="grid size-6 place-items-center rounded-full bg-white/10 text-[0.8rem]">{i + 1}</span>
                  <t.icon className={`size-4.5 ${i === 2 ? 'text-kaizen' : 'text-mint'}`} aria-hidden />
                  {t.title}
                </p>
                <p className="mt-2 text-[0.88rem] leading-relaxed text-subtle">{t.body}</p>
              </li>
            ))}
          </ol>
        </div>
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
