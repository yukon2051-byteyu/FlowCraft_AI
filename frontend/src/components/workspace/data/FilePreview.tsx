import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Info, LoaderCircle, Minus, Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../../../api/client'
import { COLUMN_TYPE_LABEL, fetchSheet } from '../../../api/files'
import type { ColumnType, FileSummary, SheetDetail } from '../../../api/files'
import { ErrorNotice } from '../../ui/ErrorNotice'

type Props = {
  file: FileSummary
  initialDetail: SheetDetail
  onDetailChange: (detail: SheetDetail) => void
}

type Tab = 'data' | 'columns'

/**
 * 選んだファイルの中身（設計書 §12.1）。
 * 件数は全件、表は先頭の一部だけ（「表示件数」と「総件数」を区別して見せる）。
 */
export function FilePreview({ file, initialDetail, onDetailChange }: Props) {
  const [sheet, setSheet] = useState(initialDetail.sheet)
  const [headerRow, setHeaderRow] = useState(initialDetail.header_row)
  const [tab, setTab] = useState<Tab>('data')

  const isInitial = sheet === initialDetail.sheet && headerRow === initialDetail.header_row
  const query = useQuery({
    queryKey: ['sheet', file.file_id, sheet, headerRow],
    queryFn: () => fetchSheet(file.file_id, sheet, headerRow),
    initialData: isInitial ? initialDetail : undefined,
    placeholderData: keepPreviousData,
  })
  const detail = query.data

  // シートや見出し行を変えたら、一覧の行数・列数の表示も更新する
  useEffect(() => {
    if (query.data && !query.isPlaceholderData) onDetailChange(query.data)
  }, [query.data, query.isPlaceholderData, onDetailChange])
  const visibleSheets = file.sheets

  return (
    <section className="light-panel rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]" aria-label={`${file.filename} の内容`}>
      {/* 見出し：ファイル名・シート・見出し行 */}
      <div className="border-b border-line px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="min-w-0 truncate text-[1.25rem] font-bold text-ink" title={file.filename}>
            {file.filename}
          </h2>
          {query.isFetching && <LoaderCircle className="size-4.5 animate-spin text-forest" aria-label="読み込み中" />}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
          {file.kind === 'xlsx' && (
            <label className="flex flex-col gap-1">
              <span className="text-[0.8rem] font-bold text-muted">シート</span>
              <select
                value={sheet}
                onChange={(e) => {
                  setSheet(e.target.value)
                  setHeaderRow(1)
                }}
                className="h-9 min-w-44 rounded-lg bg-card px-2.5 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              >
                {visibleSheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                    {s.hidden ? '（非表示シート）' : ''}
                    {s.is_empty ? '（空）' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-col gap-1">
            <span id="header-row-label" className="text-[0.8rem] font-bold text-muted">
              見出し（列名）の行
            </span>
            <div className="flex items-center gap-1" role="group" aria-labelledby="header-row-label">
              <StepButton label="見出し行を上へ" disabled={headerRow <= 1} onClick={() => setHeaderRow((v) => v - 1)} icon="minus" />
              <span className="w-16 text-center font-bold tabular-nums" aria-live="polite">
                {headerRow}行目
              </span>
              <StepButton label="見出し行を下へ" disabled={headerRow >= 100} onClick={() => setHeaderRow((v) => v + 1)} icon="plus" />
            </div>
          </div>
          {detail && (
            <dl className="ml-auto flex gap-6">
              <Metric label="行数" value={`${detail.row_count.toLocaleString()}行`} />
              <Metric label="列数" value={`${detail.column_count}列`} />
              <Metric label="確認事項" value={`${detail.warnings.length}件`} tone={detail.warnings.length ? 'warning' : undefined} />
            </dl>
          )}
        </div>
      </div>

      {query.error instanceof ApiError && (
        <div className="px-6 pt-4">
          <ErrorNotice error={query.error.body} />
        </div>
      )}

      {detail && (
        <div className="px-6 py-5">
          {detail.warnings.length > 0 && (
            <ul className="mb-4 space-y-1.5 rounded-xl bg-warning-soft p-3.5 ring-1 ring-warning/25" aria-label="確認事項">
              {detail.warnings.map((w) => (
                <li key={w.code} className="flex gap-2 text-[0.9rem] text-ink">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
                  {w.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 flex items-center gap-1 border-b border-line" role="tablist">
            <TabButton active={tab === 'data'} onClick={() => setTab('data')}>
              データ（先頭{detail.preview.shown}行）
            </TabButton>
            <TabButton active={tab === 'columns'} onClick={() => setTab('columns')}>
              列の情報（{detail.column_count}列）
            </TabButton>
          </div>

          {tab === 'data' ? <DataTable detail={detail} /> : <ColumnTable detail={detail} />}
        </div>
      )}
    </section>
  )
}

function DataTable({ detail }: { detail: SheetDetail }) {
  const { preview } = detail
  if (preview.columns.length === 0) {
    return <p className="rounded-xl bg-card px-4 py-8 text-center text-muted">このシートにはデータがありません。</p>
  }
  return (
    <>
      <p className="mb-2 text-[0.88rem] text-muted">
        表示：先頭 <span className="font-bold text-ink tabular-nums">{preview.shown.toLocaleString()}</span> 行 ／ 全{' '}
        <span className="font-bold text-ink tabular-nums">{preview.total.toLocaleString()}</span> 行（件数・型は全件で集計）
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-xl ring-1 ring-line">
        <table className="w-full border-separate border-spacing-0 text-[0.9rem]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border-b border-line bg-card px-3 py-2 text-right text-[0.78rem] font-bold text-muted">#</th>
              {preview.columns.map((c, i) => (
                <th key={`${c}-${i}`} className="border-b border-line bg-card px-3 py-2 text-left font-bold whitespace-nowrap text-ink">
                  {c}
                  <span className="ml-1.5 text-[0.75rem] font-medium text-muted">{COLUMN_TYPE_LABEL[detail.columns[i]?.inferred_type ?? 'string']}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-mint-soft">
                <td className="sticky left-0 border-b border-line bg-paper px-3 py-1.5 text-right text-[0.78rem] text-muted tabular-nums">
                  {ri + 1}
                </td>
                {r.map((v, ci) => (
                  <td
                    key={ci}
                    title={v ?? '空欄'}
                    className={`max-w-[18rem] truncate border-b border-line px-3 py-1.5 whitespace-nowrap ${isNumeric(detail.columns[ci]?.inferred_type) ? 'text-right tabular-nums' : ''}`}
                  >
                    {v === null ? <span className="text-[0.8rem] text-muted/60">（空欄）</span> : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ColumnTable({ detail }: { detail: SheetDetail }) {
  return (
    <>
      <p className="mb-2 flex items-center gap-1.5 text-[0.88rem] text-muted">
        <Info className="size-4" aria-hidden />
        型は値から推定したものです。データ自体は変換していません。
      </p>
      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-[0.9rem]">
          <thead className="bg-card text-[0.82rem] text-muted">
            <tr>
              {['列名', '推定した型', '空欄', '値の種類', '値の例', '補足'].map((h) => (
                <th key={h} className="border-b border-line px-3 py-2 text-left font-bold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((c, i) => (
              <tr key={`${c.name}-${i}`} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-bold whitespace-nowrap">{c.name}</td>
                <td className="px-3 py-2">
                  <TypeBadge type={c.inferred_type} />
                </td>
                <td className={`px-3 py-2 whitespace-nowrap tabular-nums ${c.null_count > 0 ? 'font-bold text-warning-ink' : 'text-muted'}`}>
                  {c.null_count.toLocaleString()}件
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted tabular-nums">{c.unique_count.toLocaleString()}種類</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-muted" title={c.samples.join('、')}>
                  {c.samples.join('、') || '—'}
                </td>
                <td className="px-3 py-2 text-[0.85rem]">
                  {c.note ? <span className="text-warning-ink">{c.note}</span> : <span className="text-muted/60">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// 型は「状態」ではないので、状態色（緑・アンバー等）は使わない。数値だけミント系で区別する
const TYPE_STYLE: Record<ColumnType, string> = {
  string: 'bg-ink/6 text-ink ring-ink/10',
  integer: 'bg-mint-soft text-forest ring-forest/20',
  decimal: 'bg-mint-soft text-forest ring-forest/20',
  date: 'bg-paper text-ink ring-ink/20',
  boolean: 'bg-paper text-ink ring-ink/20',
}

function TypeBadge({ type }: { type: ColumnType }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[0.8rem] font-bold whitespace-nowrap ring-1 ring-inset ${TYPE_STYLE[type]}`}>
      {COLUMN_TYPE_LABEL[type]}
    </span>
  )
}

function isNumeric(t: ColumnType | undefined): boolean {
  return t === 'integer' || t === 'decimal'
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className="text-right">
      <dt className="text-[0.78rem] font-bold text-muted">{label}</dt>
      <dd className={`text-[1.15rem] font-bold tabular-nums ${tone === 'warning' ? 'text-warning-ink' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

function StepButton({ label, disabled, onClick, icon }: { label: string; disabled: boolean; onClick: () => void; icon: 'minus' | 'plus' }) {
  const Icon = icon === 'minus' ? Minus : Plus
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg bg-card ring-1 ring-line hover:bg-mint-soft focus-visible:outline-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        '-mb-px border-b-2 px-4 py-2 text-[0.92rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-forest ' +
        (active ? 'border-mint text-forest' : 'border-transparent text-muted hover:text-ink')
      }
    >
      {children}
    </button>
  )
}
