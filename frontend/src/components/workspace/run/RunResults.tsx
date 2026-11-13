import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, CircleCheck, CircleMinus, CircleX, FileOutput, LoaderCircle, Save, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../../api/client'
import type { ApiErrorBody } from '../../../api/client'
import { fetchRun } from '../../../api/flows'
import type { RunSummary, StepRun } from '../../../api/flows'
import { contentSnapshot } from '../../../flow/ops'
import { useFlowStore } from '../../../flow/store'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'
import { IssueList } from './IssueList'
import { PreviewTable } from './PreviewTable'

/*
 * タスク1-6：作業手順全体の実行結果。
 * 結論（最後まで実行できたか）→ ステップごとの状態と件数 → 出力する表、の順に示す。
 * 正常・注意・重大の総合判定は Phase 2（完了基準）で加える。ここでは処理のエラー・警告だけで示す。
 */

const STEP_STATUS: Record<string, { label: string; icon: typeof CircleCheck; cls: string }> = {
  ok: { label: '完了', icon: CircleCheck, cls: 'bg-success-soft text-success-ink ring-success/30' },
  warning: { label: '確認が必要', icon: TriangleAlert, cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  error: { label: 'エラー', icon: CircleX, cls: 'bg-error-soft text-error-ink ring-error/40' },
  skipped: { label: '実行していない', icon: CircleMinus, cls: 'bg-ink/6 text-muted ring-ink/15' },
}

type Props = {
  run: RunSummary
  snap: string
  onBack: () => void
  onExport: () => void
  exporting: boolean
  /** 出力したファイルの名前（この実行で出力済みのとき） */
  exportedName: string | null
  exportError: ApiErrorBody | null
  /** 作業手順を保存する（今回だけの作業から、毎月の作業にする） */
  onSave: () => void
  /** 今の作業手順が保存済み（変更なし）か */
  saved: boolean
}

export function RunResults({ run, snap, onBack, onExport, exporting, exportedName, exportError, onSave, saved }: Props) {
  const flow = useFlowStore((s) => s.flow)
  const detail = useQuery({ queryKey: ['run', run.run_id], queryFn: () => fetchRun(run.run_id) })
  const [sheet, setSheet] = useState(0)
  const stale = contentSnapshot(flow) !== snap
  const stopped = run.nodes.findIndex((n) => n.status === 'error')
  const warnings = run.nodes.filter((n) => n.status === 'warning').length

  const headline =
    run.status === 'failed'
      ? stopped >= 0
        ? { icon: CircleX, cls: 'text-error', text: `ステップ${stopped + 1}「${run.nodes[stopped].node_name}」で止まりました`, sub: 'エラーの内容と直し方を確認してください。結果は出力できません。' }
        : { icon: CircleX, cls: 'text-error', text: '実行できませんでした', sub: '下の理由を確認してください。' }
      : run.status === 'warning'
        ? { icon: TriangleAlert, cls: 'text-warning', text: '最後まで実行しました（確認が必要なお知らせがあります）', sub: `確認が必要なステップ：${warnings}個。内容を確かめてください。` }
        : { icon: CircleCheck, cls: 'text-success', text: '最後まで実行しました', sub: '処理の中で行った確認（件数・合計の照合など）で、問題は見つかりませんでした。' }
  const Head = headline.icon
  const previews = detail.data?.output_previews ?? []

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] space-y-5 px-6 py-6">
          <section className="rounded-2xl bg-panel p-6 ring-1 ring-edge" aria-label="実行の結論">
            <p className={`flex items-center gap-2 text-[1.35rem] font-bold ${headline.cls}`}>
              <Head className="size-6" aria-hidden />
              {headline.text}
            </p>
            <p className="mt-1.5 text-subtle">{headline.sub}</p>
            <p className="mt-2 text-[0.85rem] text-subtle">
              実行日時：{new Date(run.executed_at).toLocaleString('ja-JP')} ／ 処理時間：{(run.duration_ms / 1000).toFixed(1)}秒
            </p>
            {stale && (
              <p className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-[0.88rem] text-warning ring-1 ring-warning/35">
                実行した後に作業手順を変更しました。この結果は変更前の内容です。作業手順に戻って、もう一度実行してください。
              </p>
            )}
            <p className="mt-3 text-[0.82rem] text-subtle">業務の完了基準による判定（正常・注意・重大）は、完了基準の機能ができてから表示します（開発中）。</p>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-4">
              <Button variant={run.status === 'failed' ? 'outlineDark' : 'primary'} onClick={onExport} disabled={exporting}>
                {exporting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileOutput className="size-4" aria-hidden />}
                {run.status === 'failed' ? '確認結果をExcelに出力する（調査用）' : 'Excelに出力する'}
              </Button>
              <span className="text-[0.85rem] text-subtle">
                {run.status === 'failed'
                  ? '処理結果のシートは含めず、「確認結果」と「処理の記録」だけを出力します。'
                  : '処理結果のシートに加えて、「確認結果」と「処理の記録」のシートも出力します。'}
              </span>
            </div>
            {exportedName && (
              <p className="mt-2 flex items-center gap-1.5 text-[0.88rem] text-success" role="status">
                <CircleCheck className="size-4" aria-hidden />
                「{exportedName}」を保存しました（ブラウザのダウンロード先をご確認ください）。
              </p>
            )}
            {exportError && (
              <div className="mt-3">
                <ErrorNotice error={exportError} />
              </div>
            )}

            {/* タスク1-11：保存は任意。出力して終わってもよいし、ここから保存して毎月使うこともできる（作り直し不要） */}
            {!stale && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-4" aria-label="作業手順の保存">
                {saved ? (
                  <p className="flex items-center gap-1.5 text-[0.88rem] text-subtle">
                    <CircleCheck className="size-4 text-success" aria-hidden />
                    この作業手順は保存済みです。次回は「作業手順を開く」から、新しいファイルで実行できます。
                  </p>
                ) : (
                  <>
                    <Button variant="outlineDark" size="sm" onClick={onSave}>
                      <Save className="size-4" aria-hidden />
                      この作業手順を保存する
                    </Button>
                    <span className="text-[0.85rem] text-subtle">
                      任意です。今回だけの作業なら、保存せずに終われます。毎月の作業なら、保存しておくと次回は新しいファイルを選ぶだけで実行できます。
                    </span>
                  </>
                )}
              </div>
            )}
          </section>

          {run.flow_issues.length > 0 && (
            <section className="light-panel rounded-2xl p-5">
              <IssueList issues={run.flow_issues} label="実行前に見つかった問題" />
            </section>
          )}

          <section className="light-panel rounded-2xl p-5" aria-label="ステップごとの結果">
            <h2 className="mb-3 font-bold">ステップごとの結果</h2>
            <ol className="space-y-1.5">
              {run.nodes.map((n, i) => (
                <StepRow key={n.node_id} n={n} index={i} defaultOpen={n.status === 'error' || n.status === 'warning'} />
              ))}
            </ol>
          </section>

          {run.outputs.length > 0 && (
            <section className="light-panel rounded-2xl p-5" aria-label="出力する表">
              <h2 className="font-bold">出力する表</h2>
              <p className="mt-0.5 text-[0.85rem] text-muted">先頭の一部を表示しています。すべての行は「Excelに出力する」で保存できます。</p>
              <div className="mt-3 mb-2 flex flex-wrap gap-1" role="tablist" aria-label="出力するシート">
                {run.outputs.map((o, i) => (
                  <button
                    key={o.sheet_name}
                    type="button"
                    role="tab"
                    aria-selected={i === sheet}
                    onClick={() => setSheet(i)}
                    className={`rounded-full px-3 py-1 text-[0.85rem] font-bold ring-1 ${i === sheet ? 'bg-forest text-white ring-forest' : 'bg-paper ring-line hover:ring-forest/50'}`}
                  >
                    {o.sheet_name}
                  </button>
                ))}
              </div>
              {detail.isPending && (
                <p className="flex items-center gap-1.5 text-[0.88rem] text-muted">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  表を読み込んでいます…
                </p>
              )}
              {detail.error instanceof ApiError && <ErrorNotice error={detail.error.body} />}
              {previews[sheet] && <PreviewTable table={previews[sheet]} maxHeight="24rem" />}
            </section>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          作業手順に戻る
        </Button>
      </div>
    </>
  )
}

