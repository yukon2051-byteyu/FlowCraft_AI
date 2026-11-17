import { ArrowLeft, CircleCheck, CircleX, FileOutput, FolderOpen, House, LoaderCircle, Save, TriangleAlert, Upload } from 'lucide-react'
import type { ApiErrorBody } from '../../../api/client'
import type { RunSummary } from '../../../api/flows'
import { contentSnapshot } from '../../../flow/ops'
import { useFlowStore } from '../../../flow/store'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'
import { outputState, REPORT_EXPORT_LABEL } from '../../../flow/outputState'

/*
 * STEP 5「出力・保存」。STEP 4 で確定した実行結果を使う（この画面に来ても再実行しない）。
 *   ① Excelを出力する（主要な操作）：正式に出力してよいかはサーバーが最終判断する（GET /api/runs/{id}/export）
 *   ② 作業手順を保存する（任意・補助の操作）：成果物（Excel）の保存とは別のこと
 *   ③ 次にできること：TOPに戻る／別のExcelで試す／保存した手順を開く
 * この画面に来られることと、正式なExcelを出力できることは別の条件（重大でも調査用の記録は出力できる）。
 */
type Props = {
  run: RunSummary
  /** 実行したときの作業手順（実行後に変えたかを判定する） */
  snap: string
  onBack: () => void
  onExport: () => void
  exporting: boolean
  exportedName: string | null
  exportError: ApiErrorBody | null
  /** 注意・未検証の結果を「確認したうえで出力する」と選んだか（STEP 4 で選ぶ） */
  confirmed: boolean
  onSave: () => void
  /** 今の作業手順が保存済み（変更なし）か */
  saved: boolean
  /** 保存した作業手順を開く */
  onOpen: () => void
}

