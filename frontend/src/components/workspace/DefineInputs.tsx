import { keepPreviousData, useQueries } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CircleCheck, CircleX, FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { COLUMN_TYPE_LABEL, typeCheck } from '../../api/files'
import type { ColumnType, TypeCheckResult } from '../../api/files'
import { choiceProblems, suggestLabel } from '../../flow/define'
import type { InputChoice } from '../../flow/define'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'
import { HelpTip } from '../ui/HelpTip'
import type { DefineSource } from './UploadStart'

const TYPES: ColumnType[] = ['string', 'integer', 'decimal', 'date', 'boolean']

/** 読み込んだ直後の初期値：すべての列を使い、推定した形式を選び、必ずある列とする */
function initialChoice({ summary, detail }: DefineSource): InputChoice {
  return {
    fileId: summary.file_id,
    fileName: summary.filename,
    kind: summary.kind,
    sheet: detail.sheet,
    headerRow: detail.header_row,
    label: suggestLabel(summary.filename),
    columns: detail.columns.map((c) => ({ name: c.name, use: true, type: c.inferred_type, required: true })),
  }
}

type Props = {
  sources: DefineSource[]
  onBack: () => void
  onStart: (choices: InputChoice[]) => void
}

/**
 * タスク1-2「新しく作る」：作業手順で使う列と、そのデータの形式を決める。
 * 形式を変えるたびに、サーバーで全件を変換してみて、変換できない値があれば行番号つきで示す。
 * （実行時の読み込みと同じ変換を使うので、「ここではOKだったのに実行で失敗する」ことはない）
 */
