import { ArrowRight, Clock3, Copy, Eye, FolderOpen, KeyRound, Lock, ScanSearch, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { isAvailable } from '../../content/featureStatus'
import type { FeatureKey } from '../../content/featureStatus'
import { DevBadge } from '../ui/DevBadge'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, hasSession } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { deleteFile, fetchSheet, listFiles, uploadFile } from '../../api/files'
import type { FileSummary, SheetDetail, UploadResult } from '../../api/files'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Dropzone } from './data/Dropzone'
import { FileList } from './data/FileList'
import type { FileEntry } from './data/FileList'
import { FilePreview } from './data/FilePreview'

const MAX_FILES = 5

/** initialDetail：最初に表示した内容。current：シート・見出し行を変えたあとの、今の内容 */
type Loaded = FileEntry & { initialDetail: SheetDetail; current: SheetDetail }

export type DefineSource = { summary: FileSummary; detail: SheetDetail }
type UploadFailure = { id: number; filename: string; error: ApiErrorBody }

/**
 * ワークスペースのステップ1「データを読み込む」。
 * ファイルを読み込み、列・型・先頭の行を確認する。
 */
type Props = {
  onShowSample: () => void
  onFileCountChange: (n: number) => void
  /** 「使う列と形式を決める」へ進む（各ファイルの、今選んでいるシート・見出し行の内容を渡す） */
  onDefine: (sources: DefineSource[]) => void
  /** 保存した作業手順を開く */
  onOpenSaved?: () => void
}

