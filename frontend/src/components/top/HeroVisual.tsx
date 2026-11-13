import { ArrowRight, CircleCheck, Combine, FileSpreadsheet, Lightbulb, Play, RefreshCw, ScanSearch, ShieldCheck, Sigma, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/*
 * ヒーロー右側のビジュアル（TOP全面改修：見直す → 改善する → 実行する → 確かめる）。
 *
 *   ①見直す（今の作業）──→ ②改善する（廃止・簡素化・標準化・自動化）──→ ③実行する（作業手順）
 *                                                                          ↓
 *   ↻ 保存して、次回も確認して実行・改善を続ける                         ④確かめる（完了基準）
 *
 * 2026-11-13 改修：接続線を3本とも同じ「流れる点線」に統一（矢印を廃止）、④の品質判定を強調、③に「保存した手順で再実行」、
 * 下の帯の文言を「手順と品質ルールを保存。次回から安全に再実行。」に。右下の余白を使ってカードを約7〜10%大きくした
 * （図の枠は 640×460 → 668×484。左端の位置は変えず、右端の余白の側へ28px広げる〔見出しと重ならないように〕。
 *   高さは、ヒーローの上下の余白を減らして、ヒーロー全体の高さを変えない）。
 * 図は考え方のイメージ。数値・業務名は架空。
 *
 * PC・タブレット（幅640px以上）：HeroVisual ／ スマートフォン：HeroVisualCompact
 */

export const HERO_VISUAL_W = 668
const H = 484

/*
 * ③④のグループと②の間を広げる量（2026-11-13）。③④はいつも同じ量だけ一緒に動かす（左端と上下の位置はそろえたまま）。
 * 右に動かすと図が右の余白へはみ出すため、右の余白が足りる画面幅（1340px 以上）のときだけ動かす。
 * 1280〜1339px では今までの位置（③④の右端が切れないように）。この幅と量は TopPage の min-[1340px]:-mr-[calc(1.75rem+25px)] と同じ。
 */
export const WIDE_HERO_QUERY = '(min-width: 1340px)'
const GROUP34_SHIFT = 25

function subscribeWide(onChange: () => void) {
  const m = window.matchMedia(WIDE_HERO_QUERY)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
/** 画面幅が 1340px 以上か（変わったら描き直す） */
function useWideHero(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_HERO_QUERY).matches, () => false)
}
const MINT = '#38D9AD'

/*
 * 配置の基準：TOP は、図の上端（③の上端）を、左の「FLOWCRAFT AI — EXCEL業務改善」の上端にそろえるための値。
 * ヒーローは図と左の文章を上下中央にそろえているため、図（高さ H）と左の文章の高さの差の半分だけ、図の中身を下げる
 * （実測：1366・1920px とも 25px）。カードも接続線も、すべてこの値を基準に置く（場当たり的にずらさない）。
 * 下げた分、④と保存の帯の下の余白が減り、図の重心が下がる。
 */
const TOP = 25
// 各カードの位置（左の2枚と下の帯は下寄せ、右の2枚は上から）
const REVIEW = { x: 0, y: TOP + 84, w: 224, h: 270 } // ①見直す
const IMPROVE = { x: 244, y: TOP + 76, w: 170, h: 286 } // ②改善する
const GROUP34_X = 436 // ③④の左端（動かす前）
const RUN_BASE = { y: TOP, w: 232, h: 190 } // ③実行する
const CHECK_BASE = { y: TOP + 240, w: 232, h: 204 } // ④確かめる（下端を、保存・再実行の帯の下端にそろえる）
const LOOP = { x: 0, y: TOP + 404, w: IMPROVE.x + IMPROVE.w, h: 40 } // 保存・再実行の帯

