import { ArrowRight, CircleCheck, CircleHelp, CircleX, Lightbulb, Play, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Improvement, Scenario } from '../../api/kaizen'
import type { KaizenRunResult } from '../../kaizen/handoff'
import { buildOutcome } from '../../kaizen/outcome'
import { Button } from '../ui/Button'

const VERDICT: Record<string, { label: string; cls: string; icon: typeof CircleCheck }> = {
  normal: { label: '正常', cls: 'text-mint', icon: CircleCheck },
  caution: { label: '注意', cls: 'text-warning', icon: TriangleAlert },
  unverified: { label: '未検証', cls: 'text-warning', icon: CircleHelp },
  critical: { label: '重大', cls: 'text-kaizen-text', icon: CircleX },
}

/**
 * 業務改善デモ STEP 5「改善前後を比較」。
 * 比較の値は、サーバーが改善前の工程・改善後の工程と作業手順から数えたもの（固定値ではない）。作業時間は想定値と明記する。
 * 下の「改善後の作業の進め方」は、改善の結果から作った成果のまとめ。自動化を採用したときだけ、作業手順の実行結果（または実行の案内）を出す。
 * 自動化を採用しないことも有効な選択肢として伝える（「実行できない」「失敗」と見せない）。
 */
export function KaizenCompare({ data, scenario, run, onRun }: { data: Improvement; scenario: Scenario; run: KaizenRunResult | null; onRun?: () => void }) {
  const v = run?.verdict ? VERDICT[run.verdict] : null
  // 改善後の作業の進め方：実際の改善の結果から作る（比較表と同じデータ。固定の文を書かない）
  const o = buildOutcome(scenario, data)
  return (
    <div className="space-y-6">
      <section aria-labelledby="kz-compare" className="rounded-2xl border border-edge bg-panel p-5">
        <h2 id="kz-compare" className="text-[1.1rem] font-bold text-white">
          改善前と改善後
        </h2>
        <table className="mt-3 w-full border-collapse text-left text-[0.95rem]" aria-label="改善前後の比較">
          <thead>
            <tr className="border-b border-edge text-[0.82rem] text-subtle">
              <th scope="col" className="w-[22%] py-2 pr-3 font-normal">
                項目
              </th>
              <th scope="col" className="w-[30%] py-2 pr-3 font-normal">
                改善前
              </th>
              <th scope="col" className="w-8 py-2">
                <span className="sr-only">変化</span>
              </th>
              <th scope="col" className="py-2 font-normal">
                改善後
              </th>
            </tr>
          </thead>
          <tbody>
            {data.comparison.map((r) => (
              <tr key={r.item} className="border-b border-edge/60 align-top last:border-0">
                <th scope="row" className="py-3 pr-3 font-bold text-white">
                  {r.item}
                  {r.assumed && <span className="ml-2 rounded-full px-2 py-0.5 text-[0.75rem] font-bold text-warning ring-1 ring-warning/50">想定</span>}
                </th>
                <td className="py-3 pr-3 text-white/70">{r.before}</td>
                <td className="py-3 text-mint">
                  <ArrowRight className="mt-0.5 size-4" aria-hidden />
                </td>
                <td className="py-3">
                  <span className="font-bold text-white">{r.after}</span>
                  {r.note && <span className="mt-0.5 block text-[0.82rem] text-subtle">{r.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[0.82rem] text-subtle">
          ※ 作業時間は、デモのための架空の設定値から計算した想定値です。実際に測った削減効果ではありません。そのほかの項目は、作った手順から数えています。
        </p>
      </section>

      <section aria-labelledby="kz-outcome" className="rounded-2xl border border-mint-line bg-panel p-5">
        <h2 id="kz-outcome" className="text-[1rem] font-bold text-white">
          改善後の作業の進め方
        </h2>
        <p className="mt-2 flex items-center gap-2 text-[1.1rem] font-bold text-mint">
          <CircleCheck className="size-5" aria-hidden />
          {o.headline}
        </p>
        <p className="mt-1 text-[0.93rem] text-white/85">{o.summary}</p>
        <dl className="mt-3 grid grid-cols-5 gap-2 text-[0.85rem]" aria-label="成果のまとめ">
          <SummaryItem label="工程数" value={`${o.stepsBefore}工程 → ${o.stepsAfter}工程`} />
          <SummaryItem label="なくした作業" value={o.removed.length ? o.removed.join('・') : 'なし'} />
          <SummaryItem label="続ける確認" value={o.keptChecks.join('・') || 'なし'} />
          <SummaryItem label="自動化" value={o.automated ? '採用した' : '今回は採用しない'} />
          <SummaryItem label="想定作業時間" value={`毎月${o.minutesBefore}分 → ${o.minutesAfter}分`} note="架空の設定による試算（実測ではありません）" />
        </dl>
        {o.automated ? (
          <div className="mt-4 border-t border-edge pt-3.5" aria-label="自動化した作業手順の実行結果" role="region">
            {run && v ? (
              <div className="space-y-1 text-[0.93rem]">
                <p className={`flex items-center gap-2 font-bold ${v.cls}`}>
                  <v.icon className="size-4.5" aria-hidden />
                  サンプルのExcelで実行した結果：総合判定 {v.label}
                </p>
                <p className="flex items-center gap-1.5 text-white/85">
                  <ShieldCheck className="size-4 text-mint" aria-hidden />
                  完了基準 {run.criteria_total}件のうち {run.criteria_passed}件を満たしました。正式な出力：{run.can_export ? 'できる' : '停止'}
                </p>
                <p className="text-[0.82rem] text-subtle">実行日時：{new Date(run.executed_at).toLocaleString('ja-JP')}（作業手順の画面で、実際の処理エンジンで実行した結果）</p>
              </div>
            ) : (
              <p className="text-[0.93rem] text-subtle">自動化した部分は、作業手順として実際に動かせます。下の「この作業手順を開いて、サンプルのExcelで実行する」から確かめられます。</p>
            )}
            {onRun && (
              <div className="mt-3">
                <Button variant="outlineDark" size="sm" onClick={onRun}>
                  <Play className="size-4" aria-hidden />
                  {run ? 'もう一度、作業手順を開いて実行する' : 'この作業手順を開いて、サンプルのExcelで実行する'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 flex gap-2.5 rounded-xl bg-mint/8 px-4 py-3 ring-1 ring-mint/30">
            <Lightbulb className="mt-0.5 size-5 shrink-0 text-mint" aria-hidden />
            <p className="text-[0.92rem] text-white/90">
              <span className="font-bold text-mint">今回は、自動化よりも作業の整理を優先しました。</span>
              <span className="mt-0.5 block text-white/80">不要な工程を減らし、必要な確認を残すことで、業務をよりシンプルにしました。自動化しないことも、業務改善の有効な選択肢です。</span>
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryItem({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-panel-hi px-3 py-2 ring-1 ring-edge">
      <dt className="text-[0.76rem] text-subtle">{label}</dt>
      <dd className="mt-0.5 font-bold text-white">{value}</dd>
      {note && <dd className="mt-0.5 text-[0.72rem] text-subtle">{note}</dd>}
    </div>
  )
}