export function OutputStep({ run, snap, onBack, onExport, exporting, exportedName, exportError, confirmed, onSave, saved, onOpen }: Props) {
  const flow = useFlowStore((s) => s.flow)
  const stale = contentSnapshot(flow) !== snap
  const v = run.verdict
  // 出力可否は、結果の画面・ヘッダーと同じ判定を使う（flow/outputState.ts）
  const reportOnly = outputState(run).mode === 'stopped'
  const waitingConfirm = v?.export === 'needs_confirmation' && !confirmed
  const blocked = stale || waitingConfirm

  // 出力されるシート（処理結果のシートは、正式に出力できるときだけ入る）
  const producer = new Map(flow.nodes.map((n) => [n.output_reference, n.node_id]))
  const rowsOf = (ref: string) => run.nodes.find((n) => n.node_id === producer.get(ref))?.output_rows ?? null
  const sheets = [
    ...(reportOnly ? [] : run.outputs.map((o) => ({ name: o.sheet_name, note: rowsOf(o.reference) === null ? '処理結果' : `処理結果 ${rowsOf(o.reference)!.toLocaleString()}行` }))),
    { name: '確認結果', note: '総合判定・完了基準の判定と根拠' },
    { name: '処理の記録', note: '使ったファイル・各ステップの件数・実行日時' },
  ]

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] space-y-5 px-6 py-6">
          <div>
            <h1 className="text-[1.5rem] font-bold text-white">出力・保存</h1>
            <p className="mt-1 text-[0.9rem] text-subtle">
              STEP 4 の実行結果（{new Date(run.executed_at).toLocaleString('ja-JP')} に実行）を出力します。この画面では再実行しません。
            </p>
          </div>

          {/* ① Excelを出力する（この画面の主要な操作） */}
          <section className="rounded-2xl bg-panel p-6 ring-1 ring-edge" aria-label="Excelを出力する">
            <h2 className="flex items-center gap-2 text-[1.15rem] font-bold text-white">
              <FileOutput className="size-5 text-mint" aria-hidden />
              ① Excelを出力する
            </h2>
            {stale ? (
              <Notice tone="warning">実行した後に作業手順を変更したため、この結果は出力できません。作業手順に戻って、もう一度実行してください。</Notice>
            ) : waitingConfirm ? (
              <Notice tone="warning">注意事項の確認が終わっていません。STEP 4 で判定の理由を確かめ、「確認したうえで出力する」にチェックを入れてください。</Notice>
            ) : reportOnly ? (
              <Notice tone="critical">
                {run.status === 'failed' ? '処理が途中で止まったため' : v?.verdict === 'unverified' ? '必須の検証が完了していないため' : '重大な品質異常があるため'}
                、正式な処理結果は出力できません。原因を調べるための確認結果（調査用）だけを出力できます。
              </Notice>
            ) : (
              <Notice tone="ok">{v?.export === 'needs_confirmation' ? '注意事項を確認済みです。正式な処理結果を出力できます。' : '品質の確認を通過しました。正式な処理結果を出力できます。'}</Notice>
            )}

            <div className="mt-4 grid grid-cols-[auto_1fr] items-start gap-x-8 gap-y-3">
              <div>
                <p className="text-[0.85rem] font-bold text-subtle">出力するシート（{sheets.length}つ）</p>
                <ul className="mt-1 space-y-0.5 text-[0.9rem]" aria-label="出力するシート">
                  {sheets.map((s) => (
                    <li key={s.name} className="text-white">
                      {s.name}
                      <span className="ml-2 text-[0.82rem] text-subtle">{s.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-start gap-2">
                <Button
                  variant={reportOnly ? 'outlineDark' : 'primary'}
                  size={reportOnly ? 'sm' : 'lg'}
                  onClick={onExport}
                  // 出力中は押せない（二重のダウンロードを防ぐ）
                  disabled={exporting || blocked}
                >
                  {exporting ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <FileOutput className="size-5" aria-hidden />}
                  {exporting ? '出力しています…' : reportOnly ? REPORT_EXPORT_LABEL : exportedName ? 'もう一度Excelに出力する' : 'Excelに出力する'}
                </Button>
                {exportedName && (
                  <p className="flex items-center gap-1.5 text-[0.9rem] text-success" role="status">
                    <CircleCheck className="size-4" aria-hidden />
                    「{exportedName}」を保存しました（ブラウザのダウンロード先をご確認ください）。
                  </p>
                )}
                {exportError && <ErrorNotice error={exportError} />}
              </div>
            </div>
          </section>

          {/* ② 作業手順を保存する（任意。成果物のExcelとは別） */}
          <section className="rounded-2xl bg-panel px-6 py-5 ring-1 ring-edge" aria-label="作業手順の保存">
            <h2 className="flex items-center gap-2 font-bold text-white">
              <Save className="size-4.5 text-subtle" aria-hidden />
              ② 作業手順を保存する（任意）
            </h2>
            <p className="mt-1 text-[0.88rem] text-subtle">
              保存するのは、処理の手順と品質確認のルールです（出力したExcelとは別のファイルです）。今回だけの作業なら、保存せずに終われます。
            </p>
            {saved ? (
              <p className="mt-3 flex items-center gap-1.5 text-[0.9rem] text-white">
                <CircleCheck className="size-4 text-success" aria-hidden />
                この作業手順は保存済みです（変更はありません）。次回は「保存した手順を開く」から、新しいファイルで実行できます。
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="outlineDark" size="sm" onClick={onSave}>
                  <Save className="size-4" aria-hidden />
                  この作業手順を保存する
                </Button>
                {v?.verdict !== 'normal' && (
                  <span className="text-[0.85rem] text-warning">今回の結果は「正常」ではないため、下書きとして保存されます（検証済みの手順ではありません）。</span>
                )}
              </div>
            )}
          </section>

          {/* ③ 次にできること */}
          <section className="rounded-2xl px-6 py-4 ring-1 ring-edge" aria-label="次にできること">
            <h2 className="font-bold text-white">③ 次にできること</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button to="/" variant="outlineDark" size="sm">
                <House className="size-4" aria-hidden />
                TOPに戻る
              </Button>
              {/* 画面を読み込み直して、最初から始める（今の作業の状態を持ち越さない） */}
              <Button href="/build?start=file" variant="ghostDark" size="sm">
                <Upload className="size-4" aria-hidden />
                別のExcelで試す
              </Button>
              {saved && (
                <Button variant="ghostDark" size="sm" onClick={onOpen}>
                  <FolderOpen className="size-4" aria-hidden />
                  保存した手順を開く
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-2.5">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          実行結果に戻る
        </Button>
        {/* 「TOPに戻る」は ③ 次にできること に置く（同じボタンを2か所に出さない） */}
        <p className="min-w-0 flex-1 truncate text-[0.88rem] text-subtle">{exportedName ? '出力しました。作業を終えるときは「③ 次にできること」の「TOPに戻る」を押してください' : 'Excelに出力して、作業を終えてください（作業手順の保存は任意です）'}</p>
      </div>
    </>
  )
}

function Notice({ tone, children }: { tone: 'ok' | 'warning' | 'critical'; children: React.ReactNode }) {
  const s =
    tone === 'ok'
      ? { cls: 'text-success', icon: <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> }
      : tone === 'warning'
        ? { cls: 'text-warning', icon: <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> }
        : { cls: 'text-kaizen-text', icon: <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden /> }
  return (
    <p className={`mt-2 flex items-start gap-1.5 font-bold ${s.cls}`} role="status" aria-label="正式な出力">
      {s.icon}
      {children}
    </p>
  )
}
