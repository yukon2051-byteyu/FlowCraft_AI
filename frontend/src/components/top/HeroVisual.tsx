import { ArrowRight, ChartColumn, CircleCheck, Columns3, Combine, FileOutput, RefreshCw, SendHorizontal, Sheet, Sigma, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

/*
 * ヒーロー右側の製品ビジュアル（TOP改修 Ver.2.0 §4）。
 *
 *   Excel・CSV ──→ 作業手順（処理ステップ）──→ 集計表 / グラフ / 分析結果
 *                      ↑ AIは「手順を提案」するだけ
 *                      ↻ 作業手順を保存・再実行
 *
 * AIの指示欄は「作業手順」のカードだけにつなぎ、データや数値にはつながない
 * （計算するのはAIではなく処理エンジンであることを、図の上でも正しく表すため）。
 * 処理カードは暗いパネル、データ・グラフ・分析結果は明るいパネル。
 *
 * PC・タブレット（幅640px以上）：640×460px の構図（HeroVisual）
 * スマートフォン：4つの段階を並べた簡易版（HeroVisualCompact）
 */

const W = 640
const H = 460
const MINT = '#38D9AD'

const INPUTS = [
  { name: '売上_東京', ext: '.xlsx', y: 150 },
  { name: '売上_大阪', ext: '.xlsx', y: 214 },
  { name: '商品マスタ', ext: '.csv', y: 278 },
]
const TILE = { w: 112, h: 52 }
const FLOW = { x: 156, y: 122, w: 244, h: 214 } // 作業手順のカード
const OUT_X = 440 // 出力カードの左端
const OUTS = [
  { y: 22, h: 162 }, // 集計表
  { y: 198, h: 118 }, // グラフ
  { y: 330, h: 104 }, // 分析結果
]

export function HeroVisual() {
  const flowMidY = FLOW.y + FLOW.h / 2
  const flowRight = FLOW.x + FLOW.w
  return (
    <div
      className="relative shrink-0"
      style={{ width: W, height: H }}
      role="img"
      aria-label="FlowCraft AIの処理イメージ：複数のExcel・CSVを、AIが提案した作業手順で加工・集計し、集計表・グラフ・分析結果を出力する。作業手順は保存して再実行できる"
    >
      <div className="pointer-events-none absolute top-1/2 left-[45%] h-[420px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,217,173,0.14),transparent)]" />

      <svg className="pointer-events-none absolute inset-0" width={W} height={H} aria-hidden>
        {/* 入力 → 作業手順 */}
        {INPUTS.map((f) => {
          const y = f.y + TILE.h / 2
          return (
            <path
              key={f.name}
              d={`M${TILE.w} ${y} C ${TILE.w + 26} ${y}, ${FLOW.x - 26} ${flowMidY}, ${FLOW.x} ${flowMidY}`}
              fill="none"
              stroke={MINT}
              strokeWidth="2"
              strokeDasharray="6 5"
              className="motion-safe:animate-[flow-dash_1.2s_linear_infinite]"
            />
          )
        })}
        {/* AIの指示 → 作業手順（提案だけ。点線で区別） */}
        <path d={`M${FLOW.x + 60} 86 V${FLOW.y}`} stroke={MINT} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.7" />
        {/* 作業手順 → 出力 */}
        {OUTS.map((o) => {
          const y = o.y + 34
          return (
            <g key={o.y}>
              <path d={`M${flowRight} ${flowMidY} C ${flowRight + 22} ${flowMidY}, ${OUT_X - 22} ${y}, ${OUT_X} ${y}`} fill="none" stroke={MINT} strokeWidth="2" />
              <path d={`M${OUT_X - 6} ${y - 4} L${OUT_X} ${y} L${OUT_X - 6} ${y + 4}`} fill="none" stroke={MINT} strokeWidth="2" />
            </g>
          )
        })}
        <circle cx={flowRight} cy={flowMidY} r="4" fill={MINT} />
      </svg>

      {/* AIへの指示 */}
      <PromptBox className="absolute" style={{ left: 120, top: 0, width: 300 }} />
      <span style={{ left: FLOW.x + 68, top: 92 }} className="absolute text-[0.7rem] font-bold text-mint">
        AIが手順を提案
      </span>

      {/* 入力ファイル */}
      {INPUTS.map((f) => (
        <div
          key={f.name}
          style={{ top: f.y, width: TILE.w, height: TILE.h }}
          className="absolute left-0 flex items-center gap-2 rounded-xl bg-panel px-2.5 ring-1 ring-edge"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#1f7a4d]">
            <Sheet className="size-4 text-white" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-[0.74rem] font-bold whitespace-nowrap text-white">{f.name}</span>
            <span className="block text-[0.66rem] text-subtle">{f.ext}</span>
          </span>
        </div>
      ))}

      <FlowCard className="absolute" style={{ left: FLOW.x, top: FLOW.y, width: FLOW.w, height: FLOW.h }} />
      <ReusePill className="absolute" style={{ left: FLOW.x, top: FLOW.y + FLOW.h + 14, width: FLOW.w }} />

      <ResultTable className="absolute" style={{ left: OUT_X, top: OUTS[0].y, width: W - OUT_X }} />
      <ChartCard className="absolute" style={{ left: OUT_X, top: OUTS[1].y, width: W - OUT_X, height: OUTS[1].h }} />
      <InsightCard className="absolute" style={{ left: OUT_X, top: OUTS[2].y, width: W - OUT_X }} />
    </div>
  )
}

/** スマートフォン用の簡易版：読み込む → 加工する → 分析する → 出力する */
const PHASES: { icon: LucideIcon; label: string }[] = [
  { icon: Sheet, label: '読み込む' },
  { icon: Combine, label: '加工する' },
  { icon: ChartColumn, label: '分析する' },
  { icon: FileOutput, label: '出力する' },
]

export function HeroVisualCompact() {
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 ring-edge" role="img" aria-label="作業手順のイメージ：読み込む、加工する、分析する、出力する。保存して再実行できる">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[0.9rem] font-bold text-white">作業手順のイメージ</span>
        <span className="inline-flex items-center gap-1 text-[0.78rem] font-bold text-mint">
          <RefreshCw className="size-3.5" aria-hidden />
          保存・再実行できる
        </span>
      </div>
      <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
        {PHASES.map(({ icon: Icon, label }, i) => (
          <li key={label} className="contents">
            <span className="flex flex-col items-center gap-1 rounded-lg bg-panel-hi px-1 py-2.5">
              <Icon className="size-4.5 text-mint" aria-hidden />
              <span className="text-[0.75rem] whitespace-nowrap text-white">{label}</span>
            </span>
            {i < PHASES.length - 1 && <ArrowRight className="size-3.5 text-mint" aria-hidden />}
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---------- 部品 ---------- */

type BoxProps = { className?: string; style?: CSSProperties }

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Columns3, label: '必要な列を取り出す' },
  { icon: Combine, label: 'データをまとめる' },
  { icon: Sigma, label: '売上を集計する' },
  { icon: ChartColumn, label: 'グラフを作る' },
]

function FlowCard({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`rounded-2xl bg-panel p-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ring-1 ring-mint/30 ${className}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[0.82rem] font-bold text-white">作業手順</span>
        <span className="text-[0.68rem] text-subtle">4つの処理ステップ</span>
      </div>
      <ol className="space-y-1.5">
        {STEPS.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex items-center gap-2.5 rounded-lg bg-panel-hi px-2.5 py-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mint text-[0.66rem] font-bold text-on-mint">{i + 1}</span>
            <Icon className="size-4 shrink-0 text-mint" aria-hidden />
            <span className="flex-1 text-[0.76rem] whitespace-nowrap text-white">{label}</span>
            <CircleCheck className="size-3.5 text-[#6fd99b]" aria-label="確認済み" />
          </li>
        ))}
      </ol>
    </div>
  )
}

function ReusePill({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`flex items-center justify-center gap-1.5 rounded-full bg-mint/10 py-1.5 text-[0.74rem] font-bold text-mint ring-1 ring-mint/30 ${className}`}>
      <RefreshCw className="size-3.5" aria-hidden />
      作業手順を保存・再実行
    </div>
  )
}

function LightCard({ title, aside, className = '', style, children }: BoxProps & { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div style={style} className={`light-panel rounded-xl p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[0.8rem] font-bold">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

const ROWS = [
  ['営業1部', '12,480'],
  ['営業2部', '9,860'],
  ['EC事業部', '11,032'],
]

function ResultTable({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`light-panel overflow-hidden rounded-xl text-[0.72rem] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-bold">部署別 集計表</span>
        <span className="text-[0.64rem] text-muted">千円</span>
      </div>
      <table className="w-full">
        <tbody>
          {ROWS.map(([d, v]) => (
            <tr key={d} className="border-b border-line">
              <td className="px-3 py-1.5">{d}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{v}</td>
            </tr>
          ))}
          <tr className="bg-mint-soft font-bold text-forest">
            <td className="px-3 py-1.5">合計</td>
            <td className="px-3 py-1.5 text-right tabular-nums">33,372</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const BARS = [62, 44, 76, 38, 58, 70]

function ChartCard({ className = '', style }: BoxProps) {
  return (
    <LightCard title="グラフ" className={className} style={style} aside={<span className="text-[0.64rem] text-muted">部署別売上</span>}>
      <div className="flex h-[58px] items-end gap-1.5 border-b border-line">
        {BARS.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} className={`flex-1 rounded-t-[3px] ${i === 2 ? 'bg-mint' : 'bg-forest/80'}`} />
        ))}
      </div>
    </LightCard>
  )
}

function InsightCard({ className = '', style }: BoxProps) {
  return (
    <LightCard title="分析結果" className={className} style={style}>
      <ul className="space-y-1 text-[0.72rem]">
        <li className="flex justify-between">
          <span className="text-muted">前月比</span>
          <span className="font-bold text-forest tabular-nums">+8.2%</span>
        </li>
        <li className="flex justify-between">
          <span className="text-muted">売上1位</span>
          <span className="font-bold">営業1部</span>
        </li>
      </ul>
    </LightCard>
  )
}

function PromptBox({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`rounded-2xl bg-panel p-2.5 shadow-2xl ring-1 ring-edge ${className}`}>
      <div className="mb-1.5 flex items-center gap-1 px-1 text-[0.7rem] font-bold text-mint">
        <Sparkles className="size-3.5" aria-hidden />
        AIに日本語で指示
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2 ring-1 ring-edge">
        <span className="flex-1 text-[0.78rem] text-white">東京と大阪の売上をまとめて、部署別にグラフにして</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-mint">
          <SendHorizontal className="size-3.5 text-on-mint" aria-hidden />
        </span>
      </div>
    </div>
  )
}
