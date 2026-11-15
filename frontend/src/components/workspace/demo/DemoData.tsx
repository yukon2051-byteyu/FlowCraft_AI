import { useQueries, useQuery } from '@tanstack/react-query'
import { CircleCheck, FileSpreadsheet, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../../api/client'
import { fetchSheet, listFiles } from '../../../api/files'
import { useFlowStore } from '../../../flow/store'
import { ErrorNotice } from '../../ui/ErrorNotice'
import { FilePreview } from '../data/FilePreview'
import { DemoFrame } from './DemoFrame'
import { missingColumns } from './refs'

/**
 * デモ STEP 3「データを確認」：サンプルのExcel・CSVは読み込み済み（ファイル選択を強いない）。
 * 作業手順の入力ごとに、割り当てたファイル・件数・列の構成・中身を示し、作業手順が使う列がそろっているかを確かめる。
 */
export function DemoData({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const flow = useFlowStore((s) => s.flow)
  const bindings = useFlowStore((s) => s.bindings)
  const defs = flow.input_definitions
  const files = useQuery({ queryKey: ['files'], queryFn: listFiles })
  const sheets = useQueries({
    queries: defs.map((d) => {
      const b = bindings[d.input_id]
      return {
        queryKey: ['sheet', b?.file_id, b?.sheet ?? null, b?.header_row ?? 1],
        queryFn: () => fetchSheet(b!.file_id, b!.sheet, b!.header_row),
        enabled: !!b,
      }
    }),
  })
  const [selected, setSelected] = useState(0)
  const total = sheets.reduce((n, q) => n + (q.data?.row_count ?? 0), 0)
  const summaryOf = (fileId: string | undefined) => files.data?.find((f) => f.file_id === fileId)
  const sel = defs[selected]
  const selSummary = summaryOf(bindings[sel?.input_id]?.file_id)
  const selDetail = sheets[selected]?.data
  const error = [files.error, ...sheets.map((q) => q.error)].find((e) => e instanceof ApiError) as ApiError | undefined

  return (
    <DemoFrame back={{ label: '前へ：作業手順を確認', onClick: onBack }} next={{ label: '次へ：実行・品質確認', onClick: onNext }}>
      <header>
        <h1 className="text-[1.6rem] font-bold text-white">使用するデータ</h1>
        <p className="mt-1 text-[0.95rem] text-subtle">
          サンプルのファイル（架空のデータ）を読み込み済みです。
          <span className="ml-1 font-bold text-white">
            {defs.length}ファイル・合計 {total.toLocaleString()}行
          </span>
        </p>
      </header>
      {error && <ErrorNotice error={error.body} title="データを読み込めませんでした" />}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3" aria-label="使用するファイル">
        {defs.map((d, i) => {
          const q = sheets[i]
          const s = summaryOf(bindings[d.input_id]?.file_id)
          const miss = q.data ? missingColumns(d, q.data) : []
          return (
            <li key={d.input_id}>
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={i === selected}
                aria-label={`${d.label}：${s?.filename ?? ''}`}
                className={`w-full rounded-2xl p-4 text-left ring-1 transition focus-visible:outline-2 focus-visible:outline-mint ${i === selected ? 'bg-panel-hi ring-mint/60' : 'bg-panel ring-edge hover:ring-white/30'}`}
              >
                <p className="text-[0.8rem] font-bold text-mint">{d.label}</p>
                <p className="mt-1 flex items-center gap-1.5 font-bold text-white">
                  <FileSpreadsheet className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="truncate">{s?.filename ?? '—'}</span>
                </p>
                {q.isPending ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[0.85rem] text-subtle">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    読み込んでいます…
                  </p>
                ) : q.data ? (
                  <>
                    <p className="mt-1 text-[0.85rem] text-subtle">
                      {q.data.row_count.toLocaleString()}行・{q.data.column_count}列
                    </p>
                    <p className={`mt-2 flex items-start gap-1.5 text-[0.85rem] ${miss.length ? 'text-warning' : 'text-mint'}`}>
                      {miss.length ? <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />}
                      {miss.length ? `作業手順が使う列が足りません：${miss.join('、')}` : `作業手順が使う列（${d.columns.filter((c) => c.required !== false).length}列）はすべてあります`}
                    </p>
                  </>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      {sel && selSummary && selDetail && (
        <section aria-label={`${sel.label}の中身`}>
          <FilePreview key={selSummary.file_id} file={selSummary} initialDetail={selDetail} onDetailChange={() => {}} />
        </section>
      )}
    </DemoFrame>
  )
}
