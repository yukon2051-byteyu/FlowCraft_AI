import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Info, LoaderCircle, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { COLUMN_TYPE_LABEL, fetchSheet, listFiles, typeCheck, uploadFile } from '../../api/files'
import { assignProblems, checkColumns, suggestAssignments } from '../../flow/assign'
import type { AssignState } from '../../flow/assign'
import { useFlowStore } from '../../flow/store'
import type { InputDefinition } from '../../flow/types'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'

/*
 * タスク1-9：保存した作業手順に、今回のファイルを割り当てる画面。
 *
 * 入力（例：売上実績・商品マスタ）ごとに、読み込んだファイル・シート・見出しの行を選ぶ。
 * 選ぶとすぐに、作業手順で決めた列がそろっているか・決めた形式に変換できるかを確かめる。
 *   必須の列がない／変換できない値がある → 実行前に止める（理由を示し、先へ進めない）
 *   任意の列がない → 注意（空欄の列として読み込む）
 *   使わない列がある → お知らせ（読み込まない）
 */

type Choice = { fileId: string | null; sheet: string | null; headerRow: number }

type Props = {
  onDone: () => void
  /** ファイルを割り当てずに、作業手順の中身だけを見る */
  onSkip: () => void
}

export function AssignInputs({ onDone, onSkip }: Props) {
  const flow = useFlowStore((s) => s.flow)
  const setBinding = useFlowStore((s) => s.setBinding)
  const clearBindings = useFlowStore((s) => s.clearBindings)
  const defs = flow.input_definitions
  const queryClient = useQueryClient()
  const files = useQuery({ queryKey: ['files'], queryFn: listFiles })
  const fileList = files.data ?? []
  const fileNames = Object.fromEntries(fileList.map((f) => [f.file_id, f.filename]))

  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(defs.map((d) => [d.input_id, { fileId: null, sheet: null, headerRow: d.header_row ?? 1 }])),
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<ApiErrorBody | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const sheetFor = (d: InputDefinition, fileId: string): string | null => {
    const f = fileList.find((x) => x.file_id === fileId)
    if (!f || f.kind !== 'xlsx') return null
    return d.sheet_hint && f.sheets.some((s) => s.name === d.sheet_hint) ? d.sheet_hint : null
  }
  const choose = (d: InputDefinition, fileId: string | null) =>
    setChoices((c) => ({ ...c, [d.input_id]: { ...c[d.input_id], fileId, sheet: fileId ? sheetFor(d, fileId) : null } }))

  // ファイル名から候補を選ぶ（まだ選んでいない入力だけ。曖昧なときは選ばない）
  const fileKey = fileList.map((f) => f.file_id).join(',')
  useEffect(() => {
    if (!fileList.length) return
    const suggested = suggestAssignments(defs, fileList)
    setChoices((c) => {
      const next = { ...c }
      const used = new Set(Object.values(c).map((x) => x.fileId))
      for (const d of defs) {
        const f = suggested[d.input_id]
        if (!next[d.input_id].fileId && f && !used.has(f)) next[d.input_id] = { ...next[d.input_id], fileId: f, sheet: sheetFor(d, f) }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  // 選んだファイルの列を読む
  const sheets = useQueries({
    queries: defs.map((d) => {
      const c = choices[d.input_id]
      return {
        queryKey: ['sheet', c.fileId, c.sheet, c.headerRow],
        queryFn: () => fetchSheet(c.fileId!, c.sheet, c.headerRow),
        enabled: !!c.fileId,
      }
    }),
  })
  // 作業手順で決めた形式に、全件を変換できるか
  const checks = useQueries({
    queries: defs.map((d, i) => {
      const c = choices[d.input_id]
      const detail = sheets[i].data
      const present = new Set(detail?.columns.map((x) => x.name) ?? [])
      const cols = d.columns.filter((x) => present.has(x.name)).map((x) => ({ name: x.name, type: x.type }))
      return {
        queryKey: ['typeCheck', c.fileId, detail?.sheet, c.headerRow, cols],
        queryFn: () => typeCheck(c.fileId!, detail!.sheet, c.headerRow, cols),
        enabled: !!c.fileId && !!detail && cols.length > 0,
        placeholderData: keepPreviousData,
      }
    }),
  })

  const state: Record<string, AssignState> = Object.fromEntries(
    defs.map((d, i) => [d.input_id, { fileId: choices[d.input_id].fileId, columns: sheets[i].data?.columns.map((c) => c.name) ?? null }]),
  )
  const failedByInput = defs.map((d, i) => (choices[d.input_id].fileId && !checks[i].isPlaceholderData ? (checks[i].data ?? []).filter((r) => r.failed > 0) : []))
  const reasons = [
    ...assignProblems(defs, state, fileNames),
    ...defs.flatMap((d, i) => (failedByInput[i].length ? [`「${d.label}」の${failedByInput[i].map((r) => `「${r.name}」`).join('')}に、作業手順で決めた形式にできない値があります`] : [])),
    ...(defs.some((d, i) => choices[d.input_id].fileId && (sheets[i].isFetching || checks[i].isFetching)) ? ['列と形式を確認しています…'] : []),
    ...(sheets.some((q) => q.isError) || checks.some((q) => q.isError) ? ['確認できなかったファイルがあります。画面の案内に沿って対処してください'] : []),
  ]
  const canDone = reasons.length === 0

  const upload = async (list: FileList) => {
    setUploading(true)
    setUploadError(null)
    try {
      for (const f of Array.from(list)) await uploadFile(f)
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'ファイルを読み込めませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setUploading(false)
      await queryClient.invalidateQueries({ queryKey: ['files'] })
    }
  }

  const done = () => {
    clearBindings()
    defs.forEach((d, i) => {
      const c = choices[d.input_id]
      setBinding({ input_id: d.input_id, file_id: c.fileId!, sheet: sheets[i].data?.sheet ?? null, header_row: c.headerRow, column_mapping: {} })
    })
    onDone()
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0">
              <p className="text-[0.85rem] font-bold text-mint">保存した作業手順で実行する</p>
              <h1 className="mt-0.5 text-[1.5rem] font-bold text-white">「{flow.flow_name}」に、今回のファイルを割り当てる</h1>
              <p className="mt-1.5 max-w-3xl text-subtle">
                作業手順（版{flow.flow_version}・ステップ{flow.nodes.length}個）を開きました。入力ごとに、今回使うファイルを選んでください。
                作業手順で決めた列がそろっているかを、実行する前に確かめます。
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outlineDark" size="sm" disabled={uploading} onClick={() => uploadRef.current?.click()}>
                {uploading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                ファイルを読み込む
              </Button>
              <input
                ref={uploadRef}
                type="file"
                multiple
                accept=".xlsx,.csv"
                className="hidden"
                data-testid="assign-file-input"
                onChange={(e) => {
                  const l = e.target.files
                  if (l?.length) void upload(l)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {uploadError && <ErrorNotice error={uploadError} title="ファイルを読み込めませんでした" />}
          {files.error instanceof ApiError && <ErrorNotice error={files.error.body} />}
          {files.isSuccess && fileList.length === 0 && (
            <p className="rounded-xl bg-panel px-4 py-3 text-subtle ring-1 ring-edge">まだファイルを読み込んでいません。右上の「ファイルを読み込む」から、今回使うExcel・CSVを読み込んでください。</p>
          )}

          {defs.map((d, i) => {
            const c = choices[d.input_id]
            const file = fileList.find((f) => f.file_id === c.fileId)
            const detail = sheets[i].data
            const cols = state[d.input_id].columns
            const check = cols ? checkColumns(d, cols) : null
            const results = Object.fromEntries((checks[i].data ?? []).map((r) => [r.name, r]))
            return (
              <section key={d.input_id} className="light-panel rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]" aria-label={`入力「${d.label}」の割当`}>
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line px-6 pt-5 pb-4">
                  <div className="min-w-0">
                    <p className="text-[0.8rem] font-bold text-muted">入力 {i + 1}</p>
                    <h2 className="text-[1.15rem] font-bold">{d.label}</h2>
                    <p className="text-[0.82rem] text-muted">
                      {d.file_kind === 'xlsx' ? 'Excel' : 'CSV'} ／ 使う列 {d.columns.length}列（必須 {d.columns.filter((x) => x.required).length}列）
                    </p>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.8rem] font-bold text-muted">使うファイル</span>
                    <select
                      value={c.fileId ?? ''}
                      onChange={(e) => choose(d, e.target.value || null)}
                      aria-label={`「${d.label}」に使うファイル`}
                      className="h-10 w-80 rounded-lg bg-card px-2 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                    >
                      <option value="">（選ぶ）</option>
                      {fileList
                        .filter((f) => f.kind === d.file_kind)
                        .map((f) => (
                          <option key={f.file_id} value={f.file_id}>
                            {f.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                  {file?.kind === 'xlsx' && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.8rem] font-bold text-muted">シート</span>
                      <select
                        value={detail?.sheet ?? c.sheet ?? ''}
                        onChange={(e) => setChoices((x) => ({ ...x, [d.input_id]: { ...c, sheet: e.target.value } }))}
                        aria-label={`「${d.label}」のシート`}
                        className="h-10 w-48 rounded-lg bg-card px-2 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                      >
                        {file.sheets.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {file && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.8rem] font-bold text-muted">見出しの行</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={c.headerRow}
                        onChange={(e) => setChoices((x) => ({ ...x, [d.input_id]: { ...c, headerRow: Math.min(50, Math.max(1, Number(e.target.value) || 1)) } }))}
                        aria-label={`「${d.label}」の見出しの行`}
                        className="h-10 w-20 rounded-lg bg-card px-2 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                      />
                    </label>
                  )}
                  {detail && (
                    <p className="ml-auto flex items-center gap-1.5 text-[0.85rem] text-muted">
                      <FileSpreadsheet className="size-4" aria-hidden />
                      {detail.row_count.toLocaleString()}行 × {detail.column_count}列
                    </p>
                  )}
                </div>

                <div className="px-6 py-4">
                  {!c.fileId && <p className="text-[0.9rem] text-muted">ファイルを選ぶと、列がそろっているかを確かめます。</p>}
                  {sheets[i].error instanceof ApiError && <ErrorNotice error={sheets[i].error.body} />}
                  {checks[i].error instanceof ApiError && <ErrorNotice error={checks[i].error.body} title="データの形式を確認できませんでした" />}
                  {c.fileId && sheets[i].isPending && (
                    <p className="flex items-center gap-1.5 text-[0.9rem] text-muted">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      列を確認しています…
                    </p>
                  )}
                  {check && (
                    <>
                      <ul className="flex flex-wrap gap-1.5" aria-label={`「${d.label}」の列の確認`}>
                        {d.columns.map((col) => {
                          const missing = !cols!.includes(col.name)
                          const r = results[col.name]
                          const bad = !missing && r && r.failed > 0 && !checks[i].isPlaceholderData
                          const tone = missing ? (col.required ? 'error' : 'warning') : bad ? 'error' : 'ok'
                          const cls =
                            tone === 'error'
                              ? 'bg-error-soft text-error-ink ring-error/40'
                              : tone === 'warning'
                                ? 'bg-warning-soft text-warning-ink ring-warning/40'
                                : 'bg-success-soft text-success-ink ring-success/30'
                          const Icon = tone === 'error' ? CircleX : tone === 'warning' ? CircleAlert : CircleCheck
                          return (
                            <li key={col.name} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.82rem] ring-1 ring-inset ${cls}`}>
                              <Icon className="size-3.5" aria-hidden />
                              <span className="font-bold">{col.name}</span>
                              <span>
                                {COLUMN_TYPE_LABEL[col.type]}
                                {missing ? (col.required ? '・必須の列がありません' : '・ありません（空欄で読み込みます）') : bad ? `・形式にできない値 ${r.failed.toLocaleString()}件` : ''}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      {check.missingRequired.length > 0 && (
                        <p className="mt-2 text-[0.88rem] text-error-ink">
                          必須の列がないため、このファイルでは実行できません。正しいファイル・シート・見出しの行かを確かめてください。列名が変わった場合の対応付けは、今後のバージョンで使えるようになります（開発中）。
                        </p>
                      )}
                      {check.extra.length > 0 && (
                        <p className="mt-2 flex items-start gap-1.5 text-[0.85rem] text-muted">
                          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                          作業手順で使わない列（読み込みません）：{check.extra.join('、')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onSkip}>
          ファイルを割り当てずに作業手順を見る
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {!canDone && (
            <ul className="min-w-0 text-right text-[0.85rem] text-warning" aria-label="まだ進めない理由">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <Button variant="primary" disabled={!canDone} onClick={done} title={canDone ? undefined : reasons.join('\n')}>
            この割当で作業手順へ進む
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </>
  )
}
