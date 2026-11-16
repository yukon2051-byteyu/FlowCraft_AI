import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react'
import type { RunSummary } from '../../../api/flows'
import { useFlowStore } from '../../../flow/store'

/**
 * デモの結果の画面の冒頭に出す、完了のまとめ（デモの完了画面の改善指示書）。
 * すべて実際の実行結果から作る（固定の文言で成功と見せない）。
 * 「処理が最後まで終わった」と「品質検証に合格した」は別の事実として、別の行に出す。
 */
const TONE = {
  normal: { cls: 'border-l-mint', text: 'text-mint', icon: CircleCheck, label: '正常' },
  caution: { cls: 'border-l-warning', text: 'text-warning', icon: TriangleAlert, label: '注意' },
  unverified: { cls: 'border-l-warning', text: 'text-warning', icon: CircleHelp, label: '未検証' },
  critical: { cls: 'border-l-kaizen', text: 'text-kaizen-text', icon: CircleX, label: '重大' },
} as const

export function DemoResultSummary({ run, title }: { run: RunSummary; title: string }) {
  const flow = useFlowStore((s) => s.flow)
  const v = run.verdict?.verdict ?? (run.status === 'failed' ? 'critical' : 'unverified')
  const t = TONE[v]
  const failedRun = run.status === 'failed'
  const crit = run.criteria
  const passed = crit.filter((c) => c.status === 'passed').length
  const name = title.replace(/デモ$/, '')

  // 出力する表と行数（どの処理ステップが作った表か、を作業手順から引き、実行した行数を出す）
  const producer = new Map(flow.nodes.map((n) => [n.output_reference, n.node_id]))
  const rowsOf = (ref: string) => run.nodes.find((n) => n.node_id === producer.get(ref))?.output_rows ?? null
  const outputs = run.outputs.map((o) => {
    const r = rowsOf(o.reference)
    return r === null ? o.sheet_name : `${o.sheet_name} ${r.toLocaleString()}行`
  })

  const message = failedRun
    ? '処理が途中で止まりました。止まった理由を下で確認してください。'
    : v === 'normal'
      ? '品質検証を通過しました。正式なExcelを出力できます。'
      : v === 'critical'
        ? '重大な品質異常を検出しました。正式出力を停止しています。'
        : (run.verdict?.headline ?? '確認が必要な点があります。内容を確かめてから出力してください。')

  // 重大の基準（業務上いちばん大事な確認）を、実際の判定とともに出す
  const keyCriteria = crit.filter((c) => c.on_fail === 'critical').slice(0, 3)

  return (
    <section aria-label="完了のまとめ" className={`rounded-2xl border-l-4 bg-panel px-5 py-4 ring-1 ring-edge ${t.cls}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="text-[1.15rem] font-bold text-white">{failedRun ? `${name}が途中で止まりました` : `${name}が完了しました`}</h2>
        <p className={`flex items-center gap-1.5 font-bold ${t.text}`}>
          <t.icon className="size-4.5" aria-hidden />
          {message}
        </p>
      </div>
      <dl className="mt-2.5 grid grid-cols-[repeat(4,auto)] justify-start gap-x-8 gap-y-1 text-[0.9rem]">
        <dt className="text-subtle">処理結果</dt>
        <dt className="text-subtle">品質検証（判定：{t.label}）</dt>
        <dt className="text-subtle">重大の基準</dt>
        <dt className="text-subtle">出力データ</dt>
        <dd className="font-bold text-white">{failedRun ? '途中で停止' : run.status === 'warning' ? '最後まで実行（お知らせあり）' : '最後まで実行（正常終了）'}</dd>
        <dd className="font-bold text-white">{crit.length ? `完了基準 ${crit.length}件のうち ${passed}件を満たした` : '完了基準なし（標準の確認のみ）'}</dd>
        <dd className="text-white">
          {keyCriteria.length
            ? keyCriteria.map((c) => (
                <span key={c.criterion_id} className="block">
                  {c.name}：<span className={c.status === 'passed' ? 'font-bold text-mint' : 'font-bold text-kaizen-text'}>{c.status === 'passed' ? '満たした' : c.status === 'failed' ? '満たしていない' : '確かめられなかった'}</span>
                </span>
              ))
            : 'なし'}
        </dd>
        <dd className="text-white">
          {failedRun || !outputs.length
            ? 'なし'
            : outputs.map((o) => (
                <span key={o} className="block">
                  {o}
                </span>
              ))}
        </dd>
      </dl>
    </section>
  )
}