export function UploadStart({ onShowSample, onFileCountChange, onDefine, onOpenSaved }: Props) {
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
            return { summary, initialDetail: detail, current: detail, rowCount: detail.row_count, columnCount: detail.column_count, warningCount: detail.warnings.length }
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
            current: detail,
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
      if (!target || target.current === d) return prev
      return prev.map((f) =>
        f.summary.file_id === fileId ? { ...f, current: d, rowCount: d.row_count, columnCount: d.column_count, warningCount: d.warnings.length } : f,
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
            <section className="light-panel space-y-4 rounded-2xl p-7 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]">
              <div>
                <p className="text-[0.85rem] font-bold text-forest">新しい作業を始める</p>
                <h1 className="mt-0.5 text-[1.5rem] font-bold">データを読み込む</h1>
                <p className="mt-1.5 text-ink/80">処理に使うExcel・CSVファイルをすべて読み込んでください。複数ファイルの結合・統合にも対応しています。</p>
              </div>
              <RouteChooser />
              <Dropzone onFiles={addFiles} />
              <p className="text-center text-[0.88rem] text-muted">.xlsx ／ .csv（UTF-8・Shift_JIS）・最大5ファイル・1ファイル10MB・合計10万行まで</p>
              {notices}
            </section>
            <SideCards onShowSample={onShowSample} onOpenSaved={onOpenSaved} />
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1500px] gap-6 px-6 py-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[0.85rem] font-bold tracking-wide text-subtle">読み込んだファイル</h2>
                <span className="text-[0.8rem] text-subtle tabular-nums">
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
                <p className="rounded-2xl bg-panel px-6 py-16 text-center text-subtle ring-1 ring-edge">
                  {uploading.length ? 'ファイルを解析しています…' : '左の一覧からファイルを選ぶと、中身を確認できます。'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
          <p className="text-[0.92rem]">
            <span className="font-bold">{files.length}ファイル</span>
            <span className="text-subtle">（合計 {totalRows.toLocaleString()}行）を読み込みました。</span>
            <span className="ml-2 text-subtle">列名とデータの形式、先頭の行を確認してください。</span>
          </p>
          <div className="ml-auto flex items-center gap-3">
            {uploading.length > 0 && <span className="text-[0.85rem] text-subtle">ファイルの解析が終わるまでお待ちください</span>}
            <Button
              variant="primary"
              disabled={uploading.length > 0}
              onClick={() => onDefine(files.map((f) => ({ summary: f.summary, detail: f.current })))}
            >
              次へ：使う列と形式を決める
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 始め方の2つのルート（AI業務改善診断は任意）。
 *   A. すぐにExcel作業を自動化する：このままファイルを読み込む
 *   B. 作業の見直しから始める：AI業務改善診断（開発中のため選べない。見せかけの画面は作らない）
 * どちらを選んでも、同じ処理エンジンと同じ品質の確認を使う。途中で切り替えても、読み込んだファイルや作った手順は残す。
 */
function RouteChooser() {
  const kaizenReady = isAvailable('kaizen')
  return (
    <div role="radiogroup" aria-label="始め方" className="grid gap-2 sm:grid-cols-2">
      <div role="radio" aria-checked="true" className="rounded-xl bg-mint-soft p-3.5 ring-2 ring-forest/60">
        <p className="flex items-center gap-2 font-bold text-forest">
          <Zap className="size-4.5" aria-hidden />
          すぐにExcel作業を自動化する
        </p>
        <p className="mt-1 text-[0.88rem] text-ink/80">手順が決まっている作業は、このままファイルを読み込んで始められます。</p>
      </div>
      <div
        role="radio"
        aria-checked="false"
        aria-disabled={!kaizenReady}
        title={kaizenReady ? undefined : 'AI業務改善診断は開発中のため、まだ選べません'}
        className="rounded-xl bg-card p-3.5 ring-1 ring-line"
      >
        <p className="flex flex-wrap items-center gap-2 font-bold text-ink/70">
          <ScanSearch className="size-4.5" aria-hidden />
          作業の見直しから始める
          <DevBadge feature="kaizen" tone="light" />
        </p>
        <p className="mt-1 text-[0.88rem] text-muted">AI業務改善診断で、必要性・ムダ・重複している工程を確かめてから、自動化に進みます（任意）。</p>
      </div>
    </div>
  )
}

function SideCards({ onShowSample, onOpenSaved }: { onShowSample: () => void; onOpenSaved?: () => void }) {
  return (
    <aside className="space-y-4" aria-label="ほかの始め方">
      <p className="px-1 text-[0.85rem] font-bold tracking-wide text-subtle">ほかの始め方</p>
      <StartCard
        icon={FolderOpen}
        title="保存した作業手順を使う"
        body="以前作った作業手順のファイルを開き、新しいファイルで同じ処理を実行します。"
        action="作業手順を開く"
        feature="saveReuse"
        onClick={onOpenSaved}
      />
      <StartCard
        icon={Copy}
        title="既存の手順をもとに新しく作る"
        body="保存した作業手順をもとに、別の部署や業務に合わせて内容を変更します。"
        action="もとにする手順を選ぶ"
        feature="derive"
      />
      <div className="rounded-2xl bg-panel/60 p-5 ring-1 ring-edge">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <Eye className="size-5 text-mint" aria-hidden />
          編集画面を見てみる
        </h2>
        <p className="mt-1.5 text-[0.92rem] text-subtle">サンプルの作業手順で、処理内容の確認・変更の画面を表示します。</p>
        <div className="mt-3">
          <Button variant="outlineDark" size="sm" onClick={onShowSample}>
            サンプルで画面を見る
          </Button>
        </div>
      </div>

      <ul className="space-y-2 px-1 text-[0.85rem] text-subtle">
        <li className="flex gap-2">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          AIを使う操作のときだけ、AI使用パスワードの入力を求めます。読み込み・加工・集計はパスワードなしで使えます。
        </li>
        <li className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          AIには列名・データの形式・一部のサンプル値だけを送ります。
        </li>
        <li className="flex gap-2">
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          読み込んだデータは保存せず、60分で自動的に削除します。
        </li>
      </ul>
    </aside>
  )
}

function StartCard({ icon: Icon, title, body, action, feature, onClick }: { icon: LucideIcon; title: string; body: string; action: string; feature: FeatureKey; onClick?: () => void }) {
  const ready = isAvailable(feature)
  return (
    <div className="rounded-2xl bg-panel p-5 ring-1 ring-edge">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <Icon className="size-5 text-mint" aria-hidden />
          {title}
        </h2>
        <DevBadge feature={feature} />
      </div>
      <p className="mt-1.5 text-[0.92rem] text-subtle">{body}</p>
      <div className="mt-3">
        <Button variant="outlineDark" size="sm" disabled={!ready || !onClick} onClick={onClick} title={ready ? undefined : 'この機能は開発中のため、まだ使えません'}>
          {action}
        </Button>
      </div>
    </div>
  )
}
