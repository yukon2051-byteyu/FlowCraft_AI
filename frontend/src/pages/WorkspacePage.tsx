import { ArrowLeft, House, LoaderCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppHeader } from '../components/workspace/AppHeader'
import { SampleWorkspace } from '../components/workspace/SampleWorkspace'
import { Stepper } from '../components/workspace/Stepper'
import { StartChooser } from '../components/workspace/StartChooser'
import { DescribeWork } from '../components/workspace/DescribeWork'
import { demoStepIndex, demoStepViews, modeFromParam, positionOf, START_PARAM, stepViews } from '../flow/journey'
import { fetchTemplate } from '../api/templates'
import { copyFlow } from '../flow/copy'
import type { BuildMethod, Facts, Screen, StartMode } from '../flow/journey'
import { UploadStart } from '../components/workspace/UploadStart'
import type { DefineSource } from '../components/workspace/UploadStart'
import { DefineInputs } from '../components/workspace/DefineInputs'
import { FlowSteps } from '../components/workspace/FlowSteps'
import { OutputStep } from '../components/workspace/run/OutputStep'
import { BackToDemos } from '../components/demo/BackToDemos'
import { useQuery } from '@tanstack/react-query'
import { isAvailable } from '../content/featureStatus'
import { AiDiagnosis } from '../components/workspace/ai/AiDiagnosis'
import { AdoptedImprovements } from '../components/workspace/ai/AdoptedImprovements'
import type { ImprovementPlan } from '../flow/aiPlan'
import type { DiagnosisStage } from '../components/workspace/ai/AiDiagnosis'
import { getAiStatus } from '../api/ai'
import { RunResults } from '../components/workspace/run/RunResults'
import { SaveDialog } from '../components/workspace/SaveDialog'
import { HistoryDialog } from '../components/workspace/HistoryDialog'
import { DemoBanner } from '../components/workspace/DemoBanner'
import { startDemo } from '../api/demos'
import { startKaizen } from '../api/kaizen'
import { KaizenBanner } from '../components/workspace/KaizenBanner'
import { DemoData } from '../components/workspace/demo/DemoData'
import { DemoImprove } from '../components/workspace/demo/DemoImprove'
import { DemoIntro } from '../components/workspace/demo/DemoIntro'
import { DemoReview } from '../components/workspace/demo/DemoReview'
import { handedFlow, saveRunResult } from '../kaizen/handoff'
import { hasDemoSession, markDemoSession, takeDemoSession } from '../flow/demoSession'
import { deleteFile } from '../api/files'
import type { DemoPattern, DemoStart } from '../api/demos'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { OpenDialog } from '../components/workspace/OpenDialog'
import { AssignInputs } from '../components/workspace/AssignInputs'
import { exportRun, runAndRecord } from '../api/flows'
import { clearRecords, markPerformed, setHistoryScope } from '../api/historyStore'
import { contentSnapshot, normalizeFlow } from '../flow/ops'
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
const AI_STAGE_HINT: Record<DiagnosisStage, string> = {
  context: 'AIに送る情報を確かめてから、AIに質問を作ってもらってください（回答は任意です）',
  questions: '分かる質問に答えて、改善案を作ってもらってください（空欄のままでも進めます）',
  proposals: '提案ごとに、採用・保留・採用しないを選んでください（理由は任意です）',
  plan: '手順に反映できる改善と、人が行う作業として残るものを確かめてください',
}

/** 選んだファイル・シート・見出し行が同じなら、決めた内容を残す（変わったら最初から決め直す） */
const sourcesKey = (sources: DefineSource[]) => sources.map((s) => `${s.summary.file_id}:${s.detail.sheet}:${s.detail.header_row}`).join('|')

/**
 * ワークスペース（フロー編集画面）。
 * ?view=sample のときはサンプルフローを表示する（URLで状態を持つので、再読み込みしても同じ表示になる）。
 * PC専用（スマートフォンには App が PC専用の案内を出す。画面幅では切り替えない）。
 */
