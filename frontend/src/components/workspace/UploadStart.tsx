import { ArrowRight, Clock3, Eye, FileJson, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, hasSession } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { deleteFile, fetchSheet, listFiles, uploadFile } from '../../api/files'
import type { SheetDetail, UploadResult } from '../../api/files'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Dropzone } from './data/Dropzone'
import { FileList } from './data/FileList'
import type { FileEntry } from './data/FileList'
import { FilePreview } from './data/FilePreview'

const MAX_FILES = 5

type Loaded = FileEntry & { initialDetail: SheetDetail }
type UploadFailure = { id: number; filename: string; error: ApiErrorBody }

/**
 * ワークスペースのステップ1「データを読み込む」。
 * ファイルを読み込み、列・型・先頭の行を確認する。
 */
export function UploadStart({ onShowSample, onFileCountChange }: { onShowSample: () => void; onFileCountChange: (n: number) => void }) {
  const [files, setFiles] = useState<Loaded[]>([])
  const [uploading, setUploading] = useState<string[]>([])
  const [failures, setFailures] = useState<UploadFailure[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sessionLost, setSessionLost] = useState<ApiErrorBody | null>(null)

  const updateFiles = setFiles

  // 画面を開いたとき（再読み込み・サンプル表示から戻ったとき）、サーバーに残っているファイルを表示し直す
  useEffect(() => {
    if (!hasSession()) return
    let cancelled = false
    ;(async () => {
      try {
        const summaries = await listFiles()
        const restored = await Promise.all(
          summaries.map(async (summary): Promise<Loaded> => {
            const detail = await fetchSheet(summary.file_id, null, 1)
            return { summary, initialDetail: detail, rowCount: detail.row_count, columnCount: detail.column_count, warningCount: detail.warnings.length }
          }),
        )
        if (cancelled || restored.length === 0) return
        setFiles(restored)
        setSelectedId(restored[0].summary.file_id)
      } catch (e) {
        if (!cancelled) handleError(e)
      }
    })()
    return () => {
      cancelled = true
    }
    // 初回表示時に1回だけ実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 画面上部のステップ表示に、読み込んだファイル数を伝える
  useEffect(() => {
    onFileCountChange(files.length)
  }, [files.length, onFileCountChange])

  /** 時間切れなどでセッションが失われたら、画面上のファイルもすべて消して理由を伝える */
  const handleError = (e: unknown): ApiErrorBody | null => {
    if (e instanceof ApiError) {
      if (e.isSessionLost) {
        setSessionLost(e.body)
        updateFiles(() => [])
        setSelectedId(null)
        return null
      }
      return e.body
    }
    return { code: 'UNKNOWN', message: '予期しないエラーが発生しました。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }
  }

  const addFiles = async (picked: File[]) => {
    setSessionLost(null)
    const room = MAX_FILES - files.length
    const accepted = picked.slice(0, Math.max(room, 0))
    const rejected = picked.slice(accepted.length)
    if (rejected.length) {
      setFailures((f) => [
        ...f,
        ...rejected.map((r, i) => ({
          id: Date.now() + i,
          filename: r.name,
          error: {
            code: 'TOO_MANY_FILES',
            message: `読み込めるファイルは${MAX_FILES}つまでです。`,
            cause: null,
            how_to_fix: '使わないファイルを削除してから、もう一度読み込んでください。',
            node_id: null,
          },
        })),
      ])
    }
    // 上限やエラーの判定を正しく行うため、1つずつ順番に送る
    for (const file of accepted) {
      setUploading((u) => [...u, file.name])
      try {
        const result: UploadResult = await uploadFile(file)
        const { detail, ...summary } = result
        updateFiles((prev) => [
          ...prev,
          {
            summary,
            initialDetail: detail,
            rowCount: detail.row_count,
            columnCount: detail.column_count,
            warningCount: detail.warnings.length,
          },
        ])
        setSelectedId(result.file_id)
      } catch (e) {
        const body = handleError(e)
        if (body) setFailures((f) => [...f, { id: Date.now(), filename: file.name, error: body }])
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name)
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]
        })
      }
    }
  }

  const removeFile = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteFile(id)
      updateFiles((prev) => prev.filter((f) => f.summary.file_id !== id))
      setSelectedId((cur) => (cur === id ? (files.find((f) => f.summary.file_id !== id)?.summary.file_id ?? null) : cur))
    } catch (e) {
      const body = handleError(e)
      if (body) setFailures((f) => [...f, { id: Date.now(), filename: '削除', error: body }])
    } finally {
      setDeletingId(null)
    }
  }

  // プレビューでシート・見出し行を変えたとき、一覧の件数表示を合わせる（変化がなければ何もしない）
  const onDetailChange = useCallback((fileId: string, d: SheetDetail) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.summary.file_id === fileId)
      if (!target || (target.rowCount === d.row_count && target.columnCount === d.column_count && target.warningCount === d.warnings.length)) {
        return prev
      }
      return prev.map((f) =>
        f.summary.file_id === fileId ? { ...f, rowCount: d.row_count, columnCount: d.column_count, warningCount: d.warnings.length } : f,
      )
    })
  }, [])

  const selected = files.find((f) => f.summary.file_id === selectedId) ?? null
  const hasAny = files.length > 0 || uploading.length > 0
  const totalRows = files.reduce((s, f) => s + f.rowCount, 0)
  const full = files.length + uploading.length >= MAX_FILES

  const notices = (
    <>
      {sessionLost && <ErrorNotice error={sessionLost} title="読み込んだデータが削除されました" onDismiss={() => setSessionLost(null)} />}
      {failures.map((f) => (
        <ErrorNotice key={f.id} title={f.filename} error={f.error} onDismiss={() => setFailures((all) => all.filter((x) => x.id !== f.id))} />
      ))}
    </>
  )

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAny ? (
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="space-y-4 rounded-2xl bg-white p-7 shadow-sm ring-1 ring-line">
              <div>
                <h1 className="text-[1.5rem] font-bold text-navy">データを読み込む</h1>
                <p className="mt-1.5 text-ink/80">処理に使うExcel・CSVファイルをすべて読み込んでください。複数ファイルの結合・統合にも対応しています。</p>
              </div>
              <Dropzone onFiles={addFiles} />
              <p className="text-center text-[0.88rem] text-muted">.xlsx ／ .csv（UTF-8・Shift_JIS）・最大5ファイル・1ファイル10MB・合計10万行まで</p>
              {notices}
            </section>
            <SideCards onShowSample={onShowSample} />
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1500px] gap-6 px-6 py-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[0.85rem] font-bold tracking-wide text-muted">読み込んだファイル</h2>
                <span className="text-[0.8rem] text-muted tabular-nums">
                  {files.length} / {MAX_FILES}
                </span>
              </div>
              <FileList
                files={files}
                uploading={uploading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDelete={removeFile}
                deletingId={deletingId}
              />
              <Dropzone onFiles={addFiles} compact disabled={full} disabledReason={full ? `上限（${MAX_FILES}ファイル）に達しています` : undefined} />
              {notices}
            </aside>
            <div className="min-w-0">
              {selected ? (
                <FilePreview
                  key={selected.summary.file_id}
                  file={selected.summary}
                  initialDetail={selected.initialDetail}
                  onDetailChange={(d) => onDetailChange(selected.summary.file_id, d)}
                />
              ) : (
                <p className="rounded-2xl bg-white px-6 py-16 text-center text-muted ring-1 ring-line">
                  {uploading.length ? 'ファイルを解析しています…' : '左の一覧からファイルを選ぶと、中身を確認できます。'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex shrink-0 items-center gap-4 border-t border-line bg-white px-6 py-3">
          <p className="text-[0.92rem]">
            <span className="font-bold">{files.length}ファイル</span>
            <span className="text-muted">（合計 {totalRows.toLocaleString()}行）を読み込みました。</span>
            <span className="ml-2 text-muted">列名と型、先頭の行を確認してください。</span>
          </p>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[0.85rem] text-muted">AIによるフロー作成は開発中です</span>
            <Button variant="primary" disabled title="AIによるフロー作成は Phase 2 で実装します">
              次へ：作業を伝える
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function SideCards({ onShowSample }: { onShowSample: () => void }) {
  return (
    <aside className="space-y-4">
      <div className="rounded-2xl bg-white p-5 ring-1 ring-line">
        <h2 className="flex items-center gap-2 font-bold text-navy">
          <FileJson className="size-5 text-accent" aria-hidden />
          保存したフローを使う
        </h2>
        <p className="mt-1.5 text-[0.92rem] text-ink/80">前回保存したフロー（.json）を開き、新しいファイルで再実行できます。</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" disabled title="フローの読込は開発中です">
            フローを開く
          </Button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 ring-1 ring-line">
        <h2 className="flex items-center gap-2 font-bold text-navy">
          <Eye className="size-5 text-accent" aria-hidden />
          編集画面を見てみる
        </h2>
        <p className="mt-1.5 text-[0.92rem] text-ink/80">サンプルのフローで、フローの確認・設定・プレビュー画面を表示します。</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onShowSample}>
            サンプルフローで画面を見る
          </Button>
        </div>
      </div>

      <ul className="space-y-2 px-1 text-[0.85rem] text-muted">
        <li className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          AIには列名・型・一部のサンプル値のみ送信します。
        </li>
        <li className="flex gap-2">
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          データは保存せず、60分で自動削除します。
        </li>
      </ul>
    </aside>
  )
}
