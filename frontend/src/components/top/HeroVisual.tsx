import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Columns3,
  FileOutput,
  Funnel,
  GitMerge,
  SendHorizontal,
  Sheet,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { LogoMark } from '../brand/Logo'

/*
 * ヒーロー右側の製品ビジュアル。
 * 実際のFlowCraft AIの処理（読込 → 整形・結合 → 品質検証 → 出力）と同じ流れを、
 * 製品画面を重ねた構図で表現する。数値はすべて架空。
 *
 * PC・タブレット（幅640px以上）：600×440px の重ね合わせ構図（HeroVisual）
 * スマートフォン：縦に並べた簡易版（HeroVisualCompact）
 */

const INPUTS = [
  { name: '売上実績', ext: '.xlsx', y: 96 },
  { name: '商品マスタ', ext: '.xlsx', y: 160 },
  { name: '部署マスタ', ext: '.csv', y: 224 },
]
const TILE_H = 50
const TILE_W = 100
const MERGE_POINT = { x: 124, y: 154 } // 入力が合流する点（アプリ画面の左端）

export function HeroVisual() {
  return (
    <div className="relative h-[440px] w-[600px] shrink-0 text-ink" role="img" aria-label="FlowCraft AIの処理イメージ：3つのExcelを読み込み、整形・結合・品質検証を経てレポートを出力する">
      {/* 背景の淡い光 */}
      <div className="pointer-events-none absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(37,99,166,0.35),transparent)]" />

      {/* アプリ画面 */}
      <div className="absolute top-[36px] left-[124px] h-[316px] w-[476px] overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-white/20">
        <div className="flex h-9 items-center gap-2 border-b border-line bg-white px-3 text-[0.75rem]">
          <LogoMark className="size-4.5" />
          <span className="text-muted">経理チーム</span>
          <span className="text-line">/</span>
          <span className="font-bold text-ink">月次売上集計</span>
          <ChevronDown className="size-3.5 text-muted" />
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-[0.7rem] font-bold text-success">
            保存済み v3
          </span>
        </div>
      </div>

      {/* 入力ファイル → 合流点 → 「データを整える」をつなぐ線 */}
      <svg className="pointer-events-none absolute inset-0" width="600" height="440" aria-hidden>
        {INPUTS.map((f) => {
          const y = f.y + TILE_H / 2
          return (
            <path
              key={f.name}
              d={`M${TILE_W} ${y} C ${TILE_W + 16} ${y}, ${MERGE_POINT.x - 14} ${MERGE_POINT.y}, ${MERGE_POINT.x} ${MERGE_POINT.y}`}
              fill="none"
              stroke="#7FD3AE"
              strokeWidth="2"
              strokeDasharray="5 5"
              className="motion-safe:animate-[flow-dash_1.2s_linear_infinite]"
            />
          )
        })}
        <path d="M124 154 H140" stroke="#7FD3AE" strokeWidth="2" />
        <circle cx={MERGE_POINT.x} cy={MERGE_POINT.y} r="5" fill="#16845B" stroke="#FFFFFF" strokeWidth="2" />
      </svg>

      {/* 入力ファイル */}
      {INPUTS.map((f) => (
        <div
          key={f.name}
          style={{ top: f.y, width: TILE_W }}
          className="absolute left-0 flex h-[50px] items-center gap-1.5 rounded-lg bg-navy-soft px-2 ring-1 ring-navy-line"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded bg-success">
            <Sheet className="size-3.5 text-white" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-[0.72rem] font-bold whitespace-nowrap text-white">{f.name}</span>
            <span className="block text-[0.65rem] text-white/55">{f.ext}</span>
          </span>
        </div>
      ))}

      <PrepareCard className="absolute top-[88px] left-[140px] w-[222px]" />
      <ChevronRight className="absolute top-[146px] left-[361px] size-4 text-muted" aria-hidden />
      <QualityCard className="absolute top-[88px] left-[376px] w-[208px]" />
      <ReportCard className="absolute top-[232px] left-[140px] w-[444px]" />
      <ResultTable className="absolute top-[262px] left-[408px] w-[192px]" />
      <PromptBox className="absolute top-[350px] left-[36px] w-[356px]" />
    </div>
  )
}

/** スマートフォン用の簡易版。重ね合わせをやめて縦に並べる。 */
export function HeroVisualCompact() {
  return (
    <div className="space-y-3" role="img" aria-label="FlowCraft AIの処理イメージ">
      <PromptBox />
      <PrepareCard />
      <QualityCard />
    </div>
  )
}