export function DefineInputs({ sources, onBack, onStart }: Props) {
  const [choices, setChoices] = useState<InputChoice[]>(() => sources.map(initialChoice))
  const samples = Object.fromEntries(sources.map((s) => [s.summary.file_id, Object.fromEntries(s.detail.columns.map((c) => [c.name, c]))]))

  // 使う列ごとに、選んだ形式で全件を変換できるか確かめる
  const checks = useQueries({
    queries: choices.map((c) => {
      const cols = c.columns.filter((x) => x.use).map((x) => ({ name: x.name, type: x.type }))
      return {
        queryKey: ['typeCheck', c.fileId, c.sheet, c.headerRow, cols],
        queryFn: () => typeCheck(c.fileId, c.sheet, c.headerRow, cols),
        enabled: cols.length > 0,
        placeholderData: keepPreviousData,
      }
    }),
  })

  const resultsByFile: Record<string, Record<string, TypeCheckResult>> = {}
  const failed: Record<string, string[]> = {}
  choices.forEach((c, i) => {
    const data = checks[i].data ?? []
    resultsByFile[c.fileId] = Object.fromEntries(data.map((r) => [r.name, r]))
    failed[c.fileId] = data.filter((r) => c.columns.some((x) => x.use && x.name === r.name && x.type === r.type) && (!r.found || r.failed > 0)).map((r) => r.name)
  })
  const checking = checks.some((q, i) => q.isFetching || (q.isPlaceholderData && choices[i].columns.some((x) => x.use)))
  const problems = choiceProblems(choices, failed)
  // 確認自体ができなかった場合も進めない（確かめていない内容で作業手順を作らない）
  const checkFailed = checks.some((q) => q.isError)
  const reasons = [
    ...(checking ? ['データの形式を確認しています…'] : []),
    ...(checkFailed && !checking ? ['データの形式を確認できなかったファイルがあります。画面の案内に沿って対処してください'] : []),
    ...problems,
  ]
  const canStart = reasons.length === 0

  const update = (fileId: string, patch: (c: InputChoice) => InputChoice) => setChoices((all) => all.map((c) => (c.fileId === fileId ? patch(c) : c)))
  const updateColumn = (fileId: string, name: string, patch: Partial<InputChoice['columns'][number]>) =>
    update(fileId, (c) => ({ ...c, columns: c.columns.map((x) => (x.name === name ? { ...x, ...patch } : x)) }))

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
          <div>
            <p className="text-[0.85rem] font-bold text-mint">新しい作業手順を作る</p>
            <h1 className="mt-0.5 text-[1.5rem] font-bold text-white">使う列と、データの形式を決める</h1>
            <p className="mt-1.5 max-w-3xl text-subtle">
              ここで決めた内容は作業手順に保存され、来月以降のファイルを読み込んだときの確認に使います。
              たとえば「必ずある列」がなくなっていたら、実行する前に知らせます。
            </p>
          </div>

          {choices.map((c, i) => {
            const query = checks[i]
            const results = resultsByFile[c.fileId]
            const used = c.columns.filter((x) => x.use).length
            return (
              <section key={c.fileId} className="light-panel rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]" aria-label={`${c.fileName} の設定`}>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line px-6 pt-5 pb-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[0.85rem] text-muted">
                      <FileSpreadsheet className="size-4" aria-hidden />
                      <span className="truncate" title={c.fileName}>
                        {c.fileName}
                      </span>
                      {c.kind === 'xlsx' && <span>／ シート「{c.sheet}」</span>}
                      <span>／ 見出し {c.headerRow}行目</span>
                    </p>
                    <label className="mt-2 flex flex-col gap-1">
                      <span className="flex items-center gap-1 text-[0.8rem] font-bold text-muted">
                        入力の名前
                        <HelpTip
                          tone="light"
                          label="入力の名前"
                          text="作業手順の中でこのファイルを呼ぶ名前です。毎月ファイル名が変わっても使えるよう、年月を除いた名前をおすすめします。"
                        />
                      </span>
                      <input
                        value={c.label}
                        onChange={(e) => update(c.fileId, (x) => ({ ...x, label: e.target.value }))}
                        maxLength={50}
                        className="h-10 w-80 rounded-lg bg-card px-3 font-bold ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                      />
                    </label>
                  </div>
                  <p className="ml-auto text-[0.9rem] text-muted">
                    使う列 <span className="font-bold text-ink tabular-nums">{used}</span> ／ {c.columns.length}列
                  </p>
                </div>

                {query.error instanceof ApiError && (
                  <div className="px-6 pt-4">
                    <ErrorNotice error={query.error.body} title="データの形式を確認できませんでした" />
                  </div>
                )}

                <div className="overflow-x-auto px-6 py-4">
                  <table className="w-full text-[0.9rem]">
                    <thead className="text-[0.82rem] text-muted">
                      <tr>
                        <th className="w-14 border-b border-line px-2 py-2 text-left font-bold">使う</th>
                        <th className="border-b border-line px-2 py-2 text-left font-bold">列名</th>
                        <th className="border-b border-line px-2 py-2 text-left font-bold">値の例</th>
                        <th className="border-b border-line px-2 py-2 text-left font-bold">データの形式</th>
                        <th className="border-b border-line px-2 py-2 text-left font-bold whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            必ずある列
                            <HelpTip
                              tone="light"
                              label="必ずある列"
                              text="今後のファイルにも必ずある列です。ファイルにこの列がない場合は、実行する前に止めてお知らせします。"
                            />
                          </span>
                        </th>
                        <th className="border-b border-line px-2 py-2 text-left font-bold">全件の確認</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.columns.map((col) => {
                        const info = samples[c.fileId][col.name]
                        const r = results[col.name]
                        const current = r && r.type === col.type && !query.isPlaceholderData ? r : null
                        return (
                          <tr key={col.name} className={`border-b border-line last:border-0 ${col.use ? '' : 'opacity-50'}`}>
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={col.use}
                                onChange={(e) => updateColumn(c.fileId, col.name, { use: e.target.checked })}
                                aria-label={`「${col.name}」を使う`}
                                className="size-4.5 accent-[#135f50]"
                              />
                            </td>
                            <td className="px-2 py-2 font-bold whitespace-nowrap">{col.name}</td>
                            <td className="max-w-[16rem] truncate px-2 py-2 text-muted" title={info?.samples.join('、')}>
                              {info?.samples.slice(0, 3).join('、') || '（空欄のみ）'}
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={col.type}
                                disabled={!col.use}
                                onChange={(e) => updateColumn(c.fileId, col.name, { type: e.target.value as ColumnType })}
                                aria-label={`「${col.name}」のデータの形式`}
                                className="h-8 rounded-lg bg-card px-2 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                              >
                                {TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {COLUMN_TYPE_LABEL[t]}
                                    {info?.inferred_type === t ? '（推定）' : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={col.required}
                                disabled={!col.use}
                                onChange={(e) => updateColumn(c.fileId, col.name, { required: e.target.checked })}
                                aria-label={`「${col.name}」は必ずある列`}
                                className="size-4.5 accent-[#135f50]"
                              />
                            </td>
                            <td className="px-2 py-2">{col.use && <CheckCell result={current} />}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          ファイルの確認に戻る
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {!canStart && (
            <ul className="min-w-0 text-right text-[0.85rem] text-warning" aria-label="まだ進めない理由">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <Button variant="primary" disabled={!canStart} onClick={() => onStart(choices)} title={canStart ? undefined : reasons.join('\n')}>
            この内容で作業手順を作り始める
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </>
  )
}

function CheckCell({ result }: { result: TypeCheckResult | null }) {
  if (!result) {
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        確認中
      </span>
    )
  }
  if (!result.found) {
    return <span className="font-bold text-error-ink">列が見つかりません</span>
  }
  if (result.failed > 0) {
    const ex = result.examples.map((e) => `${e.row}行目「${e.value ?? ''}」`).join('、')
    return (
      <span className="inline-flex items-start gap-1 text-error-ink">
        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-bold">この形式にできない値が{result.failed.toLocaleString()}件</span>
          <span className="block text-[0.82rem]">例：{ex}</span>
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-success-ink">
      <CircleCheck className="size-4" aria-hidden />
      全{(result.converted + result.blank).toLocaleString()}件OK
      {result.blank > 0 && <span className="text-muted">（空欄 {result.blank.toLocaleString()}件）</span>}
    </span>
  )
}
