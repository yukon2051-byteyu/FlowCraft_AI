import { CircleCheck, Columns3, FileOutput, Funnel, GitMerge, Merge, SendHorizontal, Sheet, Sparkles, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

/*
 * ヒーロー右側の製品ビジュアル。
 * 「Excelファイル → 処理フロー → 集計結果」の流れを、ミントの接続線でつないで表現する。
 * 処理カード・データ・グラフは明るいパネル、入力ファイルとAI指示は暗いパネル。
 * 実際のFlowCraft AIの処理（読込 → 整形・結合 → 品質検証 → 出力）と同じ流れにしている。
 *
 * PC・タブレット（幅640px以上）：640×460px の構図（HeroVisual）
 * スマートフォン：縦に並べた簡易版（HeroVisualCompact）
 */

const W = 640
const H = 460
const MINT = '#38D9AD'

const INPUTS = [
  { name: '売上実績', ext: '.xlsx', y: 150 },
  { name: '商品マスタ', ext: '.xlsx', y: 214 },
  { name: '部署マスタ', ext: '.csv', y: 278 },
]
const TILE = { w: 108, h: 52 }
const MERGE = { x: 160, y: 240 } // 入力が合流する「結合」ノードの中心
const PREP = { x: 210, y: 166, w: 236, h: 148 } // 「データを整える」カード
const OUT_X = 486 // 出力カードの左端

export function HeroVisual() {
  const prepRight = PREP.x + PREP.w
  const prepMidY = PREP.y + PREP.h / 2
  return (
    <div
      className="relative shrink-0"
      style={{ width: W, height: H }}
      role="img"
      aria-label="FlowCraft AIの処理イメージ：3つのExcelを読み込み、結合・整形・品質検証を経て集計表とレポートを出力する"
    >
      {/* 背景の光（ミント） */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[420px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,217,173,0.16),transparent)]" />

      {/* 接続線 */}
      <svg className="pointer-events-none absolute inset-0" width={W} height={H} aria-hidden>
        {INPUTS.map((f) => {
          const y = f.y + TILE.h / 2
          return (
            <path
              key={f.name}
              d={`M${TILE.w} ${y} C ${TILE.w + 26} ${y}, ${MERGE.x - 40} ${MERGE.y}, ${MERGE.x - 22} ${MERGE.y}`}
              fill="none"
              stroke={MINT}
              strokeWidth="2"
              strokeDasharray="6 5"
              className="motion-safe:animate-[flow-dash_1.2s_linear_infinite]"
            />
          )
        })}
        <path d={`M${MERGE.x + 22} ${MERGE.y} H${PREP.x}`} stroke={MINT} strokeWidth="2" />
        {/* 整えたデータ → 集計表（上）／レポート（下） */}
        <path d={`M${prepRight} ${prepMidY} C ${prepRight + 22} ${prepMidY}, ${OUT_X - 24} 120, ${OUT_X} 120`} fill="none" stroke={MINT} strokeWidth="2" />
        <path d={`M${prepRight} ${prepMidY} C ${prepRight + 22} ${prepMidY}, ${OUT_X - 24} 352, ${OUT_X} 352`} fill="none" stroke={MINT} strokeWidth="2" />
        <circle cx={prepRight} cy={prepMidY} r="4" fill={MINT} />
        <path d={`M${OUT_X - 7} 115 L${OUT_X} 120 L${OUT_X - 7} 125`} fill="none" stroke={MINT} strokeWidth="2" />
        <path d={`M${OUT_X - 7} 347 L${OUT_X} 352 L${OUT_X - 7} 357`} fill="none" stroke={MINT} strokeWidth="2" />
      </svg>

      {/* 入力ファイル（暗いパネル） */}
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

      {/* 結合ノード */}
      <div
        style={{ left: MERGE.x - 22, top: MERGE.y - 22 }}
        className="absolute grid size-11 place-items-center rounded-xl bg-white shadow-[0_0_0_4px_rgba(56,217,173,0.18)]"
        title="結合"
      >
        <Merge className="size-5 text-forest" aria-hidden />
      </div>
      <span style={{ left: MERGE.x - 22, top: MERGE.y + 28 }} className="absolute w-11 text-center text-[0.68rem] text-subtle">
        結合
      </span>

      {/* 品質検証（暗いピル）＋ データを整える（明るいカード） */}
      <QualityPill className="absolute" style={{ left: PREP.x, top: PREP.y - 52, width: PREP.w }} />
      <PrepareCard className="absolute" style={{ left: PREP.x, top: PREP.y, width: PREP.w, height: PREP.h }} />

      {/* 出力：集計表（上）とレポート（下） */}
      <ResultTable className="absolute" style={{ left: OUT_X, top: 28, width: W - OUT_X }} />
      <ReportCard className="absolute" style={{ left: OUT_X, top: 300, width: W - OUT_X }} />

      {/* AIへの指示（暗いパネル） */}
      <PromptBox className="absolute" style={{ left: 24, top: 372, width: 422 }} />
    </div>
  )
}

