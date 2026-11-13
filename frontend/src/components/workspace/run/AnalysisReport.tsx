import { ChartColumn, ClipboardList, History, Info, TrendingDown, TrendingUp } from 'lucide-react'

/*
 * 分析レポート（分析エンジン Phase B。backend/app/analysis/engine.py・app/quality/compare.py）。
 * 実行の結論の下に、重要な順に置く：今回の主要数値 → 確認すべきこと → 前回との比較 → データの分析。
 * 数値はすべてサーバーが確定的に計算したもの（AIは使わない）。分析できないときは、空のグラフではなく理由を示す。
 * グラフは新しいライブラリを使わず、棒（構成比）と折れ線（時系列）を描く。1つのレポートで最大3つ。
 */

export type Breakdown = {
  reference: string
  step_name: string
  dimension: string
  measure: string
  measure_kind: 'sum' | 'count'
  total: string
  groups: number
  items: { key: string; value: string; share: string | null }[]
  is_time: boolean
}

export type Analysis = {
  tables: { reference: string; sheet_name: string; rows: number; numeric: { column: string; sum: string; avg: string; min: string; max: string }[] }[]
  breakdowns: Breakdown[]
  notable_changes: { reference: string; dimension: string; measure: string; key: string; previous: string; current: string; diff: string; rate: string }[]
  check_items: string[]
  notes: string[]
  compared_with: string | null
}

export type Comparison = {
  period: string | null
  previous_period: string | null
  business_reason: string | null
  quality_reason: string | null
  rows: { metric_id: string; label: string; category: 'business' | 'quality'; current: string; previous: string | null; diff: string | null; rate: string | null; status: 'compared' | 'not_comparable'; reason: string | null }[]
}

type Input = { label: string; filename: string | null; rows: number | null }

const MAX_CHARTS = 3
const num = (s: string) => Number(s.replace(/,/g, ''))

