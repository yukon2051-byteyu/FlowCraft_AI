import { ArrowDown, ArrowRight, Sheet } from 'lucide-react'

/*
 * 利用例「支店ごとにバラバラなExcelから、必要な列だけを集めて1つの表にする」の図。
 * 左：列の並びや名前が違う3つのファイル（使う列を強調）
 * 右：列をそろえて1つにまとめた結果
 */

type Src = { file: string; cols: { name: string; use?: string }[] }

const SOURCES: Src[] = [
  {
    file: '東京支店.xlsx',
    cols: [{ name: '日付', use: '日付' }, { name: '担当者' }, { name: '商品コード', use: '商品' }, { name: '金額', use: '金額' }, { name: '備考' }],
  },
  {
    file: '大阪支店.xlsx',
    cols: [{ name: '商品CD', use: '商品' }, { name: '売上日', use: '日付' }, { name: '数量' }, { name: '売上金額', use: '金額' }],
  },
  {
    file: '名古屋支店.csv',
    cols: [{ name: '伝票No' }, { name: '日付', use: '日付' }, { name: '品番', use: '商品' }, { name: '税込金額', use: '金額' }],
  },
]

const RESULT_COLS = ['支店', '日付', '商品コード', '金額']
const RESULT_ROWS = [
  ['東京', '11/01', 'A-1001', '128,000'],
  ['大阪', '11/01', 'B-2040', '54,600'],
  ['名古屋', '11/02', 'A-1001', '96,000'],
]

export function UseCaseVisual() {
  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="space-y-2.5">
        {SOURCES.map((s) => (
          <div key={s.file} className="rounded-lg bg-white p-3 ring-1 ring-line">
            <div className="mb-2 flex items-center gap-1.5 text-[0.82rem] font-bold">
              <Sheet className="size-4 text-success" aria-hidden />
              {s.file}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.cols.map((c) => (
                <span
                  key={c.name}
                  className={
                    c.use
                      ? 'rounded bg-accent-soft px-2 py-0.5 text-[0.78rem] font-bold text-accent ring-1 ring-accent/30'
                      : 'rounded px-2 py-0.5 text-[0.78rem] text-muted/70 line-through decoration-muted/40'
                  }
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1 text-center text-[0.8rem] font-bold text-accent">
        <span className="grid size-10 place-items-center rounded-full bg-accent text-white shadow">
          <ArrowRight className="hidden size-5 lg:block" aria-hidden />
          <ArrowDown className="size-5 lg:hidden" aria-hidden />
        </span>
        列名の違いを
        <br />
        対応付けて統合
      </div>

      <div className="overflow-hidden rounded-lg bg-white ring-1 ring-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[0.85rem] font-bold">全支店_売上一覧</span>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[0.72rem] font-bold text-success">4列にそろえて統合</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.82rem]">
            <thead className="bg-surface text-muted">
              <tr>
                {RESULT_COLS.map((c) => (
                  <th key={c} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESULT_ROWS.map((r) => (
                <tr key={r.join()} className="border-t border-line">
                  {r.map((v, i) => (
                    <td key={i} className={`px-3 py-1.5 whitespace-nowrap ${i === 3 ? 'text-right tabular-nums' : ''}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
