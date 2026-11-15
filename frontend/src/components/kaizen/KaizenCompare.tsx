import { ArrowRight, CircleCheck, CircleHelp, CircleX, Play, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Improvement } from '../../api/kaizen'
import type { KaizenRunResult } from '../../kaizen/handoff'

const VERDICT: Record<string, { label: string; cls: string; icon: typeof CircleCheck }> = {
  normal: { label: '正常', cls: 'text-mint', icon: CircleCheck },
  caution: { label: '注意', cls: 'text-warning', icon: TriangleAlert },
  unverified: { label: '未検証', cls: 'text-warning', icon: CircleHelp },
  critical: { label: '重大', cls: 'text-kaizen-text', icon: CircleX },
}

/**
 * 業務改善デモ STEP 5「改善前後を比較」。
 * 比較の値は、サーバーが改善前の工程・改善後の工程と作業手順から数えたもの（固定値ではない）。作業時間は想定値と明記する。
 * 改善後の作業手順をサンプルのExcelで実行していれば、その実際の結果を並べる（実行していなければ、実行を勧める）。
 */
export function KaizenCompare({ data, run }: { data: Improvement; run: KaizenRunResult | null }) {
  const v = run?.verdict ? VERDICT[run.verdict] : null
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

      <section aria-labelledby="kz-actual" className={`rounded-2xl p-5 ring-1 ${run ? 'bg-panel ring-mint-line' : 'bg-panel ring-edge'}`}>
        <h2 id="kz-actual" className="flex items-center gap-2 text-[1rem] font-bold text-white">
          <Play className="size-4.5 text-mint" aria-hidden />
          サンプルのExcelで実行した結果
        </h2>
        {run && v ? (
          <div className="mt-3 space-y-1.5 text-[0.93rem]">
            <p className={`flex items-center gap-2 text-[1.1rem] font-bold ${v.cls}`}>
              <v.icon className="size-5" aria-hidden />
              総合判定：{v.label}
            </p>
            <p className="flex items-center gap-1.5 text-white/85">
              <ShieldCheck className="size-4 text-mint" aria-hidden />
              完了基準 {run.criteria_total}件のうち {run.criteria_passed}件を満たしました。正式な出力：{run.can_export ? 'できる' : '停止'}
            </p>
            <p className="text-[0.82rem] text-subtle">実行日時：{new Date(run.executed_at).toLocaleString('ja-JP')}（作業手順の画面で、実際の処理エンジンで実行した結果）</p>
          </div>
        ) : data.flow ? (
          <p className="mt-2 text-[0.93rem] text-subtle">
            まだ実行していません。下の「この作業手順を開いて、サンプルのExcelで実行する」から、作った作業手順を実際に動かせます。
          </p>
        ) : (
          <p className="mt-2 text-[0.93rem] text-subtle">自動化を採用していないため、実行できる作業手順はありません。</p>
        )}
      </section>
    </div>
  )
}