export function AnalysisReport({ analysis, comparison, inputs }: { analysis: Analysis; comparison: Comparison | null; inputs: Input[] }) {
  const totalInput = inputs.reduce((s, i) => s + (i.rows ?? 0), 0)
  const main = analysis.breakdowns.find((b) => b.measure_kind === 'sum') ?? analysis.breakdowns[0]
  const charts = analysis.breakdowns.slice(0, MAX_CHARTS)
  const compared = comparison?.rows.filter((r) => r.status === 'compared') ?? []
  // 比べられないことは「前回との比較」で示すので、分析の注記からは除く（同じ文を2回出さない）
  const notes = analysis.notes.filter((n) => !n.startsWith('比較できる過去の実行結果がありません'))

  return (
    <>
      <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="今回の主要数値">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <ChartColumn className="size-4.5 text-mint" aria-hidden />
          今回の主要数値
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="入力ファイル" value={`${inputs.length}ファイル`} sub={`合計 ${totalInput.toLocaleString()}行`} />
          {analysis.tables.slice(0, 2).map((t) => (
            <Kpi key={t.reference} label={`出力：${t.sheet_name}`} value={`${t.rows.toLocaleString()}行`} />
          ))}
          {main && <Kpi label={`${main.dimension}別の「${main.measure}」`} value={main.total} sub={`${main.groups}区分`} />}
        </dl>
      </section>

      {analysis.check_items.length > 0 && (
        <section className="rounded-2xl bg-[#17362E] p-5 ring-1 ring-mint/45" aria-label="確認すべきこと">
          <h2 className="flex items-center gap-2 font-bold text-mint">
            <ClipboardList className="size-4.5" aria-hidden />
            確認すべきこと
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.9rem] text-white/90">
            {analysis.check_items.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="前回との比較">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <History className="size-4.5 text-mint" aria-hidden />
          前回との比較
          {compared.length > 0 && comparison?.previous_period && <span className="text-[0.82rem] font-normal text-subtle">（{comparison.previous_period} と比べています）</span>}
        </h2>
        {compared.length === 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-[0.88rem] text-subtle">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {comparison?.business_reason ?? '比較できる過去の実行結果がありません。'}今回のデータの分析は確認できます。
          </p>
        ) : (
          <table className="mt-3 w-full text-[0.88rem]">
            <thead className="text-left text-[0.8rem] text-subtle">
              <tr>
                <th className="border-b border-edge py-1.5 pr-3 font-bold">項目</th>
                <th className="border-b border-edge py-1.5 pr-3 text-right font-bold">前回</th>
                <th className="border-b border-edge py-1.5 pr-3 text-right font-bold">今回</th>
                <th className="border-b border-edge py-1.5 text-right font-bold">変化</th>
              </tr>
            </thead>
            <tbody>
              {compared.map((r) => (
                <tr key={r.metric_id} className="border-b border-edge/60 last:border-0">
                  <td className="py-1.5 pr-3 text-white">{r.label}</td>
                  <td className="py-1.5 pr-3 text-right text-white/75 tabular-nums">{r.previous}</td>
                  <td className="py-1.5 pr-3 text-right text-white tabular-nums">{r.current}</td>
                  <td className="py-1.5 text-right text-white/85 tabular-nums">
                    {r.diff}
                    {r.rate ? `（${r.rate}）` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="データの分析">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <ChartColumn className="size-4.5 text-mint" aria-hidden />
          データの分析
          <span className="text-[0.8rem] font-normal text-subtle">（集計結果から計算。AIは使っていません）</span>
        </h2>
        {analysis.notable_changes.length > 0 && (
          <div className="mt-3 rounded-xl bg-warning/10 px-4 py-3 ring-1 ring-warning/35" role="note" aria-label="注目すべき変化">
            <p className="text-[0.88rem] font-bold text-warning">注目すべき変化（{analysis.compared_with} と比べて）</p>
            <ul className="mt-1 space-y-0.5 text-[0.86rem] text-white/90">
              {analysis.notable_changes.slice(0, 5).map((c) => (
                <li key={`${c.reference}-${c.key}`} className="flex items-center gap-1.5">
                  {c.diff.startsWith('-') ? <TrendingDown className="size-4 text-warning" aria-hidden /> : <TrendingUp className="size-4 text-warning" aria-hidden />}
                  {c.key === '（全体）' ? '全体' : `「${c.key}」`}の「{c.measure}」：{c.previous} → {c.current}（{c.rate}）
                </li>
              ))}
            </ul>
          </div>
        )}
        {charts.length > 0 && (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {charts.map((b) => (b.is_time ? <LineChart key={b.reference} b={b} /> : <BarChart key={b.reference} b={b} />))}
          </div>
        )}
        {notes.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[0.84rem] text-subtle" aria-label="分析できなかったこと">
            {notes.map((n) => (
              <li key={n} className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/4 px-4 py-3 ring-1 ring-edge">
      <dt className="truncate text-[0.8rem] text-subtle" title={label}>
        {label}
      </dt>
      <dd className="mt-0.5 text-[1.35rem] font-bold text-white tabular-nums">{value}</dd>
      {sub && <dd className="text-[0.8rem] text-subtle">{sub}</dd>}
    </div>
  )
}

/** ランキング・構成比：上位5件の横棒。数値と構成比を文字でも示す（色だけに頼らない） */
function BarChart({ b }: { b: Breakdown }) {
  const top = b.items.slice(0, 5)
  const max = Math.max(...top.map((i) => num(i.value)), 1)
  return (
    <figure className="rounded-xl bg-white/3 p-4 ring-1 ring-edge" aria-label={`「${b.dimension}」別の「${b.measure}」`}>
      <figcaption className="text-[0.88rem] font-bold text-white">
        「{b.dimension}」別の「{b.measure}」<span className="ml-1 font-normal text-subtle">上位{top.length}件／{b.groups}区分</span>
      </figcaption>
      <ol className="mt-2 space-y-1.5">
        {top.map((i) => (
          <li key={i.key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-[0.84rem]">
            <span className="truncate text-white/85" title={i.key}>
              {i.key}
            </span>
            <span className="h-3 rounded-full bg-white/6">
              <span className="block h-3 rounded-full bg-mint/80" style={{ width: `${Math.max(2, (num(i.value) / max) * 100)}%` }} />
            </span>
            <span className="text-right text-white tabular-nums">
              {i.value}
              {i.share && <span className="ml-1 text-subtle">（{i.share}）</span>}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

/** 時系列：日付の順の折れ線（点が2つ以上のとき） */
function LineChart({ b }: { b: Breakdown }) {
  const pts = b.items.map((i) => num(i.value))
  if (pts.length < 2) return <BarChart b={b} />
  const w = 320
  const h = 110
  const max = Math.max(...pts)
  const min = Math.min(...pts, 0)
  const x = (i: number) => (i / (pts.length - 1)) * (w - 8) + 4
  const y = (v: number) => h - 6 - ((v - min) / (max - min || 1)) * (h - 12)
  return (
    <figure className="rounded-xl bg-white/3 p-4 ring-1 ring-edge" aria-label={`「${b.dimension}」ごとの「${b.measure}」の推移`}>
      <figcaption className="text-[0.88rem] font-bold text-white">
        「{b.dimension}」ごとの「{b.measure}」の推移<span className="ml-1 font-normal text-subtle">（{b.items[0].key}〜{b.items.at(-1)!.key}）</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-28 w-full" role="img" aria-label={`最大 ${Math.max(...pts).toLocaleString()}、最小 ${Math.min(...pts).toLocaleString()}`}>
        <polyline points={pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" className="text-mint" />
      </svg>
      <p className="text-[0.8rem] text-subtle">
        合計 {b.total}／最大 {Math.max(...pts).toLocaleString()}／最小 {Math.min(...pts).toLocaleString()}
      </p>
    </figure>
  )
}
