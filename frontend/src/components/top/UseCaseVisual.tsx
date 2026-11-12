import { ArrowDown, ArrowRight, Sheet } from 'lucide-react'

/*
 * 利用例「支店ごとにバラバラなExcelから、必要な列だけを集めて1つの表にする」の図。
 * 左：列の並びや名前が違う3つのファイル（暗いパネル。使う列をミントで強調）
 * 右：列をそろえて1つにまとめた結果（データなので明るいパネル）
 */

type Src = { file: string; cols: { name: string; use?: boolean }[] }

const SOURCES: Src[] = [
  {
    file: '東京支店.xlsx',
    cols: [{ name: '日付', use: true }, { name: '担当者' }, { name: '商品コード', use: true }, { name: '金額', use: true }, { name: '備考' }],
  },
  {
    file: '大阪支店.xlsx',
    cols: [{ name: '商品CD', use: true }, { name: '売上日', use: true }, { name: '数量' }, { name: '売上金額', use: true }],
  },
  {
    file: '名古屋支店.csv',
    cols: [{ name: '伝票No' }, { name: '日付', use: true }, { name: '品番', use: true }, { name: '税込金額', use: true }],
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
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)]">
      <div className="space-y-2.5">
        {SOURCES.map((s) => (
          <div key={s.file} className="rounded-xl bg-panel p-3 ring-1 ring-edge">
            <div className="mb-2 flex items-center gap-1.5 text-[0.82rem] font-bold text-white">
              <Sheet className="size-4 text-mint" aria-hidden />
              {s.file}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.cols.map((c) => (
                <span
                  key={c.name}
                  className={
                    c.use
                      ? 'rounded-md bg-mint/12 px-2 py-0.5 text-[0.78rem] font-bold text-mint ring-1 ring-mint/40'
                      : 'rounded-md px-2 py-0.5 text-[0.78rem] text-subtle/60 line-through decoration-subtle/40'
                  }
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center text-[0.8rem] font-bold text-mint">
        <span className="grid size-10 place-items-center rounded-full bg-mint text-on-mint shadow-[0_0_0_6px_rgba(56,217,173,0.15)]">
          <ArrowRight className="hidden size-5 lg:block" aria-hidden />
          <ArrowDown className="size-5 lg:hidden" aria-hidden />
        </span>
        列名の違いを
        <br />
        対応付けて統合
      </div>

      <div className="light-panel overflow-hidden rounded-xl shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
          <span className="text-[0.88rem] font-bold">全支店_売上一覧</span>
          <span className="rounded-full bg-mint-soft px-2 py-0.5 text-[0.72rem] font-bold text-forest">4列にそろえて統合</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.85rem]">
            <thead className="bg-paper text-muted">
              <tr>
                {RESULT_COLS.map((c) => (
                  <th key={c} className="px-3.5 py-2 text-left font-bold whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESULT_ROWS.map((r) => (
                <tr key={r.join()} className="border-t border-line">
                  {r.map((v, i) => (
                    <td key={i} className={`px-3.5 py-2 whitespace-nowrap ${i === 3 ? 'text-right tabular-nums' : ''}`}>
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