export function HeroVisual() {
  const shift = useWideHero() ? GROUP34_SHIFT : 0
  const W = HERO_VISUAL_W + shift
  const RUN = { ...RUN_BASE, x: GROUP34_X + shift }
  const CHECK = { ...CHECK_BASE, x: GROUP34_X + shift }
  const reviewMid = REVIEW.y + REVIEW.h / 2
  const improveMid = IMPROVE.y + IMPROVE.h / 2
  const runMid = RUN.y + RUN.h / 2
  const improveRight = IMPROVE.x + IMPROVE.w
  const runCenter = RUN.x + RUN.w / 2
  const gap23 = RUN.x - improveRight
  return (
    <div
      className="relative shrink-0"
      style={{ width: W, height: H }}
      role="img"
      aria-label="FlowCraft AIの考え方：今のExcel作業を見直し、廃止・簡素化・標準化・自動化から改善の方法を選び、必要な処理を実行して、完了基準で結果を確かめる。手順と品質ルールを保存し、次回から安全に再実行できる"
    >
      <div className="pointer-events-none absolute top-1/2 left-[52%] h-[440px] w-[610px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,217,173,0.14),transparent)]" />

      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} aria-hidden>
        {/* ①見直す → ②改善する（右へ） */}
        <FlowLine d={`M${REVIEW.w} ${reviewMid} C ${REVIEW.w + 10} ${reviewMid}, ${IMPROVE.x - 10} ${improveMid}, ${IMPROVE.x} ${improveMid}`} />
        {/* ②改善する → ③実行する（右上へ） */}
        <FlowLine d={`M${improveRight} ${improveMid} C ${improveRight + gap23 * 0.9} ${improveMid}, ${RUN.x - gap23 * 0.9} ${runMid}, ${RUN.x} ${runMid}`} />
        {/* ③実行する → ④確かめる（下へ） */}
        <FlowLine d={`M${runCenter} ${RUN.y + RUN.h} L${runCenter} ${CHECK.y}`} />
      </svg>

      <ReviewCard className="absolute" style={{ left: REVIEW.x, top: REVIEW.y, width: REVIEW.w, height: REVIEW.h }} />
      <ImproveCard className="absolute" style={{ left: IMPROVE.x, top: IMPROVE.y, width: IMPROVE.w, height: IMPROVE.h }} />
      <RunCard className="absolute" style={{ left: RUN.x, top: RUN.y, width: RUN.w, height: RUN.h }} />
      <CheckCard className="absolute" style={{ left: CHECK.x, top: CHECK.y, width: CHECK.w, height: CHECK.h }} />
      <LoopPill className="absolute" style={{ left: LOOP.x, top: LOOP.y, width: LOOP.w, height: LOOP.h }} />
    </div>
  )
}

/**
 * カードどうしをつなぐ線（3本とも共通）。始点から終点の向きに点線が流れる。
 * 下に淡い光（太い半透明の線）を敷き、上に点線を重ねる。線幅・点線の間隔・速さ・色はここだけで決める。
 * 「動きを減らす」設定の利用者には、動かない点線にする（motion-safe）。
 */
function FlowLine({ d }: { d: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke={MINT} strokeOpacity="0.18" strokeWidth="6" strokeLinecap="round" />
      <path d={d} fill="none" stroke={MINT} strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" className="motion-safe:animate-[flow-dash_1.2s_linear_infinite]" />
    </g>
  )
}

/** スマートフォン用の簡易版：見直す → 改善する → 実行する → 確かめる */
const PHASES: { icon: LucideIcon; label: string }[] = [
  { icon: ScanSearch, label: '見直す' },
  { icon: Lightbulb, label: '改善する' },
  { icon: Play, label: '実行する' },
  { icon: ShieldCheck, label: '確かめる' },
]

