import { FileJson, FolderOpen, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { stepIndexOf, validateFlow } from '../../api/flows'
import { getSaved, listSaved, removeFromLibrary } from '../../flow/library'
import type { SavedFlowSummary } from '../../flow/library'
import { normalizeFlow } from '../../flow/ops'
import type { FlowDoc } from '../../flow/types'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'

/*
 * タスク1-9：保存した作業手順を開く画面（ダイアログ）。
 *
 * 開く元：①このブラウザの「保存した作業手順」 ②作業手順のファイル（.json）
 * 処理の流れ：読む → 省略された項目を補う → サーバーで形の決まりを検証 → 合格したものだけを開く
 * ファイルは利用者が持ち込むものなので、大きすぎるもの・JSONとして読めないもの・形の決まりに合わないものは開かない。
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024

type Props = {
  /** 今の作業手順に、保存していない変更があるか（開くと失われるため、確認する） */
  unsaved: boolean
  onOpened: (flow: FlowDoc) => void
  onClose: () => void
}

export function OpenDialog({ unsaved, onOpened, onClose }: Props) {
  const [saved, setSaved] = useState<SavedFlowSummary[]>(() => listSaved())
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const titleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 読んだ内容を検証し、合格したら開く */
  const open = async (raw: unknown, source: string) => {
    if (unsaved && !window.confirm('今の作業手順に、保存していない変更があります。別の作業手順を開くと、変更は失われます。開きますか？')) return
    setBusy(true)
    setProblems([])
    setError(null)
    try {
      const flow = normalizeFlow(raw)
      const result = await validateFlow(flow)
      if (!result.valid) {
        setProblems([
          `「${source}」は、作業手順の形の決まりに合わないため開けません。`,
          ...[
            ...result.schema_errors.map((e) => {
              const i = stepIndexOf(e.location)
              return i === null ? `${e.location}：${e.message}` : `ステップ${i + 1}：${e.message}`
            }),
            // 項目どうしのつながりの誤り（例：完了基準が存在しないステップを指している）
            ...result.issues.filter((x) => x.severity === 'error').map((x) => x.message),
          ].slice(0, 8),
        ])
        return
      }
      onOpened(flow)
    } catch (e) {
      setError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '作業手順を開けませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setBusy(false)
    }
  }

  const openFile = async (file: File) => {
    setProblems([])
    if (file.size > MAX_FILE_BYTES) {
      setProblems([`「${file.name}」は大きすぎます（2MBまで）。作業手順のファイルか確かめてください。`])
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setProblems([`「${file.name}」は作業手順のファイルとして読めません。FlowCraft AI で保存した .json ファイルを選んでください。`])
      return
    }
    if (!raw || typeof raw !== 'object' || !('nodes' in raw)) {
      setProblems([`「${file.name}」は作業手順のファイルではありません。FlowCraft AI で保存した .json ファイルを選んでください。`])
      return
    }
    await open(raw, file.name)
  }

  const remove = (s: SavedFlowSummary) => {
    if (!window.confirm(`「${s.flow_name}」（版${s.flow_version}）を、このブラウザの一覧から削除します。元に戻せません。削除しますか？`)) return
    const r = removeFromLibrary(s.flow_id)
    if (!r.ok) setProblems([r.error])
    setSaved(listSaved())
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="light-panel flex max-h-[85vh] w-full max-w-[680px] flex-col rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-[1.2rem] font-bold">
            <FolderOpen className="size-5 text-forest" aria-hidden />
            作業手順を開く
          </h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-muted hover:bg-ink/6 hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <section className="mt-4 min-h-0 flex-1 overflow-y-auto" aria-label="このブラウザに保存した作業手順">
          <h3 className="text-[0.9rem] font-bold">このブラウザに保存した作業手順</h3>
          {saved.length === 0 ? (
            <p className="mt-2 rounded-lg bg-ink/5 px-3 py-3 text-[0.9rem] text-ink/75">まだありません。作業手順を作って「作業手順を保存」を押すと、ここに表示されます。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {saved.map((s) => (
                <li key={s.flow_id} className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2 ring-1 ring-line">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{s.flow_name}</p>
                    <p className="text-[0.8rem] text-muted tabular-nums">
                      版{s.flow_version} ／ 入力{s.input_count}つ・ステップ{s.step_count}個 ／ 保存：{new Date(s.updated_at).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <Button size="sm" variant="dark" disabled={busy} onClick={() => void open(getSaved(s.flow_id), s.flow_name)}>
                    開く
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    aria-label={`「${s.flow_name}」を一覧から削除`}
                    className="rounded-full p-1.5 text-muted hover:bg-error-soft hover:text-error-ink"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-4 border-t border-line pt-4" aria-label="ファイルから開く">
          <h3 className="text-[0.9rem] font-bold">ファイルから開く</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileJson className="size-4" aria-hidden />
              作業手順のファイル（.json）を選ぶ
            </Button>
            <span className="text-[0.82rem] text-muted">ほかのPCで保存したファイルや、共有フォルダのファイルも開けます。</span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="flow-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void openFile(f)
              }}
            />
          </div>
        </section>

        {busy && (
          <p className="mt-3 flex items-center gap-1.5 text-[0.88rem] text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            作業手順を確かめています…
          </p>
        )}
        {problems.length > 0 && (
          <div className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-[0.88rem] text-error-ink ring-1 ring-error/40" role="alert">
            <p className="font-bold">{problems[0]}</p>
            {problems.length > 1 && (
              <ul className="mt-1 list-disc pl-5">
                {problems.slice(1).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNotice error={error} />
          </div>
        )}
      </div>
    </div>
  )
}