export default function WorkspacePage() {
  const [params, setParams] = useSearchParams()
  const sample = params.get('view') === 'sample'
  const [fileCount, setFileCount] = useState(0)
  const [sampleHint, setSampleHint] = useState('')
  // 開始方法（URL の ?start=。デモは用意した作業手順を使うので「保存した手順」と同じ扱い）
  const [mode, setMode] = useState<StartMode | null>(() => (params.get('demo') || params.get('kaizen') ? 'SAVED_WORKFLOW' : modeFromParam(params.get('start'))))
  const [method, setMethod] = useState<BuildMethod | null>(null)
  const [described, setDescribed] = useState(false)
  const [screen, setScreen] = useState<Screen>(() =>
    params.get('demo') ? 'demo_intro' : params.get('kaizen') ? 'data' : mode === 'WORK_FIRST' ? 'describe' : mode === 'FILE_FIRST' ? 'data' : 'start',
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
  const [opening, setOpening] = useState(() => mode === 'SAVED_WORKFLOW' && !params.get('demo') && !params.get('kaizen'))
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
  // デモの段階（作業を知る → 手順と改善 → データ → 実行・品質確認 → 結果）。進んだことのある最も先の段階
  const [demoVisited, setDemoVisited] = useState(0)
  // 「もう一度試す」でデモの開始をやり直す
  const [demoAttempt, setDemoAttempt] = useState(0)
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
      markDemoSession(fixed.bindings.map((b) => b.file_id))
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
    // 同じデモの中で正常／品質異常を切り替えたときは、データが変わるので「データを確認」から。新しく始めたときは「作業を知る」から
    const sameDemo = startedDemo.current.split(':')[0] === id
    startedDemo.current = demoKey
    setDemoError(null)
    startDemo(id, pattern)
      .then(async (d) => {
        // デモの記録は、通常の履歴と混ぜない（デモを始めるたびに入れ替える。D-5）
        setHistoryScope('demo')
        await clearRecords('demo')
        openFlow(d.flow)
        markDemoSession(d.bindings.map((b) => b.file_id))
        d.bindings.forEach((b) => setBinding({ ...b, column_mapping: {} }))
        setRunValues(d.run_parameters)
        setOrigin('opened')
        setOpenedKey((k) => k + 1)
        setLastRun(null)
        setBeforeFix(null)
        setDemo(d)
        setMode('SAVED_WORKFLOW')
        setDemoVisited(sameDemo ? 2 : 0)
        setScreen(sameDemo ? 'demo_data' : 'demo_intro')
      })
      .catch((e) => setDemoError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'デモを始められませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoKey, demoAttempt])
  // デモの中で進んだ段階を覚える（戻っても、進んだことのある段階は完了のまま）
  useEffect(() => {
    const i = demoStepIndex(screen)
    if (demo && i !== null) setDemoVisited((v) => Math.max(v, i))
  }, [screen, demo])
  const retryDemo = () => {
    startedDemo.current = ''
    setDemoAttempt((n) => n + 1)
  }

  // 業務改善デモ：/build?kaizen=monthly_report で、STEP 4 で作った作業手順（このタブに受け渡したもの）を開き、
  // 部署のExcel（架空のデータ）を割り当てる。以後の実行・品質の確認・出力・保存は、通常の作業手順と同じ
  const [kaizenRun, setKaizenRun] = useState(false)
  const startedKaizen = useRef('')
  useEffect(() => {
    const id = params.get('kaizen')
    if (!id || startedKaizen.current === id) return
    startedKaizen.current = id
    setDemoError(null)
    const flow = handedFlow()
    if (!flow) {
      setDemoError({ code: 'KAIZEN_FLOW_MISSING', message: '改善後の作業手順が見つかりません。', cause: '業務改善デモから開いていないか、このブラウザで受け渡しができませんでした。', how_to_fix: '業務改善デモの「改善後の手順を作成」から、もう一度開いてください。', node_id: null })
      return
    }
    startKaizen(id)
      .then(async (k) => {
        setHistoryScope('demo') // デモの記録は、通常の履歴と混ぜない
        await clearRecords('demo')
        // 改善後の作業手順は、まだ保存していない新しい作業手順（初めて保存すると版1）
        useFlowStore.getState().startNewFlow(normalizeFlow(flow))
        markDemoSession(k.bindings.map((b) => b.file_id))
        k.bindings.forEach((b) => setBinding({ ...b, column_mapping: {} }))
        setRunValues(k.run_parameters)
        setOrigin('opened')
        setOpenedKey((n) => n + 1)
        setLastRun(null)
        setDemo(null)
        setKaizenRun(true)
        setMode('SAVED_WORKFLOW')
        setScreen('edit')
      })
      .catch((e) => setDemoError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '業務改善デモの作業手順を開けませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('kaizen')])

  // 業務改善デモ：改善後の作業手順を実行したら、結果の要約を業務改善デモへ受け渡す（STEP 5 の比較に実際の結果として出す）
  useEffect(() => {
    if (!kaizenRun || !lastRun) return
    const r = lastRun.run
    saveRunResult({
      flow_id: useFlowStore.getState().flow.flow_id,
      executed_at: r.executed_at,
      verdict: r.verdict?.verdict ?? null,
      headline: r.verdict?.headline ?? null,
      can_export: r.can_export,
      criteria_total: r.criteria.length,
      criteria_passed: r.criteria.filter((c) => c.status === 'passed').length,
    })
  }, [kaizenRun, lastRun])

  // デモ以外の入口（「自分のExcelで試す」など）で開いたとき、前に動かしたデモの作業手順とファイルを後片付けする。
  // 利用者が自分で読み込んだファイルは消さない（デモで読み込んだファイルだけを記録している）。終わるまでファイルの一覧は出さない
  const normalEntry = !params.get('demo') && !params.get('kaizen') && !sample
  const [cleaningDemo, setCleaningDemo] = useState(() => normalEntry && hasDemoSession())
  const [uploadKey, setUploadKey] = useState(0)
  useEffect(() => {
    if (!normalEntry || !hasDemoSession()) return
    const ids = takeDemoSession()
    void Promise.allSettled(ids.map((id) => deleteFile(id))).then(() => {
      useFlowStore.getState().newFlow(DEFAULT_NAME)
      setDemo(null)
      setKaizenRun(false)
      setLastRun(null)
      setBeforeFix(null)
      setHistoryScope('normal')
      startedDemo.current = ''
      startedKaizen.current = ''
      const m = modeFromParam(params.get('start'))
      setMode(m)
      setScreen(m === 'WORK_FIRST' ? 'describe' : m === 'FILE_FIRST' ? 'data' : 'start')
      setOpening(m === 'SAVED_WORKFLOW')
      setUploadKey((k) => k + 1)
      setCleaningDemo(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalEntry])

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
    if (!demo && !kaizenRun) setHistoryScope('normal')
  }, [demo, kaizenRun])
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
  // AIの状態（使わない・固定応答・実際のAI）。分からないときは「開発中」として扱う（選べない）
  const aiStatus = useQuery({ queryKey: ['ai-status'], queryFn: getAiStatus, retry: false }).data?.status ?? null
  const defs = useFlowStore((s) => s.flow.input_definitions)
  const bindings = useFlowStore((s) => s.bindings)
  // AI業務改善診断で採用した改善（手順の画面に一覧で出す）。別の作り方を始めたら消す
  const [aiPlan, setAiPlan] = useState<ImprovementPlan | null>(null)
  const [aiStage, setAiStage] = useState<DiagnosisStage>('context')
  // 作った作業手順から見直している（手順は置き換えず、判断を記録して手順の画面に戻る）
  const [aiFromFlow, setAiFromFlow] = useState(false)
  const recordDiagnosis = useFlowStore((s) => s.recordDiagnosis)
  // AIで業務を改善する：固定応答（開発・テスト）か、実際のAIがあり機能が完成しているときだけ選べる
  const aiSelectable = aiStatus === 'fixed' || (aiStatus === 'live' && isAvailable('kaizen'))
  // ひな形から「仮の手順」を作る（新しい手順ID・品質ルールは未確認）。データを読み込んだ後、列を照合して確定する
  const startFromTemplate = async (templateId: string, name: string, desc: string) => {
    setTemplateError(null)
    setTemplateBusy(true)
    try {
      // 改善の記録（AI業務改善診断の回答と判断）は、この業務についてのものなので引き継ぐ
      const log = useFlowStore.getState().flow.improvement_log ?? []
      startNewFlow({ ...copyFlow(await fetchTemplate(templateId), { name, description: desc }), improvement_log: log })
      setDemo(null)
      setKaizenRun(false)
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
  }
  const choose = (m: StartMode) => {
    setMode(m)
    setAiPlan(null)
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
  const inDemo = !!params.get('demo')
  const steps = inDemo ? demoStepViews(screen, demoVisited) : screen === 'start' ? [] : stepViews(mode ?? 'FILE_FIRST', screen, facts, method)

  const start = (choices: InputChoice[]) => {
    const built = buildFromChoices(choices)
    startFromInputs(built.definitions, built.bindings, built.loadNodes)
    setDemo(null)
    setKaizenRun(false)
    setScreen('edit')
  }

  return (
    <>
      <div className="flex h-screen min-h-[640px] flex-col bg-canvas">
        <AppHeader
          flowName={sample ? '月次売上集計' : flowName}
          saveState={sample ? 'none' : saveState}
          confirmLeave={!sample && unsaved}
          canSave={!sample && nodes.length > 0}
          onSave={() => setSaving(true)}
          onOpen={sample ? undefined : () => setOpening(true)}
          onHistory={sample ? undefined : () => setShowHistory(true)}
          // デモ中（作業手順のデモの全段階・業務改善デモから開いた作業手順）は、履歴・開く・保存を出さない
          demo={!!demo || kaizenRun}
          canExport={!sample && (screen === 'result' || screen === 'output') && lastRun !== null}
          onExport={!demo && screen === 'result' ? () => setScreen('output') : doExport}
          exporting={exporting}
          exportPrimary={screen === 'output' || (!!demo && screen === 'result')}
          exportBlocked={
            needsConfirm && !confirmed && (demo || screen === 'output') ? '実行結果の画面で内容を確かめ、「確認したうえで出力する」にチェックを入れてください' : null
          }
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
                inDemo && screen === 'demo_intro'
                  ? 'どんな業務で、どこに課題があるかを確かめてください（架空の業務シナリオ）'
                  : screen === 'demo_improve'
                    ? '改善前と改善後、改善後の処理手順を確かめてください'
                    : screen === 'demo_data'
                      ? '使用するデータと列の構成を確かめてください'
                      : inDemo && screen === 'edit'
                        ? '「作業手順全体を実行する」を押すと、実際の処理と品質の確認を行います'
                        : screen === 'start'
                  ? '始め方を選んでください（どの方法でも、同じ処理の仕組みと品質の確認を使います）'
                  : screen === 'describe'
                    ? '案件名とやりたい作業を入れて、手順の作り方を選んでください'
                    : screen === 'ai_diagnosis'
                      ? AI_STAGE_HINT[aiStage]
                    : screen === 'output'
                      ? 'Excelに出力して、作業を終えてください（作業手順の保存は任意です）'
                    : screen === 'result'
                  ? lastRun?.run.status === 'failed'
                    ? '止まった理由を確かめてください。調査用に、確認結果をExcelに出力できます'
                    : lastRun?.run.verdict?.export === 'report_only'
                      ? '重大と判定された理由を確かめてください。調査用に、確認結果をExcelに出力できます'
                      : lastRun?.run.verdict?.export === 'needs_confirmation'
                        ? '判定の理由を確かめ、確認したうえで出力・保存へ進んでください'
                        : demo
                          ? '実行結果を確かめて、Excelに出力してください'
                          : '実行結果を確かめて、「次へ：出力・保存」に進んでください'
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
            {demo && screen !== 'data' && screen !== 'demo_intro' && <DemoBanner demo={demo} />}
            {kaizenRun && screen !== 'data' && <KaizenBanner />}
            {demoError && (
              <div className="shrink-0 border-b border-edge px-6 py-3">
                <ErrorNotice error={demoError} title="デモを始められませんでした" onRetry={inDemo ? retryDemo : undefined} />
              </div>
            )}
            {screen === 'start' && <StartChooser onChoose={choose} />}
            {screen === 'describe' && (
              <DescribeWork
                initialName={flowName}
                initialDescription={description}
                // AIで業務を改善する：固定応答（開発・テスト）か、実際のAIがあり機能が完成しているときだけ選べる
                ai={aiSelectable ? 'selectable' : aiStatus === 'off' ? 'off' : 'dev'}
                onAi={(v) => {
                  setAiFromFlow(false)
                  renameFlow(v.name)
                  setDescription(v.description)
                  setDescribed(true)
                  setScreen('ai_diagnosis')
                }}
                onBack={() => {
                  setParams({}, { replace: true })
                  setScreen('start')
                }}
                busy={templateBusy}
                onNext={async (v) => {
                  setTemplateError(null)
                  setAiPlan(null)
                  if (v.method === 'template' && v.templateId) {
                    await startFromTemplate(v.templateId, v.name, v.description)
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
            {screen === 'ai_diagnosis' && (
              <AiDiagnosis
                name={flowName}
                purpose={description}
                onBack={() => setScreen(aiFromFlow ? 'edit' : 'describe')}
                onSkip={() => setScreen(aiFromFlow ? 'edit' : 'describe')}
                building={templateBusy}
                onStage={setAiStage}
                existing={aiFromFlow}
                onBuild={async (plan, how, record) => {
                  // 回答と判断・理由を、改善の記録に残す（作業手順を保存すると、ファイルに残る）
                  recordDiagnosis(record)
                  if (how.kind === 'return') {
                    if (plan.adopted.length) setAiPlan(plan)
                    setScreen('edit')
                    return
                  }
                  if (how.kind === 'choose') {
                    setAiPlan(null)
                    setScreen('describe')
                    return
                  }
                  setAiPlan(plan.adopted.length ? plan : null)
                  if (how.kind === 'template') {
                    await startFromTemplate(how.templateId, flowName, description)
                    return
                  }
                  // 処理部品を組み合わせて作る：データを読み込んでから、使う列と形式を決めて手順を作る
                  setTemplateError(null)
                  setMethod('parts_from_data')
                  setScreen('data')
                }}
              />
            )}
            {(screen === 'describe' || screen === 'ai_diagnosis') && templateError && (
              <div className="shrink-0 border-t border-edge px-6 py-3">
                <ErrorNotice error={templateError} title="ひな形を読み込めませんでした" />
              </div>
            )}
            {/* 戻ったときに選んだ内容が消えないよう、画面を切り替えても部品は残しておく */}
            {cleaningDemo && (
              <p className="flex flex-1 items-center justify-center gap-2 text-subtle" role="status">
                <LoaderCircle className="size-5 animate-spin" aria-hidden />
                前のデモの作業手順とファイルを片付けています…
              </p>
            )}
            <div className={screen === 'data' && !cleaningDemo ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              {!cleaningDemo && <UploadStart
                key={uploadKey}
                onShowSample={() => setParams({ view: 'sample' })}
                onOpenSaved={() => setOpening(true)}
                onFileCountChange={setFileCount}
                onDefine={(s) => {
                  setSources((prev) => (prev && sourcesKey(prev) === sourcesKey(s) ? prev : s))
                  setScreen('define')
                }}
              />}
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
            {screen === 'demo_intro' &&
              (demo ? (
                <DemoIntro demo={demo} onNext={() => setScreen('demo_improve')} />
              ) : (
                !demoError && (
                  <p className="flex flex-1 items-center justify-center gap-2 text-subtle">
                    <LoaderCircle className="size-5 animate-spin" aria-hidden />
                    デモを準備しています…
                  </p>
                )
              ))}
            {screen === 'demo_improve' && demo && <DemoImprove demo={demo} onBack={() => setScreen('demo_intro')} onNext={() => setScreen('demo_data')} />}
            {screen === 'demo_data' && demo && <DemoData onBack={() => setScreen('demo_improve')} onNext={() => setScreen('edit')} />}
            {screen === 'assign' && <AssignInputs key={openedKey} onDone={() => setScreen('edit')} onSkip={() => setScreen('edit')} />}
            {screen === 'edit' && (
              <FlowSteps
                // ひな形から作った仮の手順は、まだデータを読み込んでいない（STEP 2）。主要ボタンは「次へ：データを読み込む」だけにする
                {...(!demo && method === 'template' && !facts.dataReady
                  ? {
                      onNext: () => setScreen(origin === 'opened' ? 'assign' : 'define'),
                      position: positionOf(steps),
                    }
                  : {
                      onBack: () => setScreen(demo ? 'demo_data' : origin === 'opened' ? 'assign' : 'define'),
                      backLabel: demo ? '前へ：データを確認' : origin === 'opened' ? 'ファイルの割当に戻る' : '使う列と形式の設定に戻る',
                    })}
                // デモでは、どの段階からでもデモ選択へ戻れる（すべてのデモで共通の部品）
                leading={demo ? <BackToDemos /> : undefined}
                banner={!demo && aiPlan ? <AdoptedImprovements items={aiPlan.adopted} /> : undefined}
                // 作った手順から、作業の見直し（AI業務改善診断）へ。デモ・業務改善デモの手順では出さない
                onReview={
                  aiSelectable && !demo && !kaizenRun
                    ? () => {
                        setAiFromFlow(true)
                        setScreen('ai_diagnosis')
                      }
                    : undefined
                }
                // 実行済みなら、実行し直さずに結果へ進める（デモで前の段階へ戻っても、結果を消さない）
                onShowResult={lastRun ? () => setScreen('result') : undefined}
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
                review={demo?.story ? <DemoReview story={demo.story} criteria={lastRun.run.criteria} /> : undefined}
                demoTitle={demo?.title}
                amountUnit={!!demo}
                // デモ以外は、この画面を STEP 4（実行・品質確認）にして、出力・保存は STEP 5 で行う
                onNext={demo ? undefined : () => setScreen('output')}
                footer={
                  demo ? (
                    // デモの終わり：左端「別のデモを試す」（デモ選択へ。共通の部品）｜「作業手順に戻る」（前の段階）…右端に主要な操作「TOPページに戻る」
                    <nav aria-label="デモの終了" className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
                      <BackToDemos label="別のデモを試す" />
                      <span className="h-6 w-px bg-edge" aria-hidden />
                      <Button variant="ghostDark" size="sm" onClick={() => setScreen('edit')}>
                        <ArrowLeft className="size-4" aria-hidden />
                        作業手順に戻る
                      </Button>
                      <Button to="/" variant="primary" className="ml-auto">
                        <House className="size-4" aria-hidden />
                        TOPページに戻る
                      </Button>
                    </nav>
                  ) : undefined
                }
              />
            )}
            {screen === 'output' && lastRun && (
              <OutputStep
                run={lastRun.run}
                snap={lastRun.snap}
                onBack={() => setScreen('result')}
                onExport={doExport}
                exporting={exporting}
                exportedName={exported?.runId === lastRun.run.run_id ? exported.name : null}
                exportError={exportError}
                confirmed={!needsConfirm || confirmed}
                onSave={() => setSaving(true)}
                saved={saveState === 'none'}
                onOpen={() => setOpening(true)}
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
            setKaizenRun(false)
            setAiPlan(null) // 開いた作業手順は、今回の診断で作ったものではない
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
    </>
  )
}
