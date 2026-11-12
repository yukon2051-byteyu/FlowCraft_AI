import { FileSpreadsheet, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { FileSummary } from '../../../api/files'

export type FileEntry = {
  summary: FileSummary
  rowCount: number
  columnCount: number
  warningCount: number
}

type Props = {
  files: FileEntry[]
  uploading: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  deletingId: string | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 読み込んだファイルの一覧（暗いサイドバー）。選択中はミントの枠で示す。削除は確認してから行う。 */
export function FileList({ files, uploading, selectedId, onSelect, onDelete, deletingId }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <ul className="space-y-2" aria-label="読み込んだファイル">
      {files.map(({ summary: f, rowCount, columnCount, warningCount }) => {
        const active = f.file_id === selectedId
        const confirming = confirmId === f.file_id
        return (
          <li key={f.file_id}>
            <div
              className={
                'rounded-xl ring-1 transition-colors ' +
                (active ? 'bg-panel-hi shadow-[0_0_0_1px_rgba(56,217,173,0.5),0_0_24px_-6px_rgba(56,217,173,0.45)] ring-mint' : 'bg-panel ring-edge hover:ring-white/20')
              }
            >
              <button
                type="button"
                onClick={() => onSelect(f.file_id)}
                aria-current={active ? 'true' : undefined}
                className="flex w-full items-start gap-2.5 rounded-xl px-3 pt-3 pb-2 text-left focus-visible:outline-2 focus-visible:outline-mint"
              >
                <FileSpreadsheet className={`mt-0.5 size-5 shrink-0 ${active ? 'text-mint' : 'text-subtle'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-white" title={f.filename}>
                    {f.filename}
                  </span>
                  <span className="block text-[0.8rem] text-subtle">
                    {f.kind === 'xlsx' ? `Excel・${f.sheets.length}シート` : `CSV・${f.encoding}`} ・ {formatSize(f.size_bytes)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.82rem]">
                    <span className="text-white/90 tabular-nums">
                      {rowCount.toLocaleString()}行 × {columnCount}列
                    </span>
                    {warningCount > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold text-warning">
                        <TriangleAlert className="size-3.5" aria-hidden />
                        確認事項 {warningCount}件
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <div className="flex items-center justify-end gap-2 border-t border-edge px-3 py-1.5">
                {confirming ? (
                  <>
                    <span className="mr-auto text-[0.82rem] font-bold text-error">このファイルを削除しますか？</span>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-md px-2 py-1 text-[0.82rem] font-bold text-subtle hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-mint"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(null)
                        onDelete(f.file_id)
                      }}
                      className="rounded-md bg-error-ink px-2.5 py-1 text-[0.82rem] font-bold text-white hover:bg-[#962e2e] focus-visible:outline-2 focus-visible:outline-error"
                    >
                      削除する
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(f.file_id)}
                    disabled={deletingId === f.file_id}
                    aria-label={`${f.filename} を削除`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.82rem] text-subtle hover:bg-error/15 hover:text-error focus-visible:outline-2 focus-visible:outline-error disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    削除
                  </button>
                )}
              </div>
            </div>
          </li>
        )
      })}
      {uploading.map((name, i) => (
        <li key={`${name}-${i}`} className="flex items-center gap-2.5 rounded-xl bg-panel px-3 py-3 ring-1 ring-edge">
          <LoaderCircle className="size-5 shrink-0 animate-spin text-mint" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-white">{name}</span>
            <span className="block text-[0.8rem] text-subtle">読み込み・解析中…</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
