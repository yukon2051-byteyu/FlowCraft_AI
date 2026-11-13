import { ArrowRight, Bot, ChevronRight, Clock3, Database, Eye, FileCode, FileSpreadsheet, Files, FolderOpen, KeyRound, Layers, Route, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AI_NOTE, HANDLING_SUMMARY } from '../../content/dataHandling'
import { isAvailable } from '../../content/featureStatus'
import { DataHandlingDialog } from '../ui/DataHandlingDialog'
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
  // データの取り扱いの説明（ファイルを選ぶ前に確かめられるように、選ぶ場所のすぐ下から開く）
  const [showHandling, setShowHandling] = useState(false)
  const openHandling = () => setShowHandling(true)
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
            const detail = await fetchSheet(summary.file_id, null, null) // 見出しの行は推定する
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
      {showHandling && <DataHandlingDialog onClose={() => setShowHandling(false)} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAny ? (
          // A案：左（約65%）＝ファイルを読み込む主操作、右（約35%）＝ほかの始め方。左右の上端をそろえ、高さはそろえない
          <div className="mx-auto grid max-w-[1400px] items-start gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
            <section className="light-panel space-y-4 rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)] p-7" aria-label="Excel・CSVを読み込む">
              <div>
                <p className="text-[0.85rem] font-bold text-forest">新しい作業を始める</p>
                <h1 className="mt-0.5 text-[1.75rem] leading-tight font-bold">Excel・CSVを読み込む</h1>
                <p className="mt-1.5 text-ink/80">処理したいExcel・CSVファイルを選んでください。読み込み後に、データの内容と列構成を確認できます。</p>
              </div>
              <Dropzone onFiles={addFiles} />
              <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1.5 text-[0.88rem] text-ink/75" aria-label="対応形式と上限">
                {LIMITS.map((l) => (
                  <li key={l.text} className="flex items-center gap-1.5">
                    <l.icon className="size-4 shrink-0 text-forest" aria-hidden />
                    {l.text}
                  </li>
                ))}
              </ul>
              <p className="-mt-1.5 text-center">
                <HandlingLink onClick={openHandling} />
              </p>
              {/* 上部の5つの段階を置き換えるものではない。初めての人に、読み込んだ後の流れを1行で示す */}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-mint-soft/70 px-4 py-2.5 text-[0.88rem] ring-1 ring-forest/15" aria-label="読み込み後の流れ">
                <span className="flex items-center gap-1.5 font-bold text-forest">
                  <Route className="size-4" aria-hidden />
                  読み込み後の流れ
                </span>
                {NEXT_FLOW.map((t, i) => (
                  <span key={t} className="flex items-center gap-x-3 text-ink/80">
                    {i > 0 && <ArrowRight className="size-3.5 text-forest/70" aria-hidden />}
                    {t}
                  </span>
                ))}
              </p>
              {notices}
            </section>
            <SideCards onShowSample={onShowSample} onOpenSaved={onOpenSaved} onOpenHandling={openHandling} />
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
              <p className="px-1">
                <HandlingLink onClick={openHandling} dark />
              </p>
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

/** 対応形式と上限（サーバーの設定 backend/app/config.py と同じ） */
const LIMITS: { icon: LucideIcon; text: string }[] = [
  { icon: FileSpreadsheet, text: 'Excel（.xlsx）・CSV' },
  { icon: FileCode, text: '文字コード：UTF-8・Shift_JIS' },
  { icon: Files, text: '最大5ファイル' },
  { icon: Database, text: '1ファイル10MB・合計10万行' },
]

const NEXT_FLOW = ['① データ内容・列構成の確認', '② 作業内容の入力', '③ 実行・品質確認']

/**
 * 右側「ほかの始め方」。保存した手順の再利用を最も目立たせ、ほかはコンパクトな行にする。
 * 開始方法を選ぶ大きなカード（すぐに自動化する／作業の見直しから始める）はこの画面に出さない
 * （AI業務改善診断の機能と設定 featureStatus.kaizen は残す。将来、別の導線から始められるようにする）。
 */
function SideCards({ onShowSample, onOpenSaved, onOpenHandling }: { onShowSample: () => void; onOpenSaved?: () => void; onOpenHandling: () => void }) {
  const deriveReady = isAvailable('derive')
  return (
    <aside className="space-y-3" aria-label="ほかの始め方">
      <p className="px-1 text-[0.85rem] font-bold tracking-wide text-subtle">ほかの始め方</p>

      <div className="rounded-2xl bg-panel p-5 ring-1 ring-mint/45 transition hover:ring-mint/70">
        <h2 className="flex items-center gap-2 text-[1.05rem] font-bold text-white">
          <FolderOpen className="size-5 shrink-0 text-mint" aria-hidden />
          保存した手順を再利用する
        </h2>
        <p className="mt-1.5 text-[0.9rem] leading-relaxed text-subtle">以前作った手順を開き、新しいExcelに差し替えて、同じ処理と品質確認を再実行できます。</p>
        <div className="mt-3">
          {/* ヘッダーの「作業手順を開く」と同じダイアログを開く */}
          <Button variant="outlineDark" size="sm" disabled={!onOpenSaved} onClick={onOpenSaved}>
            保存した手順を開く
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="divide-y divide-edge rounded-2xl bg-panel/60 ring-1 ring-edge">
        <button type="button" onClick={onShowSample} className="group flex w-full items-center gap-3 rounded-t-2xl px-4 py-3 text-left transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-mint">
          <Eye className="size-5 shrink-0 text-mint" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-white">サンプルで編集画面を見る</span>
            <span className="block text-[0.85rem] text-subtle">サンプルの手順で、処理内容の確認・変更を体験できます。</span>
          </span>
          <ChevronRight className="size-4.5 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-white" aria-hidden />
        </button>
        {/* 開発中：押せるように見せない（矢印・ホバーの表現をつけない） */}
        <div className="flex items-center gap-3 px-4 py-3" aria-disabled={!deriveReady} title={deriveReady ? undefined : 'この機能は開発中のため、まだ使えません'}>
          <Layers className="size-5 shrink-0 text-subtle" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-bold text-white/70">
              手順を複製してカスタマイズ
              <DevBadge feature="derive" />
            </span>
            <span className="block text-[0.85rem] text-subtle">保存済みの手順をもとに、別の業務用の手順を作成できる機能を開発しています。</span>
          </span>
        </div>
      </div>

      <AiAndData onOpen={onOpenHandling} />
    </aside>
  )
}

/** 「データの取り扱いを確認」（明るい面・暗い面のどちらにも置ける控えめなリンク） */
function HandlingLink({ onClick, dark = false }: { onClick: () => void; dark?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1 rounded text-[0.85rem] font-bold underline-offset-2 hover:underline focus-visible:outline-2 ' +
        (dark ? 'text-mint focus-visible:outline-mint' : 'text-forest focus-visible:outline-forest')
      }
    >
      <ShieldCheck className="size-4" aria-hidden />
      データの取り扱いを確認
    </button>
  )
}

/**
 * データの取り扱い（要点）。文章は src/content/dataHandling.ts の1か所だけに書く（TOP・確認の画面と同じ）。
 * 詳しい説明は「データの取り扱いを確認」の画面で読む。
 */
function AiAndData({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="rounded-2xl bg-panel/60 p-4 ring-1 ring-edge" aria-label="データの取り扱い">
      <h2 className="flex items-center gap-2 font-bold text-white">
        <ShieldCheck className="size-5 shrink-0 text-mint" aria-hidden />
        データの取り扱い
      </h2>
      <ul className="mt-2 space-y-1.5 text-[0.86rem] text-white/85">
        {HANDLING_SUMMARY.map((h) => {
          const Icon = h.kind === 'warn' ? TriangleAlert : h.kind === 'ai' ? Bot : Clock3
          return (
            <li key={h.text} className="flex gap-2">
              <Icon className={`mt-0.5 size-4 shrink-0 ${h.kind === 'warn' ? 'text-warning' : 'text-mint'}`} aria-hidden />
              {h.text}
            </li>
          )
        })}
      </ul>
      <p className="mt-2.5 flex gap-2 border-t border-edge pt-2.5 text-[0.84rem] leading-relaxed text-subtle">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
        {AI_NOTE}
      </p>
      <div className="mt-2">
        <HandlingLink onClick={onOpen} dark />
      </div>
    </section>
  )
}
