import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, CircleCheck, CircleHelp, CircleMinus, CircleX, FileOutput, LoaderCircle, RefreshCw, Save, TriangleAlert, Wrench } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../../../api/client'
import type { ApiErrorBody } from '../../../api/client'
import { fetchRun } from '../../../api/flows'
import type { CriterionResult, RunSummary, StepRun, Verdict } from '../../../api/flows'
import { contentSnapshot } from '../../../flow/ops'
import { useFlowStore } from '../../../flow/store'
import { compareRuns } from '../../../flow/compare'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'
import { IssueList } from './IssueList'
import { PreviewTable } from './PreviewTable'

/*
 * タスク1-6：作業手順全体の実行結果。
 * 結論（最後まで実行できたか）→ ステップごとの状態と件数 → 出力する表、の順に示す。
 * 正常・注意・重大の総合判定は Phase 2（完了基準）で加える。ここでは処理のエラー・警告だけで示す。
 */

const STEP_STATUS: Record<string, { label: string; icon: typeof CircleCheck; cls: string }> = {
  ok: { label: '完了', icon: CircleCheck, cls: 'bg-success-soft text-success-ink ring-success/30' },
  warning: { label: '確認が必要', icon: TriangleAlert, cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  error: { label: 'エラー', icon: CircleX, cls: 'bg-error-soft text-error-ink ring-error/40' },
  skipped: { label: '実行していない', icon: CircleMinus, cls: 'bg-ink/6 text-muted ring-ink/15' },
}

type Props = {
  run: RunSummary
  snap: string
  onBack: () => void
  onExport: () => void
  exporting: boolean
  /** 出力したファイルの名前（この実行で出力済みのとき） */
  exportedName: string | null
  exportError: ApiErrorBody | null
  /** 注意・未検証の結果を、確認したうえで出力すると選んだか */
  confirmed: boolean
  onConfirmChange: (v: boolean) => void
  /** デモの品質異常：直したデータで再実行する（M1-3） */
  fix?: { note: string; busy: boolean; error: ApiErrorBody | null; onRun: () => void } | null
  /** 直す前の実行結果（直して再実行した後に、並べて比べる） */
  before?: RunSummary | null
  /** 作業手順を保存する（今回だけの作業から、毎月の作業にする） */
  onSave: () => void
  /** 今の作業手順が保存済み（変更なし）か */
  saved: boolean
}

export function RunResults({ run, snap, onBack, onExport, exporting, exportedName, exportError, confirmed, onConfirmChange, onSave, saved, fix, before }: Props) {
  const flow = useFlowStore((s) => s.flow)
  const detail = useQuery({ queryKey: ['run', run.run_id], queryFn: () => fetchRun(run.run_id) })
  const [sheet, setSheet] = useState(0)
  const stale = contentSnapshot(flow) !== snap
  const stopped = run.nodes.findIndex((n) => n.status === 'error')
  const warnings = run.nodes.filter((n) => n.status === 'warning').length

  const headline =
    run.status === 'failed'
      ? stopped >= 0
        ? { icon: CircleX, cls: 'text-error', text: `ステップ${stopped + 1}「${run.nodes[stopped].node_name}」で止まりました`, sub: 'エラーの内容と直し方を確認してください。結果は出力できません。' }
        : { icon: CircleX, cls: 'text-error', text: '実行できませんでした', sub: '下の理由を確認してください。' }
      : run.status === 'warning'
        ? { icon: TriangleAlert, cls: 'text-warning', text: '最後まで実行しました（確認が必要なお知らせがあります）', sub: `確認が必要なステップ：${warnings}個。内容を確かめてください。` }
        : { icon: CircleCheck, cls: 'text-success', text: '最後まで実行しました', sub: '処理の中で行った確認（件数・合計の照合など）で、問題は見つかりませんでした。' }
  const Head = headline.icon
  const verdict = run.verdict
  // 出力の扱い：調査用の確認結果だけ／確認したうえで出力／そのまま出力
  const reportOnly = run.status === 'failed' || verdict?.export === 'report_only'
  const needsConfirm = verdict?.export === 'needs_confirmation'
  const previews = detail.data?.output_previews ?? []

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] space-y-5 px-6 py-6">
          <section className="rounded-2xl bg-panel p-6 ring-1 ring-edge" aria-label="実行の結論">
            {/* タスク2-5：総合判定を最初に大きく示す。処理がどこまで進んだかは、その下に */}
            {verdict && <VerdictBox verdict={verdict} />}
            <p className={`flex items-center gap-2 font-bold ${verdict ? 'mt-3 text-[1rem]' : 'text-[1.35rem]'} ${headline.cls}`}>
              <Head className={verdict ? 'size-4.5' : 'size-6'} aria-hidden />
              {verdict ? (run.status === 'failed' ? `処理・検証：途中で停止（${headline.text}）` : `処理・検証：完了（${headline.text}）`) : headline.text}
            </p>
            {/* 「処理が最後まで終わったこと」と「正式な成果物を出力してよいこと」を分けて示す */}
            {verdict && (
              <p className={`mt-1 font-bold ${reportOnly ? 'text-error' : needsConfirm ? 'text-warning' : 'text-success'}`} aria-label="正式な出力">
                正式な出力：{reportOnly ? '停止（調査用の確認結果だけを出力できます）' : needsConfirm ? '確認したうえで出力できます' : '出力できます'}
              </p>
            )}
            <p className="mt-1 text-[0.9rem] text-subtle">{headline.sub}</p>
            <p className="mt-2 text-[0.85rem] text-subtle">
              実行日時：{new Date(run.executed_at).toLocaleString('ja-JP')} ／ 処理時間：{formatDuration(run.duration_ms)}
            </p>
            {stale && (
              <p className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-[0.88rem] text-warning ring-1 ring-warning/35">
                実行した後に作業手順を変更しました。この結果は変更前の内容です。作業手順に戻って、もう一度実行してください。
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-4">
              {needsConfirm && !reportOnly && (
                <label className="flex w-full items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[0.9rem] ring-1 ring-warning/35">
                  <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} className="mt-1 size-4 accent-[#d4a72c]" />
                  <span>
                    <span className="font-bold text-warning">確認したうえで出力する</span>
                    <span className="block text-[0.85rem] text-subtle">上の判定の理由を確かめました。この結果を業務で使ってよいと判断したときだけ、チェックを入れてください。</span>
                  </span>
                </label>
              )}
              <Button
                variant={reportOnly ? 'outlineDark' : 'primary'}
                onClick={onExport}
                disabled={exporting || (needsConfirm && !reportOnly && !confirmed)}
                title={needsConfirm && !confirmed ? '「確認したうえで出力する」にチェックを入れると出力できます' : undefined}
              >
                {exporting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileOutput className="size-4" aria-hidden />}
                {reportOnly ? '確認結果をExcelに出力する（調査用）' : 'Excelに出力する'}
              </Button>
              <span className="text-[0.85rem] text-subtle">
                {reportOnly
                  ? '処理結果のシートは含めず、「確認結果」と「処理の記録」だけを出力します。'
                  : '処理結果のシートに加えて、「確認結果」と「処理の記録」のシートも出力します。'}
              </span>
            </div>
            {exportedName && (
              <p className="mt-2 flex items-center gap-1.5 text-[0.88rem] text-success" role="status">
                <CircleCheck className="size-4" aria-hidden />
                「{exportedName}」を保存しました（ブラウザのダウンロード先をご確認ください）。
              </p>
            )}
            {exportError && (
              <div className="mt-3">
                <ErrorNotice error={exportError} />
              </div>
            )}

            {/* タスク1-11：保存は任意。出力して終わってもよいし、ここから保存して毎月使うこともできる（作り直し不要） */}
            {!stale && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-4" aria-label="作業手順の保存">
                {saved ? (
                  <p className="flex items-center gap-1.5 text-[0.88rem] text-subtle">
                    <CircleCheck className="size-4 text-success" aria-hidden />
                    この作業手順は保存済みです。次回は「作業手順を開く」から、新しいファイルで実行できます。
                  </p>
                ) : (
                  <>
                    <Button variant="outlineDark" size="sm" onClick={onSave}>
                      <Save className="size-4" aria-hidden />
                      この作業手順を保存する
                    </Button>
                    <span className="text-[0.85rem] text-subtle">
                      任意です。今回だけの作業なら、保存せずに終われます。毎月の作業なら、保存しておくと次回は新しいファイルを選ぶだけで実行できます。
                    </span>
                  </>
                )}
              </div>
            )}
          </section>

          {before && <ComparePanel before={before} after={run} />}

          {fix && <FixBox fix={fix} />}

          {run.criteria.length > 0 && <CriteriaResults criteria={run.criteria} />}

          {run.flow_issues.length > 0 && (
            <section className="light-panel rounded-2xl p-5">
              <IssueList issues={run.flow_issues} label="実行前に見つかった問題" />
            </section>
          )}

          <section className="light-panel rounded-2xl p-5" aria-label="ステップごとの結果">
            <h2 className="mb-3 font-bold">ステップごとの結果</h2>
            <ol className="space-y-1.5">
              {run.nodes.map((n, i) => (
                <StepRow key={n.node_id} n={n} index={i} defaultOpen={n.status === 'error' || n.status === 'warning'} />
              ))}
            </ol>
          </section>

          {run.outputs.length > 0 && (
            <section className="light-panel rounded-2xl p-5" aria-label="出力する表">
              <h2 className="font-bold">出力する表</h2>
              <p className="mt-0.5 text-[0.85rem] text-muted">先頭の一部を表示しています。すべての行は「Excelに出力する」で保存できます。</p>
              <div className="mt-3 mb-2 flex flex-wrap gap-1" role="tablist" aria-label="出力するシート">
                {run.outputs.map((o, i) => (
                  <button
                    key={o.sheet_name}
                    type="button"
                    role="tab"
                    aria-selected={i === sheet}
                    onClick={() => setSheet(i)}
                    className={`rounded-full px-3 py-1 text-[0.85rem] font-bold ring-1 ${i === sheet ? 'bg-forest text-white ring-forest' : 'bg-paper ring-line hover:ring-forest/50'}`}
                  >
                    {o.sheet_name}
                  </button>
                ))}
              </div>
              {detail.isPending && (
                <p className="flex items-center gap-1.5 text-[0.88rem] text-muted">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  表を読み込んでいます…
                </p>
              )}
              {detail.error instanceof ApiError && <ErrorNotice error={detail.error.body} />}
              {previews[sheet] && <PreviewTable table={previews[sheet]} maxHeight="24rem" />}
            </section>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          作業手順に戻る
        </Button>
      </div>
    </>
  )
}

/* 総合判定（タスク2-3）。判定の根拠の詳しい表示は 2-5 で作る */
const VERDICT_STYLE: Record<Verdict['verdict'], { label: string; cls: string; icon: typeof CircleCheck }> = {
  normal: { label: '正常', cls: 'bg-success/12 text-success ring-success/35', icon: CircleCheck },
  caution: { label: '注意', cls: 'bg-warning/12 text-warning ring-warning/40', icon: TriangleAlert },
  unverified: { label: '未検証', cls: 'bg-warning/12 text-warning ring-warning/40', icon: CircleHelp },
  critical: { label: '重大', cls: 'bg-error/12 text-error ring-error/40', icon: CircleX },
}

function VerdictBox({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict.verdict]
  const Icon = s.icon
  return (
    <div className={`rounded-xl px-4 py-3.5 ring-1 ${s.cls}`} role="status" aria-label="総合判定">
      <p className="flex flex-wrap items-center gap-2 text-[1.35rem] font-bold">
        <Icon className="size-6" aria-hidden />
        総合判定：{s.label}
        <span className="text-[0.8rem] font-normal text-subtle">（{verdict.standard_only ? '標準の確認のみ' : '完了基準と標準の確認'}）</span>
      </p>
      <p className="mt-1 text-white/90">{verdict.headline}</p>
      {verdict.reasons.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[0.85rem] text-white/80" aria-label="判定の理由">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <VerdictGuide />
    </div>
  )
}

/**
 * 判定基準について（TOP の「判定と出力の関係」をここへ移した）。
 * 出力の扱いは、判定のしかた（backend/app/criteria/verdict.py・app/quality/output.py）と一致させる
 */
const VERDICT_GUIDE: { label: string; meaning: string; output: string }[] = [
  { label: '正常', meaning: '設定した基準を満たしている', output: '正式な結果を出力できる' },
  { label: '注意', meaning: '検証した結果、確認が必要な点がある', output: '内容を確認してから出力できる' },
  { label: '未検証', meaning: '必要な検証が完了していない', output: '必須（重大）のルールが確かめられなければ停止。それ以外は確認してから出力できる' },
  { label: '重大', meaning: '重大な品質異常を検出した', output: '正式な出力を停止（調査用の確認結果だけ出力できる）' },
]

function VerdictGuide() {
  return (
    <details className="mt-2 text-[0.85rem]">
      <summary className="cursor-pointer text-white/75 hover:text-white">判定基準について</summary>
      <table className="mt-1.5 w-full text-left">
        <tbody>
          {VERDICT_GUIDE.map((v) => (
            <tr key={v.label} className="border-t border-white/10 align-top">
              <th className="py-1 pr-3 font-bold whitespace-nowrap text-white">{v.label}</th>
              <td className="py-1 pr-3 text-white/75">{v.meaning}</td>
              <td className="py-1 text-white/90">{v.output}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/* ---------- デモ：直して再実行・直す前と後の比較（M1-3） ---------- */

function FixBox({ fix }: { fix: NonNullable<Props['fix']> }) {
  return (
    <section className="rounded-2xl bg-mint/6 p-5 ring-1 ring-mint/35" aria-label="直して再実行する">
      <h2 className="flex items-center gap-2 font-bold text-mint">
        <Wrench className="size-5" aria-hidden />
        この問題を直すと、正常に終わるか確かめる
      </h2>
      <p className="mt-1.5 text-[0.92rem] text-white/85">{fix.note} 同じ作業手順・同じ完了基準で実行し、直す前と後を並べて比べます。</p>
      <div className="mt-3">
        <Button variant="primary" onClick={fix.onRun} disabled={fix.busy}>
          {fix.busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          直したデータで再実行する
        </Button>
      </div>
      {fix.error && (
        <div className="mt-3">
          <ErrorNotice error={fix.error} />
        </div>
      )}
    </section>
  )
}

const TREND = {
  better: { label: '改善', cls: 'text-mint' },
  worse: { label: '悪化', cls: 'text-kaizen-text' },
  same: { label: '変わらない', cls: 'text-subtle' },
} as const

function ComparePanel({ before, after }: { before: RunSummary; after: RunSummary }) {
  const rows = compareRuns(before, after)
  return (
    <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="直す前と後の比較">
      <h2 className="font-bold text-white">直す前と後の比較</h2>
      <p className="mt-0.5 text-[0.85rem] text-subtle">どちらも同じ作業手順・同じ完了基準で、実際に実行した結果です。</p>
      <table className="mt-3 w-full text-[0.9rem]">
        <thead className="text-left text-[0.82rem] text-subtle">
          <tr>
            <th className="border-b border-edge py-1.5 pr-3 font-bold">項目</th>
            <th className="border-b border-edge py-1.5 pr-3 font-bold">直す前</th>
            <th className="border-b border-edge py-1.5 pr-3 font-bold">直した後</th>
            <th className="border-b border-edge py-1.5 font-bold">変化</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-edge/60 last:border-0">
              <td className="py-2 pr-3 font-bold text-white">{r.label}</td>
              <td className="py-2 pr-3 text-white/80">{r.before}</td>
              <td className="py-2 pr-3 text-white">{r.after}</td>
              <td className={`py-2 font-bold ${TREND[r.trend].cls}`}>{TREND[r.trend].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/* ---------- 完了基準の判定と根拠（タスク2-5） ---------- */

const CRITERION_STATUS: Record<string, { label: string; cls: string }> = {
  passed: { label: '満たしている', cls: 'bg-success-soft text-success-ink ring-success/30' },
  failed_critical: { label: '満たしていない（重大）', cls: 'bg-error-soft text-error-ink ring-error/40' },
  failed_caution: { label: '満たしていない（注意）', cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  failed_record: { label: '満たしていない（記録のみ）', cls: 'bg-ink/6 text-muted ring-ink/15' },
  unverified: { label: '未検証', cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  not_applicable: { label: '対象外', cls: 'bg-ink/6 text-muted ring-ink/15' },
  recorded: { label: '記録', cls: 'bg-ink/6 text-muted ring-ink/15' },
}

/** 表示の順：止める重大な問題 → 確かめられなかったもの → 注意 → 満たしているもの → 記録（指示書の優先順位） */
function rank(c: CriterionResult): number {
  if (c.status === 'failed' && c.on_fail === 'critical') return 0
  if (c.status === 'unverified' && c.on_fail !== 'record') return 1
  if (c.status === 'failed' && c.on_fail === 'caution') return 2
  if (c.status === 'passed') return 3
  return 4
}

function statusKey(c: CriterionResult): string {
  return c.status === 'failed' ? `failed_${c.on_fail}` : c.status
}

function CriteriaResults({ criteria }: { criteria: CriterionResult[] }) {
  const sorted = [...criteria].sort((a, b) => rank(a) - rank(b))
  return (
    <section className="light-panel rounded-2xl p-5" aria-label="完了基準の判定">
      <h2 className="font-bold">完了基準の判定と根拠</h2>
      <p className="mt-0.5 text-[0.85rem] text-muted">判定はプログラムで計算しています（AIは使っていません）。根拠は、判定に使った実際の値です。</p>
      <ol className="mt-3 space-y-2">
        {sorted.map((c) => (
          <CriterionRow key={c.criterion_id} c={c} />
        ))}
      </ol>
    </section>
  )
}

function CriterionRow({ c }: { c: CriterionResult }) {
  const [open, setOpen] = useState(false)
  const s = CRITERION_STATUS[statusKey(c)] ?? CRITERION_STATUS.not_applicable
  const evidence = Object.entries(c.evidence)
  return (
    <li className="rounded-lg bg-paper px-4 py-3 ring-1 ring-line" aria-label={`完了基準：${c.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[0.78rem] font-bold ring-1 ring-inset ${s.cls}`}>{s.label}</span>
        <span className="font-bold">{c.name}</span>
      </div>
      <p className="mt-1 text-[0.9rem] text-ink/85">{c.summary}</p>
      {evidence.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.85rem]" aria-label="根拠">
          {evidence.map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="font-bold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {c.how_to_fix && c.status !== 'passed' && <p className="mt-1.5 text-[0.85rem] text-ink/80">対応：{c.how_to_fix}</p>}
      {c.examples.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-[0.82rem] font-bold text-forest hover:underline">
            <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            該当する例（{c.examples.length}件まで表示）
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-[0.82rem] text-ink/80">
              {c.examples.map((e, i) => (
                <li key={i}>
                  {Object.entries(e)
                    .map(([k, v]) => `${k}：${String(v)}`)
                    .join(' ／ ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** 処理時間。1秒未満も 0 秒に丸めない（サーバーの report.format_duration と同じ） */
function formatDuration(ms: number): string {
  if (ms < 1) return '0.001秒未満'
  if (ms < 1000) return `${(ms / 1000).toFixed(3)}秒`
  return `${(ms / 1000).toFixed(1)}秒`
}

function StepRow({ n, index, defaultOpen }: { n: StepRun; index: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const s = STEP_STATUS[n.status] ?? STEP_STATUS.skipped
  const Icon = s.icon
  const rows = n.input_rows.length ? `${n.input_rows.map((r) => r.toLocaleString()).join('＋')}行 → ` : ''
  return (
    <li className="rounded-lg bg-paper ring-1 ring-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[0.75rem] font-bold text-white">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate font-bold">{n.node_name}</span>
        <span className="text-[0.85rem] text-muted tabular-nums">
          {n.status === 'skipped' ? '' : `${rows}${n.output_rows === null ? '' : `${n.output_rows.toLocaleString()}行`}`}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.78rem] font-bold whitespace-nowrap ring-1 ring-inset ${s.cls}`}>
          <Icon className="size-3.5" aria-hidden />
          {s.label}
        </span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {(n.added_columns.length > 0 || n.removed_columns.length > 0) && (
            <p className="text-[0.82rem] text-ink/85">
              {n.added_columns.length > 0 && <span className="mr-3">増えた列：{n.added_columns.join('、')}</span>}
              {n.removed_columns.length > 0 && <span>なくなった列：{n.removed_columns.join('、')}</span>}
            </p>
          )}
          {n.issues.length ? <IssueList issues={n.issues} /> : <p className="text-[0.82rem] text-muted">{n.status === 'skipped' ? '前のステップで止まったため、実行していません。' : 'お知らせはありません。'}</p>}
        </div>
      )}
    </li>
  )
}
