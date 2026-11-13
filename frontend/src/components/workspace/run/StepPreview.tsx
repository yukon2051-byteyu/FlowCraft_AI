import { useMutation } from '@tanstack/react-query'
import { ArrowRight, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../../api/client'
import type { ApiErrorBody } from '../../../api/client'
import { previewStep } from '../../../api/flows'
import type { PreviewResult } from '../../../api/flows'
import { contentSnapshot } from '../../../flow/ops'
import { useFlowStore } from '../../../flow/store'
import type { FlowNode } from '../../../flow/types'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'
import { IssueList } from './IssueList'
import { PreviewTable } from './PreviewTable'

/**
 * タスク1-6：選んだステップまでを実際のデータで実行し、処理の前後のデータ・件数・お知らせを示す。
 * 確認済みでないステップがあっても実行できる（設定を確かめるため）。結果は保存しない。
 */
export function StepPreview({ node, index }: { node: FlowNode; index: number }) {
  const flow = useFlowStore((s) => s.flow)
  const bindings = useFlowStore((s) => s.bindings)
  const selectNode = useFlowStore((s) => s.selectNode)
  const [result, setResult] = useState<{ data: PreviewResult; snap: string } | null>(null)
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const [view, setView] = useState<'after' | number>('after')

  const mutation = useMutation({
    mutationFn: () => previewStep(flow, Object.values(bindings), node.node_id),
    onSuccess: (data) => {
      setResult({ data, snap: contentSnapshot(flow) })
      setError(null)
      setView(data.output ? 'after' : 0)
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'テスト実行ができませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }),
  })

  const stale = result !== null && result.snap !== contentSnapshot(flow)
  const data = result?.data
  const stoppedIndex = data?.stopped_at ? flow.nodes.findIndex((n) => n.node_id === data.stopped_at) : -1
  const run = data?.node
  const tables = data ? [...data.inputs.map((t, i) => ({ key: i as number | 'after', label: data.inputs.length > 1 ? `処理前${i + 1}` : '処理前', table: t })), ...(data.output ? [{ key: 'after' as const, label: '処理後', table: data.output }] : [])] : []
  const shown = tables.find((t) => t.key === view) ?? tables[0]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={result ? 'secondary' : 'primary'} size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : result ? <RefreshCw className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {result ? 'もう一度実行する' : 'このステップまで実行して確かめる'}
        </Button>
        <span className="text-[0.8rem] text-muted">読み込んだファイルで実行します。結果は保存しません。</span>
      </div>

      {error && <ErrorNotice error={error} />}
      {stale && <p className="rounded-lg bg-warning-soft px-3 py-2 text-[0.85rem] ring-1 ring-warning/35">実行した後に作業手順を変更しました。最新の内容で確かめるには、もう一度実行してください。</p>}

      {data && !run && stoppedIndex >= 0 && (
        <div className="rounded-lg bg-error-soft px-3 py-2.5 text-[0.88rem] ring-1 ring-error/30">
          <p className="font-bold text-error-ink">
            ステップ{stoppedIndex + 1}「{flow.nodes[stoppedIndex].node_name}」で問題が見つかったため、このステップまで実行できませんでした。
          </p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => selectNode(flow.nodes[stoppedIndex].node_id)}>
            ステップ{stoppedIndex + 1}を開いて確かめる
          </Button>
        </div>
      )}
      {data && <IssueList issues={data.flow_issues} label="実行前のお知らせ" />}

      {run && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-[0.9rem]" aria-label="件数の変化">
            <span className="text-muted">ステップ{index + 1}</span>
            <span className="font-bold tabular-nums">{run.input_rows.length ? run.input_rows.map((r) => `${r.toLocaleString()}行`).join(' ＋ ') : '—'}</span>
            <ArrowRight className="size-4 text-forest" aria-hidden />
            <span className="font-bold tabular-nums">{run.output_rows === null ? '—' : `${run.output_rows.toLocaleString()}行`}</span>
            <span className="text-[0.8rem] text-muted">（{run.duration_ms.toLocaleString()}ミリ秒）</span>
          </p>
          {(run.added_columns.length > 0 || run.removed_columns.length > 0) && (
            <p className="text-[0.85rem] text-ink/85">
              {run.added_columns.length > 0 && <span className="mr-3">増えた列：{run.added_columns.join('、')}</span>}
              {run.removed_columns.length > 0 && <span>なくなった列：{run.removed_columns.join('、')}</span>}
            </p>
          )}
          <IssueList issues={run.issues} />
        </>
      )}

      {shown && (
        <div>
          {tables.length > 1 && (
            <div className="mb-2 flex gap-1" role="tablist" aria-label="表示するデータ">
              {tables.map((t) => (
                <button
                  key={String(t.key)}
                  type="button"
                  role="tab"
                  aria-selected={t.key === shown.key}
                  onClick={() => setView(t.key)}
                  className={`rounded-full px-3 py-1 text-[0.82rem] font-bold ring-1 ${t.key === shown.key ? 'bg-forest text-white ring-forest' : 'bg-paper text-ink ring-line hover:ring-forest/50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <PreviewTable table={shown.table} />
        </div>
      )}
    </div>
  )
}
