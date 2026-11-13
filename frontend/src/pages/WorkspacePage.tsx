import { Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { AppHeader } from '../components/workspace/AppHeader'
import { SampleWorkspace } from '../components/workspace/SampleWorkspace'
import { Stepper } from '../components/workspace/Stepper'
import { StartChooser } from '../components/workspace/StartChooser'
import { DescribeWork } from '../components/workspace/DescribeWork'
import { modeFromParam, START_PARAM, stepViews } from '../flow/journey'
import { fetchTemplate } from '../api/templates'
import { copyFlow } from '../flow/copy'
import type { BuildMethod, Facts, Screen, StartMode } from '../flow/journey'
import { UploadStart } from '../components/workspace/UploadStart'
import type { DefineSource } from '../components/workspace/UploadStart'
import { DefineInputs } from '../components/workspace/DefineInputs'
import { FlowSteps } from '../components/workspace/FlowSteps'
import { RunResults } from '../components/workspace/run/RunResults'
import { SaveDialog } from '../components/workspace/SaveDialog'
import { HistoryDialog } from '../components/workspace/HistoryDialog'
import { DemoBanner } from '../components/workspace/DemoBanner'
import { startDemo } from '../api/demos'
import type { DemoPattern, DemoStart } from '../api/demos'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { OpenDialog } from '../components/workspace/OpenDialog'
import { AssignInputs } from '../components/workspace/AssignInputs'
import { exportRun, runAndRecord } from '../api/flows'
import { clearRecords, markPerformed, setHistoryScope } from '../api/historyStore'
import { contentSnapshot } from '../flow/ops'
import type { RunSummary } from '../api/flows'
import { ApiError } from '../api/client'
import type { ApiErrorBody } from '../api/client'
import { buildFromChoices } from '../flow/define'
import type { InputChoice } from '../flow/define'
import { editHint } from '../flow/hints'
import { selectNeedsLeaveGuard, selectSaveState, useFlowStore } from '../flow/store'

/**
 * 作る画面の中の表示（Screen は src/flow/journey.ts）
 *   開始画面：3つの開始方法を選ぶ（?start= で直接開ける：work／file／saved）
 *   作業起点：作業を伝える → ファイルの確認 → 使う列と形式を決める → 作業手順 → 結果
 *   Excel起点：ファイルの確認 → 使う列と形式を決める → 作業手順 → 結果
 *   保存した作業手順を開く：ファイルの割当（列の照合・最終確認）→ 作業手順 → 結果
 * 開始方法によって変わるのは画面の順番と段階の表示だけで、作業手順・実行・品質検証は共通。
 */

const NO_FACTS: Facts = { described: false, dataReady: false, procedureReady: false, ran: false, outputDone: false }
const DEFAULT_NAME = '無題の作業手順'

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
  // 開始方法（URL の ?start=。デモは用意した作業手順を使うので「保存した手順」と同じ扱い）
  const [mode, setMode] = useState<StartMode | null>(() => (params.get('demo') ? 'SAVED_WORKFLOW' : modeFromParam(params.get('start'))))
  const [method, setMethod] = useState<BuildMethod | null>(null)
  const [described, setDescribed] = useState(false)
  const [screen, setScreen] = useState<Screen>(() =>
    params.get('demo') ? 'data' : mode === 'WORK_FIRST' ? 'describe' : mode === 'FILE_FIRST' ? 'data' : 'start',
  )
  const [sources, setSources] = useState<DefineSource[] | null>(null)
  // 直近の全体の実行結果と、実行したときの作業手順（実行後に変更したかを判定するため）
  const [lastRun, setLastRun] = useState<{ run: RunSummary; snap: string } | null>(null)
  // Excel出力の状態（結果の画面と、上部の「Excelに出力」ボタンで共有する）
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<{ runId: string; name: string } | null>(null)
  // 注意・未検証の結果を「確認したうえで出力する」と利用者が選んだ実行（実行ごとに選び直す）
  const [confirmedRun, setConfirmedRun] = useState<string | null>(null)
  const needsConfirm = lastRun?.run.verdict?.export === 'needs_confirmation'
  const confirmed = lastRun !== null && confirmedRun === lastRun.run.run_id
  const [exportError, setExportError] = useState<ApiErrorBody | null>(null)
  const doExport = async () => {
    if (!lastRun) return
    setExporting(true)
    setExportError(null)
    try {
      const name = await exportRun(lastRun.run.run_id, needsConfirm && confirmed)
      setExported({ runId: lastRun.run.run_id, name })
      // 正式な結果を出力したら、履歴の記録に印を付ける（次回の前回比較で「業務の数値」の相手になる）
      if (lastRun.run.can_export) await markPerformed(lastRun.run.run_id)
      // 出力した内容を記録する（今回だけの作業なら、これで終われる。離れるときに確認しない）
      markExported(lastRun.snap)
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
  const saveState = useFlowStore(selectSaveState)
  // 離れると失われる作業があるか（保存も出力もしていない変更）
  const unsaved = useFlowStore(selectNeedsLeaveGuard)
  const markExported = useFlowStore((s) => s.markExported)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // ?start=saved で開いたときは、すぐに作業手順を開く画面を出す
  const [opening, setOpening] = useState(() => mode === 'SAVED_WORKFLOW' && !params.get('demo'))
  // 今の作業手順を、新しく作ったか、保存したものを開いたか（戻る先が変わる）
  const [origin, setOrigin] = useState<'new' | 'opened'>('new')
  const openFlow = useFlowStore((s) => s.openFlow)
  // 別の作業手順を開いたら、割当の画面を最初からにする
  const [openedKey, setOpenedKey] = useState(0)

  // デモ（M1）：/build?demo=monthly_sales&pattern=ng で開始する。ファイルと作業手順を読み込み、作業手順の画面へ
  const [demo, setDemo] = useState<DemoStart | null>(null)
  const [demoError, setDemoError] = useState<ApiErrorBody | null>(null)
  const setBinding = useFlowStore((s) => s.setBinding)
  const setRunValues = useFlowStore((s) => s.setRunValues)
  const demoKey = `${params.get('demo') ?? ''}:${params.get('pattern') ?? ''}`
  const startedDemo = useRef('')
  // M1-3：直したデータで再実行した後、直す前の実行結果と並べて比べる
  const [beforeFix, setBeforeFix] = useState<RunSummary | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixError, setFixError] = useState<ApiErrorBody | null>(null)
  const fixAndRerun = async () => {
    if (!demo?.fixed_pattern || !lastRun) return
    setFixing(true)
    setFixError(null)
    try {
      const fixed = await startDemo(demo.demo_id, demo.fixed_pattern)
      const current = useFlowStore.getState()
      current.clearBindings()
      fixed.bindings.forEach((b) => current.setBinding({ ...b, column_mapping: {} }))
      current.setRunValues(fixed.run_parameters)
      const flow = useFlowStore.getState().flow
      const run = await runAndRecord(flow, Object.values(useFlowStore.getState().bindings), fixed.run_parameters)
      setBeforeFix(lastRun.run)
      setDemo({ ...fixed, pattern_label: '直したデータで再実行' })
      setLastRun({ run, snap: contentSnapshot(flow) })
    } catch (e) {
      setFixError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '再実行できませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setFixing(false)
    }
  }
  useEffect(() => {
    const id = params.get('demo')
    const pattern = params.get('pattern') as DemoPattern | null
    if (!id || (pattern !== 'ok' && pattern !== 'ng') || startedDemo.current === demoKey) return
    startedDemo.current = demoKey
    setDemoError(null)
    startDemo(id, pattern)
      .then(async (d) => {
        // デモの記録は、通常の履歴と混ぜない（デモを始めるたびに入れ替える。D-5）
        setHistoryScope('demo')
        await clearRecords('demo')
        openFlow(d.flow)
        d.bindings.forEach((b) => setBinding({ ...b, column_mapping: {} }))
        setRunValues(d.run_parameters)
        setOrigin('opened')
        setOpenedKey((k) => k + 1)
        setLastRun(null)
        setBeforeFix(null)
        setDemo(d)
        setMode('SAVED_WORKFLOW')
        setScreen('edit')
      })
      .catch((e) => setDemoError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'デモを始められませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoKey])

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
  // デモでなくなったら、通常の履歴の置き場に戻す（デモの記録は通常の履歴と混ぜない）
  useEffect(() => {
    if (!demo) setHistoryScope('normal')
  }, [demo])
  // 作り直すと消えてしまう、追加済みの処理ステップの数
  const addedSteps = nodes.filter((n) => n.node_type !== 'load').length

  // 開始画面のままファイルが読み込まれたら（以前のセッションのファイルが残っていた等）、Excel起点の画面にする
  useEffect(() => {
    if (screen === 'start' && fileCount > 0) {
      setMode('FILE_FIRST')
      setScreen('data')
    }
  }, [screen, fileCount])

  const renameFlow = useFlowStore((s) => s.renameFlow)
  const startNewFlow = useFlowStore((s) => s.startNewFlow)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState<ApiErrorBody | null>(null)
  const setDescription = useFlowStore((s) => s.setDescription)
  const description = useFlowStore((s) => s.flow.description)
  const defs = useFlowStore((s) => s.flow.input_definitions)
  const bindings = useFlowStore((s) => s.bindings)
  const choose = (m: StartMode) => {
    setMode(m)
    setParams({ start: START_PARAM[m] }, { replace: true })
    if (m === 'WORK_FIRST') setScreen('describe')
    else if (m === 'FILE_FIRST') setScreen('data')
    else setOpening(true)
  }
  // 段階の完了は、実際に終えたことから決める（未完了の段階を完了として表示しない）
  const facts: Facts = {
    // Excel起点では、使う列を決める画面で作業の名前を入れたら「作業を伝える」を完了とする（任意）
    described: mode === 'FILE_FIRST' ? flowName !== DEFAULT_NAME : described,
    dataReady: defs.length > 0 && defs.every((d) => bindings[d.input_id]),
    procedureReady: nodes.length > 0 && nodes.every((n) => n.confirmation_status === 'confirmed'),
    ran: lastRun !== null,
    outputDone: lastRun !== null && exported?.runId === lastRun.run.run_id,
  }
  const steps = screen === 'start' ? [] : stepViews(mode ?? 'FILE_FIRST', screen, facts, method)

  const start = (choices: InputChoice[]) => {
    const built = buildFromChoices(choices)
    startFromInputs(built.definitions, built.bindings, built.loadNodes)
    setDemo(null)
    setScreen('edit')
  }

  return (
    <>
      <div className="hidden h-screen min-h-[640px] flex-col bg-canvas lg:flex">
        <AppHeader
          flowName={sample ? '月次売上集計' : flowName}
          saveState={sample ? 'none' : saveState}
          confirmLeave={!sample && unsaved}
          canSave={!sample && nodes.length > 0}
          onSave={() => setSaving(true)}
          onOpen={sample ? undefined : () => setOpening(true)}
          onHistory={sample ? undefined : () => setShowHistory(true)}
          canExport={!sample && screen === 'result' && lastRun !== null}
          onExport={doExport}
          exporting={exporting}
          exportBlocked={needsConfirm && !confirmed ? '実行結果の画面で内容を確かめ、「確認したうえで出力する」にチェックを入れてください' : null}
        />
        {sample ? (
          <>
            <Stepper steps={stepViews('FILE_FIRST', 'edit', { ...NO_FACTS, dataReady: true })} hint={sampleHint} />
            <SampleWorkspace onClose={() => setParams({})} onHintChange={setSampleHint} />
          </>
        ) : (
          <>
            <Stepper
              steps={steps}
              hint={
                screen === 'start'
                  ? '始め方を選んでください（どの方法でも、同じ処理の仕組みと品質の確認を使います）'
                  : screen === 'describe'
                    ? '案件名とやりたい作業を入れて、手順の作り方を選んでください'
                    : screen === 'result'
                  ? lastRun?.run.status === 'failed'
                    ? '止まった理由を確かめてください。調査用に、確認結果をExcelに出力できます'
                    : lastRun?.run.verdict?.export === 'report_only'
                      ? '重大と判定された理由を確かめてください。調査用に、確認結果をExcelに出力できます'
                      : lastRun?.run.verdict?.export === 'needs_confirmation'
                        ? '判定の理由を確かめ、確認したうえでExcelに出力してください'
                        : '実行結果を確かめて、Excelに出力してください'
                  : screen === 'edit'
                  ? method === 'template' && !facts.dataReady
                    ? '仮の手順です。手順を確かめたら「次へ：データを読み込む」で今回のファイルを読み込み、列を照合してください'
                    : editHint(nodes)
                  : screen === 'define'
                    ? '作業手順で使う列と、データの形式を決めてください'
                    : screen === 'assign'
                      ? '今回使うファイルを、作業手順の入力に割り当ててください'
                    : fileCount === 0
                      ? '処理に使うExcel・CSVファイルを読み込んでください'
                      : '列名とデータの形式、先頭の行を確認してください（必要なファイルはすべて読み込みましたか？）'
              }
            />
            {demo && screen !== 'data' && <DemoBanner demo={demo} />}
            {demoError && (
              <div className="shrink-0 border-b border-edge px-6 py-3">
                <ErrorNotice error={demoError} title="デモを始められませんでした" />
              </div>
            )}
            {screen === 'start' && <StartChooser onChoose={choose} />}
            {screen === 'describe' && (
              <DescribeWork
                initialName={flowName}
                initialDescription={description}
                onBack={() => {
                  setParams({}, { replace: true })
                  setScreen('start')
                }}
                busy={templateBusy}
                onNext={async (v) => {
                  setTemplateError(null)
                  if (v.method === 'template' && v.templateId) {
                    // ひな形から「仮の手順」を作る（新しい手順ID・品質ルールは未確認）。データを読み込んだ後、列を照合して確定する
                    setTemplateBusy(true)
                    try {
                      startNewFlow(copyFlow(await fetchTemplate(v.templateId), { name: v.name, description: v.description }))
                      setDemo(null)
                      setLastRun(null)
                      setOrigin('opened')
                      setOpenedKey((k) => k + 1)
                    } catch (e) {
                      setTemplateError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'ひな形を読み込めませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
                      return
                    } finally {
                      setTemplateBusy(false)
                    }
                    setDescribed(true)
                    setMethod('template')
                    setScreen('edit')
                    return
                  }
                  renameFlow(v.name)
                  setDescription(v.description)
                  setDescribed(true)
                  setMethod(v.method)
                  setScreen('data')
                }}
              />
            )}
            {screen === 'describe' && templateError && (
              <div className="shrink-0 border-t border-edge px-6 py-3">
                <ErrorNotice error={templateError} title="ひな形を読み込めませんでした" />
              </div>
            )}
            {/* 戻ったときに選んだ内容が消えないよう、画面を切り替えても部品は残しておく */}
            <div className={screen === 'data' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <UploadStart
                onShowSample={() => setParams({ view: 'sample' })}
                onOpenSaved={() => setOpening(true)}
                onFileCountChange={setFileCount}
                onDefine={(s) => {
                  setSources((prev) => (prev && sourcesKey(prev) === sourcesKey(s) ? prev : s))
                  setScreen('define')
                }}
              />
            </div>
            {sources && (
              <div className={screen === 'define' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <DefineInputs
                  key={sourcesKey(sources)}
                  sources={sources}
                  onBack={() => setScreen('data')}
                  onStart={start}
                  replaceCount={addedSteps}
                  naming={
                    mode === 'FILE_FIRST'
                      ? {
                          name: flowName === DEFAULT_NAME ? '' : flowName,
                          description,
                          onChange: (v) => {
                            renameFlow(v.name.trim() ? v.name : DEFAULT_NAME)
                            setDescription(v.description)
                          },
                        }
                      : undefined
                  }
                />
              </div>
            )}
            {screen === 'assign' && <AssignInputs key={openedKey} onDone={() => setScreen('edit')} onSkip={() => setScreen('edit')} />}
            {screen === 'edit' && (
              <FlowSteps
                onBack={() => setScreen(origin === 'opened' ? 'assign' : 'define')}
                backLabel={
                  // ひな形から作った仮の手順は、まだデータを読み込んでいない（次に進む操作として示す）
                  method === 'template' && !facts.dataReady ? '次へ：データを読み込む' : origin === 'opened' ? 'ファイルの割当に戻る' : '使う列と形式の設定に戻る'
                }
                onRan={(run, snap) => {
                  setBeforeFix(null) // 自分で実行し直したら、前の比較は消す（古い比較を残さない）
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
                confirmed={confirmed}
                onConfirmChange={(v) => setConfirmedRun(v ? lastRun.run.run_id : null)}
                onSave={() => setSaving(true)}
                saved={saveState === 'none' && !demo} // デモの作業手順は、利用者が保存したものではない
                fix={demo?.fix_note && demo.fixed_pattern && lastRun.run.verdict?.verdict !== 'normal' ? { note: demo.fix_note, busy: fixing, error: fixError, onRun: fixAndRerun } : null}
                before={beforeFix}
                exporting={exporting}
                exportedName={exported?.runId === lastRun.run.run_id ? exported.name : null}
                exportError={exportError}
              />
            )}
          </>
        )}
      </div>
      {saving && <SaveDialog onClose={() => setSaving(false)} />}
      {showHistory && <HistoryDialog onClose={() => setShowHistory(false)} />}
      {opening && (
        <OpenDialog
          unsaved={unsaved}
          onClose={() => setOpening(false)}
          onOpened={(flow) => {
            setDemo(null) // 別の作業手順を開いたら、デモの案内は消す
            openFlow(flow)
            setMode('SAVED_WORKFLOW')
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