export function HeroVisualCompact() {
  return (
    <div
      className="rounded-2xl bg-panel p-4 ring-1 ring-edge"
      role="img"
      aria-label="FlowCraft AIの考え方：見直す、改善する、実行する、確かめる。保存して改善を続けられる"
    >
      <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
        {PHASES.map(({ icon: Icon, label }, i) => (
          <li key={label} className="contents">
            <span className={`flex flex-col items-center gap-1 rounded-lg bg-panel-hi px-1 py-2.5 ${i === 0 ? 'ring-1 ring-kaizen/40' : ''}`}>
              <Icon className={`size-4.5 ${i === 0 ? 'text-kaizen' : 'text-mint'}`} aria-hidden />
              <span className="text-[0.75rem] whitespace-nowrap text-white">{label}</span>
            </span>
            {i < PHASES.length - 1 && <ArrowRight className="size-3.5 text-mint" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="mt-3 flex items-center justify-center gap-1 text-[0.78rem] font-bold text-mint">
        <RefreshCw className="size-3.5" aria-hidden />
        保存して、改善を続けられる
      </p>
    </div>
  )
}

/* ---------- 部品 ---------- */

type BoxProps = { className?: string; style?: CSSProperties }

function StageLabel({ n, label, icon: Icon, tone = 'mint' }: { n: number; label: string; icon: LucideIcon; tone?: 'mint' | 'kaizen' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8rem] font-bold">
      <span className={`grid size-5 place-items-center rounded-full text-[0.66rem] ${tone === 'kaizen' ? 'bg-kaizen text-canvas' : 'bg-mint text-on-mint'}`}>{n}</span>
      <Icon className={`size-3.5 ${tone === 'kaizen' ? 'text-kaizen' : 'text-mint'}`} aria-hidden />
      {label}
    </span>
  )
}

/** 今の作業。ムダ・重複・要確認の印を付ける */
const CURRENT: { label: string; tag?: { text: string; tone: 'warn' | 'ask' } }[] = [
  { label: '各部署のExcelを集める' },
  { label: '列をコピーして貼り付け', tag: { text: 'ムダ', tone: 'warn' } },
  { label: '同じ集計を2つの表で作成', tag: { text: '重複', tone: 'warn' } },
  { label: '部署別に集計する' },
  { label: '会議資料に転記', tag: { text: '必要？', tone: 'ask' } },
]

function ReviewCard({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`rounded-2xl bg-panel p-3 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ring-1 ring-kaizen/35 ${className}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <StageLabel n={1} label="見直す" icon={ScanSearch} tone="kaizen" />
        <span className="text-[0.66rem] text-subtle">今の作業</span>
      </div>
      <ol className="space-y-1.5">
        {CURRENT.map((c) => (
          <li
            key={c.label}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-[0.62rem] ${c.tag?.tone === 'warn' ? 'bg-kaizen/10 ring-1 ring-kaizen/30' : c.tag ? 'border border-dashed border-kaizen/45 bg-panel-hi' : 'bg-panel-hi'}`}
          >
            <FileSpreadsheet className="size-3.5 shrink-0 text-subtle" aria-hidden />
            <span className={`flex-1 text-[0.76rem] whitespace-nowrap ${c.tag?.tone === 'warn' ? 'text-white/70 line-through decoration-kaizen/70' : ''}`}>{c.label}</span>
            {c.tag && (
              <span
                className={`rounded-full px-1.5 py-px text-[0.62rem] font-bold whitespace-nowrap ${c.tag.tone === 'warn' ? 'bg-kaizen/20 text-kaizen-text' : 'text-kaizen-text ring-1 ring-kaizen/45'}`}
              >
                {c.tag.text}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

const WAYS: { label: string; note: string; active?: boolean }[] = [
  { label: '廃止', note: '転記をやめる' },
  { label: '簡素化', note: '集計を1つに' },
  { label: '標準化', note: '提出形式をそろえる' },
  { label: '自動化', note: '集計を手順に', active: true },
]

function ImproveCard({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`rounded-2xl bg-panel p-3 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ring-1 ring-mint/30 ${className}`}>
      <div className="mb-2 px-1">
        <StageLabel n={2} label="改善する" icon={Lightbulb} />
      </div>
      <ul className="space-y-1.5">
        {WAYS.map((w) => (
          <li key={w.label} className={`rounded-lg px-2.5 py-[0.42rem] ${w.active ? 'bg-mint/15 ring-1 ring-mint/40' : 'bg-panel-hi'}`}>
            <span className={`block text-[0.8rem] font-bold ${w.active ? 'text-mint' : ''}`}>{w.label}</span>
            <span className="block text-[0.68rem] whitespace-nowrap text-subtle">{w.note}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const RUN_STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: FileSpreadsheet, label: '3つのファイルを読み込む' },
  { icon: Combine, label: '商品マスタの情報を付ける' },
  { icon: Sigma, label: '部署別に集計する' },
]

function RunCard({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`rounded-2xl bg-panel p-3 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ring-1 ring-edge ${className}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <StageLabel n={3} label="実行する" icon={Play} />
        <span className="text-[0.66rem] text-subtle">作業手順</span>
      </div>
      <ol className="space-y-1.5">
        {RUN_STEPS.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex items-center gap-2 rounded-lg bg-panel-hi px-2.5 py-[0.48rem]">
            <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-white/10 text-[0.62rem] font-bold">{i + 1}</span>
            <Icon className="size-3.5 shrink-0 text-mint" aria-hidden />
            <span className="text-[0.76rem] whitespace-nowrap">{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-[0.68rem] whitespace-nowrap text-subtle">
        <RefreshCw className="size-3 shrink-0 text-mint" aria-hidden />
        保存した手順で、毎月そのまま再実行
      </p>
    </div>
  )
}

/*
 * ④確かめる（2026-11-13：白い背景をやめ、①〜③と同じ暗い面に。わずかに緑を含む背景と細いミントの枠で、品質の確認を目立たせる）
 * 判定の状態ごとの色をまとめておく（正常＝ミント、注意＝ゴールド、重大＝コーラル）。ヒーローの見本は「注意」。
 */
const CHECK_CARD = { bg: '#252D2C', border: '#397568', text: '#F3F6F5', sub: '#B4C2BE' }
const VERDICT_TONE = {
  normal: { label: '正常', bg: '#203A33', border: '#2F7A65', title: '#39D9AD', sub: '#CBE9DF', icon: CircleCheck },
  caution: { label: '注意', bg: '#423527', border: '#7B5A32', title: '#F2BE70', sub: '#E5D7C3', icon: TriangleAlert },
  critical: { label: '重大', bg: '#432A2A', border: '#8A4A47', title: '#E89A95', sub: '#EBD3D1', icon: TriangleAlert },
} as const
const ICON = { ok: '#39D9AD', caution: '#D6A64D' }

function CheckCard({ className = '', style, verdict = 'caution' }: BoxProps & { verdict?: keyof typeof VERDICT_TONE }) {
  const tone = VERDICT_TONE[verdict]
  const VerdictIcon = tone.icon
  return (
    <div
      style={{ ...style, backgroundColor: CHECK_CARD.bg, borderColor: CHECK_CARD.border, color: CHECK_CARD.text }}
      className={`flex flex-col rounded-xl border p-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <StageLabel n={4} label="確かめる" icon={ShieldCheck} />
        <span className="text-[0.64rem]" style={{ color: CHECK_CARD.sub }}>
          完了基準
        </span>
      </div>
      <ul className="space-y-2 px-0.5 text-[0.78rem]">
        <CheckRow ok>集計前後の合計が一致</CheckRow>
        <CheckRow ok>対象期間外のデータ 0件</CheckRow>
        <CheckRow>
          照合できない商品コード <span className="font-bold" style={{ color: ICON.caution }}>4件</span>
        </CheckRow>
      </ul>
      <div className="mt-auto rounded-lg border px-3 py-2.5" style={{ backgroundColor: tone.bg, borderColor: tone.border }}>
        <p className="flex items-center gap-1.5 text-[0.86rem] font-bold" style={{ color: tone.title }}>
          <VerdictIcon className="size-4" aria-hidden />
          品質判定：{tone.label}
        </p>
        <p className="mt-0.5 text-[0.7rem]" style={{ color: tone.sub }}>
          内容を確認してから、正式に出力
        </p>
      </div>
    </div>
  )
}

function CheckRow({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok ? (
        <CircleCheck className="size-3.5 shrink-0" style={{ color: ICON.ok }} aria-label="満たしている" />
      ) : (
        <TriangleAlert className="size-3.5 shrink-0" style={{ color: ICON.caution }} aria-label="確認が必要" />
      )}
      <span className="whitespace-nowrap">{children}</span>
    </li>
  )
}

function LoopPill({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`flex items-center justify-center gap-2 rounded-full bg-mint/10 text-[0.86rem] font-bold text-mint ring-1 ring-mint/35 ${className}`}>
      <RefreshCw className="size-4" aria-hidden />
      手順と品質ルールを保存。次回から安全に再実行。
    </div>
  )
}
