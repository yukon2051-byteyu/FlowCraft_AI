import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCompareArrows, LoaderCircle, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ApiError } from '../../../api/client'
import type { ApiErrorBody } from '../../../api/client'
import { listFiles, uploadFile } from '../../../api/files'
import { compareWithRun, runFlow } from '../../../api/flows'
import { useFlowStore } from '../../../flow/store'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'
import type { Analysis, Comparison } from './AnalysisReport'

/*
 * 前回のExcelと比較する（任意。分析 Phase B-3）。
 * 比較用のファイルで、同じ作業手順を別に実行し、その結果と今回の結果を比べる。データは混ぜない。
 * 比較用のファイルも、読み込めるファイルの上限（5つ）に含まれる（サーバーで確かめる）。
 * 比較用の実行は、正式な出力には使わない（今回の結果の画面はそのまま）。
 */

type Props = {
  runId: string
  onCompared: (v: { comparison: Comparison; analysis: Analysis }) => void
}

const unknownError = (message: string): ApiErrorBody => ({ code: 'UNKNOWN', message, cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })

export function CompareWithFile({ runId, onCompared }: Props) {
  const flow = useFlowStore((s) => s.flow)
  const bindings = useFlowStore((s) => s.bindings)
  const runValues = useFlowStore((s) => s.runValues)
  const queryClient = useQueryClient()
  const files = useQuery({ queryKey: ['files'], queryFn: listFiles })
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const defs = flow.input_definitions
  const fileOf = (inputId: string) => chosen[inputId] ?? ''
  // 今回と同じファイルだけでは比べる意味がない
  const changed = defs.some((d) => fileOf(d.input_id) && fileOf(d.input_id) !== bindings[d.input_id]?.file_id)
  const ready = defs.every((d) => fileOf(d.input_id) || bindings[d.input_id]) && changed

  const upload = async (list: FileList) => {
    setError(null)
    try {
      for (const f of Array.from(list)) await uploadFile(f)
    } catch (e) {
      setError(e instanceof ApiError ? e.body : unknownError('ファイルを読み込めませんでした。'))
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['files'] })
    }
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const baseBindings = defs.map((d) => {
        const cur = bindings[d.input_id]
        const fileId = fileOf(d.input_id) || cur.file_id
        // 比較用ファイルが別のファイルなら、今回の列の対応付けは使わない（シートは作業手順の指定に従う）
        return fileId === cur.file_id ? cur : { input_id: d.input_id, file_id: fileId, sheet: d.sheet_hint ?? null, header_row: d.header_row ?? 1, column_mapping: {} }
      })
      const baseline = await runFlow(flow, baseBindings, runValues)
      if (baseline.status === 'failed') {
        const stopped = baseline.nodes.find((n) => n.status === 'error')
        const issue = stopped?.issues[0]
        setError({
          code: 'COMPARE_RUN_FAILED',
          message: `比較用のファイルでは、最後まで処理できませんでした${stopped ? `（${stopped.node_name}）` : ''}。`,
          cause: issue?.message ?? null,
          how_to_fix: '比較用のファイルが、今回と同じ形式（列名・シート）かを確かめてください。',
          node_id: null,
        })
        return
      }
      const res = await compareWithRun(runId, baseline.run_id)
      onCompared({ comparison: res.comparison as unknown as Comparison, analysis: res.analysis as unknown as Analysis })
      setOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.body : unknownError('比べられませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outlineDark" size="sm" onClick={() => setOpen(true)}>
        <GitCompareArrows className="size-4" aria-hidden />
        前回のExcelと比較する（任意）
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl bg-white/4 p-4 ring-1 ring-edge" role="group" aria-label="前回のExcelと比較する">
      <p className="text-[0.88rem] text-white/85">
        比較用のファイルで同じ作業手順を別に実行し、今回の結果と比べます。データは混ぜません。比較用のファイルも、読み込めるファイルの数（5つまで）に含まれます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outlineDark" size="sm" onClick={() => uploadRef.current?.click()}>
          <Upload className="size-4" aria-hidden />
          比較用のファイルを読み込む
        </Button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          accept=".xlsx,.csv"
          className="hidden"
          data-testid="compare-file-input"
          onChange={(e) => {
            const l = e.target.files
            if (l?.length) void upload(l)
            e.target.value = ''
          }}
        />
      </div>
      <ul className="space-y-2">
        {defs.map((d) => (
          <li key={d.input_id} className="flex flex-wrap items-center gap-2 text-[0.88rem]">
            <span className="w-32 truncate font-bold text-white" title={d.label}>
              {d.label}
            </span>
            <select
              value={fileOf(d.input_id)}
              onChange={(e) => setChosen((c) => ({ ...c, [d.input_id]: e.target.value }))}
              aria-label={`「${d.label}」の比較用ファイル`}
              className="h-9 min-w-[16rem] rounded-lg bg-card px-2 text-ink ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
            >
              <option value="">（今回と同じファイル）</option>
              {(files.data ?? [])
                .filter((f) => f.kind === d.file_kind && f.file_id !== bindings[d.input_id]?.file_id)
                .map((f) => (
                  <option key={f.file_id} value={f.file_id}>
                    {f.filename}
                  </option>
                ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={!ready || busy} onClick={() => void run()}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <GitCompareArrows className="size-4" aria-hidden />}
          比較用のファイルで実行して比べる
        </Button>
        <Button variant="ghostDark" size="sm" onClick={() => setOpen(false)}>
          やめる
        </Button>
        {!changed && <span className="text-[0.82rem] text-subtle">比較用のファイルを1つ以上選んでください</span>}
      </div>
      {error && <ErrorNotice error={error} title="比べられませんでした" />}
    </div>
  )
}
