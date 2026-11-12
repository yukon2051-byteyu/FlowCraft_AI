import { COLUMN_TYPE_LABEL } from '../../../api/files'
import type { ColumnType } from '../../../api/files'
import type { TablePreview } from '../../../api/flows'

/**
 * 処理の結果の表（先頭の一部）。表示している行数と全体の行数を分けて示す。
 * 明るいパネルの中で使う。
 */
export function PreviewTable({ table, title, maxHeight = '18rem' }: { table: TablePreview; title?: string; maxHeight?: string }) {
  const numeric = (i: number) => table.types[i] === 'integer' || table.types[i] === 'decimal'
  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[0.82rem] text-muted">
        {title && <span className="font-bold text-ink">{title}</span>}
        <span>
          先頭 <span className="font-bold text-ink tabular-nums">{table.shown.toLocaleString()}</span> 行 ／ 全{' '}
          <span className="font-bold text-ink tabular-nums">{table.total.toLocaleString()}</span> 行・{table.columns.length}列
        </span>
      </p>
      {table.columns.length === 0 ? (
        <p className="rounded-lg bg-paper px-3 py-4 text-center text-[0.85rem] text-muted ring-1 ring-line">列がありません。</p>
      ) : (
        <div className="overflow-auto rounded-lg ring-1 ring-line" style={{ maxHeight }}>
          <table className="w-full border-separate border-spacing-0 text-[0.82rem]">
            <thead className="sticky top-0 z-10">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={`${c}-${i}`} className="border-b border-line bg-card px-2.5 py-1.5 text-left font-bold whitespace-nowrap">
                    {c}
                    <span className="ml-1 text-[0.72rem] font-medium text-muted">{COLUMN_TYPE_LABEL[table.types[i] as ColumnType] ?? ''}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri} className="bg-paper hover:bg-mint-soft">
                  {r.map((v, ci) => (
                    <td key={ci} title={v ?? '空欄'} className={`max-w-[14rem] truncate border-b border-line px-2.5 py-1 whitespace-nowrap ${numeric(ci) ? 'text-right tabular-nums' : ''}`}>
                      {v === null ? <span className="text-[0.75rem] text-muted/60">（空欄）</span> : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