/* ---------- 部品 ---------- */

function Card({ title, aside, className = '', children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg bg-white p-3 text-ink shadow-sm ring-1 ring-line ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[0.82rem] font-bold text-ink">{title}</span>
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

function PrepareCard({ className = '' }: { className?: string }) {
  return (
    <Card
      title="データを整える"
      className={className}
      aside={
        <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-success">
          <CircleCheck className="size-3.5" aria-hidden />
          確定
        </span>
      }
    >
      <div className="flex justify-between gap-2">
        {STEPS.map(({ icon: Icon, label }) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <span className="grid h-11 w-full place-items-center rounded-md bg-accent-soft ring-1 ring-accent/20">
              <Icon className="size-5 text-accent" aria-hidden />
            </span>
            <span className="text-[0.68rem] whitespace-nowrap text-muted">{label}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function QualityCard({ className = '' }: { className?: string }) {
  return (
    <Card title="品質検証" className={className} aside={<span className="text-[0.7rem] text-muted">自動チェック</span>}>
      <ul className="space-y-1.5 text-[0.75rem]">
        <QualityRow ok label="結合後の件数" value="1,250件 一致" />
        <QualityRow ok={false} label="未照合の商品コード" value="3件" />
        <QualityRow ok label="金額の差異" value="0円" />
      </ul>
    </Card>
  )
}

function QualityRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${ok ? '' : 'bg-warning-soft font-bold text-warning'}`}
    >
      {ok ? (
        <CircleCheck className="size-3.5 shrink-0 text-success" aria-label="正常" />
      ) : (
        <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-label="警告" />
      )}
      <span className="flex-1">{label}</span>
      <span className={ok ? 'text-ink' : ''}>{value}</span>
    </li>
  )
}

const BARS = [62, 48, 70, 40, 56, 34, 66, 44, 52]

function ReportCard({ className = '' }: { className?: string }) {
  return (
    <Card
      title="部署別売上レポート"
      className={className}
      aside={
        <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[0.68rem] text-muted">
          <FileOutput className="size-3" aria-hidden />
          Excel出力
        </span>
      }
    >
      {/* 右側は「集計結果」の表が重なるため、棒グラフは左側に収める */}
      <div className="flex h-[48px] items-end gap-2 pr-[160px]">
        {BARS.map((h, i) => (
          <span
            key={i}
            style={{ height: `${h}%` }}
            className={`flex-1 rounded-t-sm ${i % 3 === 2 ? 'bg-success/80' : 'bg-accent/80'}`}
          />
        ))}
      </div>
    </Card>
  )
}

const ROWS = [
  ['営業1部', '12,480'],
  ['営業2部', '9,860'],
  ['EC事業部', '11,032'],
  ['直販部', '7,215'],
]

function ResultTable({ className = '' }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-white text-[0.72rem] text-ink shadow-xl ring-1 ring-line ${className}`}>
      <div className="flex items-center justify-between bg-navy px-2.5 py-1.5 text-white">
        <span className="font-bold">集計結果</span>
        <span className="text-[0.65rem] text-white/60">単位：千円</span>
      </div>
      <table className="w-full">
        <thead className="bg-surface text-muted">
          <tr>
            <th className="px-2.5 py-1 text-left font-medium">部署</th>
            <th className="px-2.5 py-1 text-right font-medium">売上金額</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([d, v]) => (
            <tr key={d} className="border-t border-line">
              <td className="px-2.5 py-1">{d}</td>
              <td className="px-2.5 py-1 text-right tabular-nums">{v}</td>
            </tr>
          ))}
          <tr className="border-t border-line bg-success-soft font-bold">
            <td className="px-2.5 py-1">合計</td>
            <td className="px-2.5 py-1 text-right tabular-nums">40,587</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PromptBox({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl bg-navy-soft p-2.5 shadow-2xl ring-1 ring-navy-line ${className}`}>
      <div className="mb-1.5 flex items-center gap-1 px-1 text-[0.68rem] font-bold text-mint">
        <Sparkles className="size-3.5" aria-hidden />
        AIに日本語で指示
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-navy px-3 py-2">
        <span className="flex-1 text-[0.8rem] text-white">部署別に今月の売上を集計して</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-success">
          <SendHorizontal className="size-3.5 text-white" aria-hidden />
        </span>
      </div>
    </div>
  )
}