/** スマートフォン用の簡易版。重ね合わせをやめて縦に並べる。 */
export function HeroVisualCompact() {
  return (
    <div className="space-y-3" role="img" aria-label="FlowCraft AIの処理イメージ">
      <PromptBox />
      <PrepareCard />
      <QualityPill />
      <ResultTable />
    </div>
  )
}

/* ---------- 部品 ---------- */

type BoxProps = { className?: string; style?: CSSProperties }

function LightCard({ title, aside, className = '', style, children }: BoxProps & { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div style={style} className={`light-panel rounded-xl p-3.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[0.85rem] font-bold">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Columns3, label: '列を抽出' },
  { icon: Funnel, label: '条件で絞込' },
  { icon: GitMerge, label: 'マスタと結合' },
]

function PrepareCard({ className = '', style }: BoxProps) {
  return (
    <LightCard
      title="データを整える"
      className={className}
      style={style}
      aside={
        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[0.68rem] font-bold text-success-ink">
          <CircleCheck className="size-3" aria-hidden />
          確定
        </span>
      }
    >
      <p className="mb-2.5 text-[0.7rem] text-muted">ステップごとに内容を確認して実行</p>
      <div className="flex items-start">
        {STEPS.map(({ icon: Icon, label }, i) => (
          <div key={label} className="flex flex-1 items-start">
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <span className="grid h-12 w-full place-items-center rounded-lg bg-paper ring-1 ring-line">
                <Icon className="size-5 text-forest" aria-hidden />
              </span>
              <span className="text-[0.66rem] whitespace-nowrap text-muted">{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="mt-6 h-0.5 w-2.5 shrink-0 bg-mint" aria-hidden />}
          </div>
        ))}
      </div>
    </LightCard>
  )
}

function QualityPill({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`flex items-center gap-3 rounded-xl bg-panel px-3 py-2 text-[0.72rem] ring-1 ring-edge ${className}`}>
      <span className="font-bold text-white">品質検証</span>
      <span className="inline-flex items-center gap-1 text-[#6fd99b]">
        <CircleCheck className="size-3.5" aria-label="正常" />
        件数一致
      </span>
      <span className="inline-flex items-center gap-1 font-bold text-warning">
        <TriangleAlert className="size-3.5" aria-label="警告" />
        未照合 3件
      </span>
    </div>
  )
}

const ROWS = [
  ['営業1部', '12,480'],
  ['営業2部', '9,860'],
  ['EC事業部', '11,032'],
  ['直販部', '7,215'],
]

function ResultTable({ className = '', style }: BoxProps) {
  return (
    <div style={style} className={`light-panel overflow-hidden rounded-xl text-[0.72rem] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-bold">部署別 集計</span>
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
            <td className="px-3 py-1.5 text-right tabular-nums">40,587</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const BARS = [62, 44, 76, 38, 58, 50, 70]

function ReportCard({ className = '', style }: BoxProps) {
  return (
    <LightCard
      title="売上レポート"
      className={className}
      style={style}
      aside={<FileOutput className="size-3.5 text-muted" aria-label="Excel出力" />}
    >
      <div className="flex h-[64px] items-end gap-1.5 border-b border-line">
        {BARS.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} className={`flex-1 rounded-t-[3px] ${i === 2 ? 'bg-mint' : 'bg-forest/80'}`} />
        ))}
      </div>
      <p className="mt-1.5 text-[0.64rem] text-muted">Excel・4シートで出力</p>
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
      <div className="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2.5 ring-1 ring-edge">
        <span className="flex-1 text-[0.82rem] text-white">部署別に今月の売上を集計して</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-mint">
          <SendHorizontal className="size-3.5 text-on-mint" aria-hidden />
        </span>
      </div>
    </div>
  )
}
