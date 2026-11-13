import { Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { AppHeader } from '../components/workspace/AppHeader'
import { SampleWorkspace } from '../components/workspace/SampleWorkspace'
import { Stepper } from '../components/workspace/Stepper'
import { UploadStart } from '../components/workspace/UploadStart'
import type { DefineSource } from '../components/workspace/UploadStart'
import { DefineInputs } from '../components/workspace/DefineInputs'
import { FlowSteps } from '../components/workspace/FlowSteps'
import { RunResults } from '../components/workspace/run/RunResults'
import { SaveDialog } from '../components/workspace/SaveDialog'
import { OpenDialog } from '../components/workspace/OpenDialog'
import { AssignInputs } from '../components/workspace/AssignInputs'
import { exportRun } from '../api/flows'
import type { RunSummary } from '../api/flows'
import { ApiError } from '../api/client'
import type { ApiErrorBody } from '../api/client'
import { buildFromChoices } from '../flow/define'
import type { InputChoice } from '../flow/define'
import { editHint } from '../flow/hints'
import { selectIsDirty, useFlowStore } from '../flow/store'

/**
 * 作る画面の中の表示
 *   新しく作る：ファイルの確認 → 使う列と形式を決める → 作業手順 → 結果
 *   保存した作業手順を開く：ファイルの割当 → 作業手順 → 結果
 */
type Screen = 'data' | 'define' | 'assign' | 'edit' | 'result'

const SKIP_AI = [{ step: 2, reason: 'AIで作業手順を作る機能は開発中のため、今回は自分で作ります' }]

/** 選んだファイル・シート・見出し行が同じなら、決めた内容を残す（変わったら最初から決め直す） */
const sourcesKey = (sources: DefineSource[]) => sources.map((s) => `${s.summary.file_id}:${s.detail.sheet}:${s.detail.header_row}`).join('|')

/**
 * ワークスペース（フロー編集画面）。
 * ?view=sample のときはサンプルフローを表示する（URLで状態を持つので、再読み込みしても同じ表示になる）。
 * PC専用：幅1024px未満では案内のみ表示する。
 */
export default function WorkspacePage() {
  const [params, setParams] = useSearchParams()
  const sample = params.get('view') === 'sample'
  const [fileCount, setFileCount] = useState(0)
  const [sampleHint, setSampleHint] = useState('')
  const [screen, setScreen] = useState<Screen>('data')
  const [sources, setSources] = useState<DefineSource[] | null>(null)
  // 直近の全体の実行結果と、実行したときの作業手順（実行後に変更したかを判定するため）
  const [lastRun, setLastRun] = useState<{ run: RunSummary; snap: string } | null>(null)
  // Excel出力の状態（結果の画面と、上部の「Excelに出力」ボタンで共有する）
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<{ runId: string; name: string } | null>(null)
  const [exportError, setExportError] = useState<ApiErrorBody | null>(null)
  const doExport = async () => {
    if (!lastRun) return
    setExporting(true)
    setExportError(null)
    try {
      const name = await exportRun(lastRun.run.run_id)
      setExported({ runId: lastRun.run.run_id, name })
    } catch (e) {
      setExportError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'Excelに出力できませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setExporting(false)
    }
  }
  const startFromInputs = useFlowStore((s) => s.startFromInputs)
  const nodes = useFlowStore((s) => s.flow.nodes)
  const flowName = useFlowStore((s) => s.flow.flow_name)
  // 処理ステップがある作業手順で、保存していない変更があるか（まだ何も作っていないときは対象外）
  const unsaved = useFlowStore((s) => s.flow.nodes.length > 0 && selectIsDirty(s))
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  // 今の作業手順を、新しく作ったか、保存したものを開いたか（戻る先が変わる）
  const [origin, setOrigin] = useState<'new' | 'opened'>('new')
  const openFlow = useFlowStore((s) => s.openFlow)
  // 別の作業手順を開いたら、割当の画面を最初からにする
  const [openedKey, setOpenedKey] = useState(0)

  // 未保存のままブラウザを閉じる・再読み込みする前に、ブラウザの確認を出す
  useEffect(() => {
    if (sample || !unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [sample, unsaved])
  // 作り直すと消えてしまう、追加済みの処理ステップの数
  const addedSteps = nodes.filter((n) => n.node_type !== 'load').length

  const start = (choices: InputChoice[]) => {
    const built = buildFromChoices(choices)
    startFromInputs(built.definitions, built.bindings, built.loadNodes)
    setScreen('edit')
  }

  return (
    <>
      <div className="hidden h-screen min-h-[640px] flex-col bg-canvas lg:flex">
        <AppHeader
          flowName={sample ? '月次売上集計' : flowName}
          unsaved={!sample && unsaved}
          canSave={!sample && nodes.length > 0}
          onSave={() => setSaving(true)}
          onOpen={sample ? undefined : () => setOpening(true)}
          canExport={!sample && screen === 'result' && lastRun !== null}
          onExport={doExport}
          exporting={exporting}
        />
        {sample ? (
          <>
            <Stepper current={3} hint={sampleHint} />
            <SampleWorkspace onClose={() => setParams({})} onHintChange={setSampleHint} />
          </>
        ) : (
          <>
            <Stepper
              current={screen === 'result' ? 4 : screen === 'edit' ? 3 : 1}
              skipped={screen === 'data' ? [] : SKIP_AI}
              hint={
                screen === 'result'
                  ? lastRun?.run.status === 'failed'
                    ? '止まった理由を確かめてください。調査用に、確認結果をExcelに出力できます'
                    : '実行結果を確かめて、Excelに出力してください'
                  : screen === 'edit'
                  ? editHint(nodes)
                  : screen === 'define'
                    ? '作業手順で使う列と、データの形式を決めてください'
                    : screen === 'assign'
                      ? '今回使うファイルを、作業手順の入力に割り当ててください'
                    : fileCount === 0
                      ? '処理に使うExcel・CSVファイルを読み込んでください'
                      : '列名とデータの形式、先頭の行を確認してください（必要なファイルはすべて読み込みましたか？）'
              }
            />
            {/* 戻ったときに選んだ内容が消えないよう、画面を切り替えても部品は残しておく */}
            <div className={screen === 'data' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <UploadStart
                onShowSample={() => setParams({ view: 'sample' })}
                onFileCountChange={setFileCount}
                onDefine={(s) => {
                  setSources((prev) => (prev && sourcesKey(prev) === sourcesKey(s) ? prev : s))
                  setScreen('define')
                }}
              />
            </div>
            {sources && (
              <div className={screen === 'define' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <DefineInputs key={sourcesKey(sources)} sources={sources} onBack={() => setScreen('data')} onStart={start} replaceCount={addedSteps} />
              </div>
            )}
            {screen === 'assign' && <AssignInputs key={openedKey} onDone={() => setScreen('edit')} onSkip={() => setScreen('edit')} />}
            {screen === 'edit' && (
              <FlowSteps
                onBack={() => setScreen(origin === 'opened' ? 'assign' : 'define')}
                backLabel={origin === 'opened' ? 'ファイルの割当に戻る' : '使う列と形式の設定に戻る'}
                onRan={(run, snap) => {
                  setLastRun({ run, snap })
                  setScreen('result')
                }}
              />
            )}
            {screen === 'result' && lastRun && (
              <RunResults
                run={lastRun.run}
                snap={lastRun.snap}
                onBack={() => setScreen('edit')}
                onExport={doExport}
                exporting={exporting}
                exportedName={exported?.runId === lastRun.run.run_id ? exported.name : null}
                exportError={exportError}
              />
            )}
          </>
        )}
      </div>
      {saving && <SaveDialog onClose={() => setSaving(false)} />}
      {opening && (
        <OpenDialog
          unsaved={unsaved}
          onClose={() => setOpening(false)}
          onOpened={(flow) => {
            openFlow(flow)
            setOpenedKey((k) => k + 1)
            setOrigin('opened')
            setLastRun(null)
            setOpening(false)
            setScreen(flow.input_definitions.length ? 'assign' : 'edit')
          }}
        />
      )}
      <PcOnlyNotice />
    </>
  )
}

function PcOnlyNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 lg:hidden">
      <div className="light-panel max-w-sm rounded-2xl p-7 text-center shadow-xl">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-mint-soft text-forest">
          <Monitor className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-[1.25rem] font-bold">この画面はPC向けです</h1>
        <p className="mt-2 leading-relaxed text-ink/80">
          作業手順の編集画面は、画面幅の広いPC（1280px以上を推奨）でのご利用を想定しています。PCのブラウザで開いてください。
        </p>
        <div className="mt-5">
          <Button to="/" variant="secondary">
            トップへ戻る
          </Button>
        </div>
      </div>
    </div>
  )
}