function StepRow({ n, index, defaultOpen }: { n: StepRun; index: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const s = STEP_STATUS[n.status] ?? STEP_STATUS.skipped
  const Icon = s.icon
  const rows = n.input_rows.length ? `${n.input_rows.map((r) => r.toLocaleString()).join('＋')}行 → ` : ''
  return (
    <li className="rounded-lg bg-paper ring-1 ring-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[0.75rem] font-bold text-white">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate font-bold">{n.node_name}</span>
        <span className="text-[0.85rem] text-muted tabular-nums">
          {n.status === 'skipped' ? '' : `${rows}${n.output_rows === null ? '' : `${n.output_rows.toLocaleString()}行`}`}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.78rem] font-bold whitespace-nowrap ring-1 ring-inset ${s.cls}`}>
          <Icon className="size-3.5" aria-hidden />
          {s.label}
        </span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {(n.added_columns.length > 0 || n.removed_columns.length > 0) && (
            <p className="text-[0.82rem] text-ink/85">
              {n.added_columns.length > 0 && <span className="mr-3">増えた列：{n.added_columns.join('、')}</span>}
              {n.removed_columns.length > 0 && <span>なくなった列：{n.removed_columns.join('、')}</span>}
            </p>
          )}
          {n.issues.length ? <IssueList issues={n.issues} /> : <p className="text-[0.82rem] text-muted">{n.status === 'skipped' ? '前のステップで止まったため、実行していません。' : 'お知らせはありません。'}</p>}
        </div>
      )}
    </li>
  )
}
