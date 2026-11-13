import { ArrowRight, CircleCheck, Combine, FileSpreadsheet, Lightbulb, Play, RefreshCw, ScanSearch, ShieldCheck, Sigma, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
const W = HERO_VISUAL_W
const H = 484
const MINT = '#38D9AD'

// 各カードの位置（左の2枚と下の帯は下寄せ、右の2枚は上から。図全体の重心を中央に寄せる）
const REVIEW = { x: 0, y: 84, w: 224, h: 270 } // ①見直す
const IMPROVE = { x: 244, y: 76, w: 170, h: 286 } // ②改善する
const RUN = { x: 436, y: 0, w: 232, h: 190 } // ③実行する
const CHECK = { x: 436, y: 228, w: 232, h: 216 } // ④確かめる（下端を、保存・再実行の帯の下端にそろえる）
const LOOP = { x: 0, y: 404, w: IMPROVE.x + IMPROVE.w, h: 40 } // 保存・再実行の帯

export function HeroVisual() {
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

function CheckCard({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`light-panel flex flex-col rounded-xl p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-ink">
          <StageLabel n={4} label="確かめる" icon={ShieldCheck} />
        </span>
        <span className="text-[0.64rem] text-muted">完了基準</span>
      </div>
      <ul className="space-y-2 px-0.5 text-[0.78rem]">
        <CheckRow ok>集計前後の合計が一致</CheckRow>
        <CheckRow ok>対象期間外のデータ 0件</CheckRow>
        <CheckRow>照合できない商品コード 4件</CheckRow>
      </ul>
      <div className="mt-auto rounded-lg border-l-4 border-warning bg-warning-soft px-3 py-2.5 ring-1 ring-warning/30">
        <p className="flex items-center gap-1.5 text-[0.86rem] font-bold text-warning-ink">
          <TriangleAlert className="size-4" aria-hidden />
          品質判定：注意
        </p>
        <p className="mt-0.5 text-[0.7rem] text-ink/80">内容を確認してから、正式に出力</p>
      </div>
    </div>
  )
}

function CheckRow({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok ? (
        <CircleCheck className="size-3.5 shrink-0 text-success-ink" aria-label="満たしている" />
      ) : (
        <TriangleAlert className="size-3.5 shrink-0 text-warning-ink" aria-label="確認が必要" />
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
