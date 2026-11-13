import { ArrowLeft, Download, History, Info, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { available, clearRecords, deleteRecord, listRecords, putRecords, requestPersist } from '../../api/historyStore'
import { anomalyCount, exportPayload, filterHistory, parseImport } from '../../flow/history'
import type { HistoryFilter, RunRecord } from '../../flow/history'
import { saveBlob } from '../../api/client'
import { Button } from '../ui/Button'

/*
 * 実行の履歴（分析 Phase C・品質MVP QM-3）。このブラウザに保存した、画面からの実行の記録の一覧と詳細。
 * 参考の記録：ブラウザのデータを消すと消える・書き換えられるため、正式な監査証跡にはしない（D-1）。
 * 過去の記録は、あとで作業手順やルールを変えても書き換わらない（実行した時点の写しを持つ）。
 */

const VERDICT: Record<string, string> = { normal: '正常', caution: '注意', unverified: '未検証', critical: '重大' }
const OFFICIAL = (r: RunRecord) =>
  r.official_output.performed ? '出力した' : r.official_output.mode === 'report_only' ? '停止' : r.official_output.mode === 'needs_confirmation' ? '確認待ち' : '出力していない'

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const [records, setRecords] = useState<RunRecord[]>([])
  const [ok, setOk] = useState(true)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<HistoryFilter>({})
  const [selected, setSelected] = useState<RunRecord | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const reload = async () => setRecords(await listRecords('normal'))
  useEffect(() => {
    void (async () => {
      setOk(await available())
      setPersisted(await requestPersist())
      await reload()
    })()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const flows = [...new Map(records.map((r) => [r.flow_id, r.flow_name])).entries()]
  const periods = [...new Set(records.map((r) => r.period).filter((p): p is string => !!p))].sort().reverse()
  const shown = filterHistory(records, filter)

  const remove = async (r: RunRecord) => {
    if (!window.confirm(`${new Date(r.executed_at).toLocaleString('ja-JP')} の「${r.flow_name}」の記録を削除します。元に戻せません。削除しますか？`)) return
    await deleteRecord(r.run_id)
    setSelected(null)
    await reload()
  }
  const removeAll = async () => {
    const target = filter.flowId ? `「${flows.find(([id]) => id === filter.flowId)?.[1]}」の` : 'すべての'
    if (!window.confirm(`${target}実行の記録を、このブラウザから削除します。元に戻せません。削除しますか？`)) return
    await clearRecords('normal', filter.flowId)
    await reload()
  }
  const exportAll = () => {
    saveBlob(`flowcraft_実行の履歴_${new Date().toISOString().slice(0, 10)}.json`, new Blob([exportPayload(shown)], { type: 'application/json' }))
    setMessage(`${shown.length}件の記録を書き出しました（ブラウザのダウンロード先をご確認ください）。`)
  }
  const importFile = async (file: File) => {
    const got = parseImport(await file.text(), new Set(records.map((r) => r.run_id)))
    if (got.error) {
      setMessage(got.error)
      return
    }
    await putRecords(got.records)
    await reload()
    setMessage(`${got.records.length}件を取り込みました${got.skipped ? `（${got.skipped}件は、形が合わないか、すでにあるため取り込みませんでした）` : ''}。`)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="light-panel flex max-h-[88vh] w-full max-w-[980px] flex-col rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-[1.2rem] font-bold">
            <History className="size-5 text-forest" aria-hidden />
            実行の履歴
          </h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-muted hover:bg-ink/6 hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1 flex items-start gap-1.5 text-[0.84rem] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          このブラウザに保存した、画面からの実行の記録です（参考の記録）。前回との比較に使います。ブラウザのデータを消すと消えるため、正式な監査の記録にはなりません。作業手順ごとに最新200件まで保存し、Excelの中身は保存しません。
          {persisted === false && ' このブラウザでは、記録が自動で消される場合があります。'}
        </p>
        {!ok && <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[0.88rem] text-warning-ink">このブラウザでは履歴を保存できません（プライベートブラウズなど）。実行や出力はそのまま使えます。</p>}

        {selected ? (
          <Detail r={selected} onBack={() => setSelected(null)} onDelete={() => void remove(selected)} />
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.85rem]" role="group" aria-label="絞り込み">
              <select value={filter.flowId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, flowId: e.target.value || undefined }))} aria-label="作業手順で絞り込む" className="h-9 rounded-lg bg-card px-2 ring-1 ring-line">
                <option value="">すべての作業手順</option>
                {flows.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select value={filter.period ?? ''} onChange={(e) => setFilter((f) => ({ ...f, period: e.target.value || undefined }))} aria-label="対象期間で絞り込む" className="h-9 rounded-lg bg-card px-2 ring-1 ring-line">
                <option value="">すべての対象期間</option>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select value={filter.verdict ?? ''} onChange={(e) => setFilter((f) => ({ ...f, verdict: e.target.value || undefined }))} aria-label="品質判定で絞り込む" className="h-9 rounded-lg bg-card px-2 ring-1 ring-line">
                <option value="">すべての判定</option>
                {Object.entries(VERDICT).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={exportAll} disabled={!shown.length}>
                  <Download className="size-4" aria-hidden />
                  書き出す
                </Button>
                <Button size="sm" variant="secondary" onClick={() => importRef.current?.click()}>
                  <Upload className="size-4" aria-hidden />
                  取り込む
                </Button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  data-testid="history-import-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void importFile(f)
                    e.target.value = ''
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => void removeAll()} disabled={!shown.length}>
                  <Trash2 className="size-4" aria-hidden />
                  {filter.flowId ? 'この作業手順の記録を削除' : 'すべて削除'}
                </Button>
              </span>
            </div>
            {message && (
              <p className="mt-2 text-[0.85rem] text-forest" role="status">
                {message}
              </p>
            )}
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="rounded-lg bg-ink/5 px-3 py-3 text-[0.9rem] text-ink/75">記録はまだありません。作業手順全体を実行すると、ここに記録が残ります。</p>
              ) : (
                <table className="w-full text-[0.86rem]" aria-label="実行の記録">
                  <thead className="text-left text-[0.8rem] text-muted">
                    <tr>
                      {['実行日時', '作業手順', '対象期間', '処理', '品質判定', '異常', '正式な出力'].map((h) => (
                        <th key={h} className="border-b border-line px-2 py-1.5 font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.run_id} className="cursor-pointer border-b border-line/60 hover:bg-mint-soft/40" onClick={() => setSelected(r)}>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSelected(r)}>
                            {new Date(r.executed_at).toLocaleString('ja-JP')}
                          </button>
                        </td>
                        <td className="px-2 py-1.5">
                          {r.flow_name}
                          <span className="ml-1 text-[0.78rem] text-muted">版{r.flow_version}</span>
                          {r.imported && <span className="ml-1 rounded bg-ink/8 px-1 text-[0.72rem] text-muted">取り込んだ記録</span>}
                        </td>
                        <td className="px-2 py-1.5">{r.period ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.processing_status === 'completed' ? '完了' : '失敗'}</td>
                        <td className="px-2 py-1.5 font-bold">{r.verdict ? VERDICT[r.verdict] ?? r.verdict : '—'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{anomalyCount(r)}</td>
                        <td className="px-2 py-1.5">{OFFICIAL(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Detail({ r, onBack, onDelete }: { r: RunRecord; onBack: () => void; onDelete: () => void }) {
  return (
    <section className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-[0.88rem]" aria-label="実行の記録の詳細">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          一覧に戻る
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="ml-auto">
          <Trash2 className="size-4" aria-hidden />
          この記録を削除
        </Button>
      </div>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted">実行日時</dt>
        <dd>{new Date(r.executed_at).toLocaleString('ja-JP')}</dd>
        <dt className="text-muted">作業手順</dt>
        <dd>
          {r.flow_name}（版{r.flow_version}）
        </dd>
        <dt className="text-muted">対象期間</dt>
        <dd>{r.period ?? '—'}</dd>
        <dt className="text-muted">処理・品質判定</dt>
        <dd>
          {r.processing_status === 'completed' ? '処理は完了' : '処理は途中で停止'}／{r.verdict ? VERDICT[r.verdict] : '—'}
          {r.verdict_headline ? `：${r.verdict_headline}` : ''}
        </dd>
        <dt className="text-muted">正式な出力</dt>
        <dd>
          {OFFICIAL(r)}
          {r.official_output.stop_reason ? `（${r.official_output.stop_reason}）` : ''}
        </dd>
      </dl>
      <div>
        <p className="font-bold">どのデータを検証したか</p>
        <ul className="mt-1 space-y-0.5">
          {r.inputs.map((i) => (
            <li key={i.input_id}>
              {i.label}：{i.filename ?? '—'}
              {i.sheet ? `（${i.sheet}）` : ''}　{i.rows?.toLocaleString() ?? '—'}行
              {i.sha256 && <span className="ml-1 text-[0.78rem] text-muted tabular-nums">識別 {i.sha256.slice(0, 12)}…</span>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-bold">どの版のルールで、何を検出したか</p>
        <ul className="mt-1 space-y-0.5">
          {r.rules.length === 0 && <li className="text-muted">完了基準はありません（標準の確認だけ）。</li>}
          {r.rules.map((x) => (
            <li key={x.criterion_id}>
              「{x.name}」<span className="text-[0.78rem] text-muted">（版{x.rule_version}）</span>：{x.summary}
            </li>
          ))}
        </ul>
      </div>
      {r.metrics.length > 0 && (
        <div>
          <p className="font-bold">記録した数値（前回との比較に使う）</p>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {r.metrics.map((m) => (
              <li key={m.metric_id}>
                {m.label}：<span className="tabular-nums">{Number(m.value).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
