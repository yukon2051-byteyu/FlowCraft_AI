import { ArrowLeft, ArrowRight, CirclePlay, RotateCcw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../api/client'
import type { ApiErrorBody } from '../api/client'
import { buildImprovement, diagnoseScenario, fetchScenario } from '../api/kaizen'
import type { Diagnosis, Improvement, ScenarioResponse } from '../api/kaizen'
import { AfterProcedure } from '../components/kaizen/AfterProcedure'
import { CandidateList } from '../components/kaizen/CandidateList'
import { DecisionList } from '../components/kaizen/DecisionList'
import { CurrentWork } from '../components/kaizen/CurrentWork'
import { KaizenProgress } from '../components/kaizen/KaizenProgress'
import type { KaizenStepState } from '../components/kaizen/KaizenProgress'
import { SiteHeader } from '../components/layout/SiteHeader'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { STATUS_DONE_LABEL, initialDecisions, problems } from '../kaizen/decisions'
import type { Decisions } from '../kaizen/decisions'
import { clearKaizenState, handOffFlow, resumeState } from '../kaizen/handoff'

/*
 * 業務改善診断デモ（デモ①「その集計、本当に必要？」）。
 * 廃止 → 簡素化 → 標準化 → 自動化 の順に見直し、採用した改善だけを、実行できる作業手順にする。
 * 改善候補は決まった規則で検出する（AIは使わない。AIの診断として表示しない）。
 *
 * 実装済み：STEP 1（現在の作業）・STEP 2（改善候補と根拠）・STEP 3（利用者の判断）・STEP 4（改善後の手順。サーバーが判断から組み立てる）。
 * STEP 4 から、作った作業手順を作業手順の画面で開き、サンプルのExcelで実行・品質の確認・出力・保存できる（Phase 5）。
 * 作業手順の画面の「業務改善デモに戻る」（?resume=1）のときだけ、判断と改善後の手順を戻す。それ以外は初期状態から始める。
 * STEP 5 は準備中（押せない）。
 * 判断は画面の中だけに持つ（読み込み直す・「最初からやり直す」で初期状態に戻る。前の判断が意図せず残らない）。
 */

const READY_STEPS = 4 // 使えるSTEPの数（Phase 3 以降で増やす）

const HEADINGS = [
  (min: number) => `毎月${min}分のExcel作業。何に時間がかかっている？`,
  () => '自動化する前に、見直せる作業があります。',
  () => '改善する作業を選んでください。',
  () => '必要な作業だけを残して、手順を作り直しました。',
  () => '作業を減らして、必要な確認は残す。',
]

function toBody(e: unknown): ApiErrorBody {
  if (e instanceof ApiError) return e.body
  return { code: 'UNKNOWN', message: '読み込みに失敗しました。', cause: null, how_to_fix: 'ページを読み込み直してください。', node_id: null }
}

export default function KaizenDemoPage() {
  const [step, setStep] = useState(0)
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const [busy, setBusy] = useState(false)
  const [decisions, setDecisions] = useState<Decisions>({})
  const [improvement, setImprovement] = useState<Improvement | null>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    document.title = '業務改善デモ：その集計、本当に必要？ | FlowCraft AI'
    fetchScenario().then(setScenario, (e) => setError(toBody(e)))
    const resumed = params.get('resume') === '1' ? resumeState() : null
    if (!resumed) {
      clearKaizenState()
      return
    }
    // 作業手順の画面から戻ってきた：判断と改善後の手順を戻す（候補は決まった規則なので、検出し直しても同じ）
    diagnoseScenario().then(
      (d) => {
        setDiagnosis(d)
        setDecisions(resumed.decisions)
        setImprovement(resumed.improvement)
        setStep(resumed.improvement ? resumed.step : 2)
      },
      (e) => setError(toBody(e)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openAndRun() {
    if (!improvement?.flow) return
    if (!handOffFlow(improvement.flow, { step: 3, decisions, improvement })) {
      setError({ code: 'STORAGE_UNAVAILABLE', message: '作業手順の画面へ受け渡せませんでした。', cause: 'このブラウザでは、一時的な保存（セッションストレージ）を使えません。', how_to_fix: 'プライベートモードを解除するか、別のブラウザでお試しください。', node_id: null })
      return
    }
    navigate('/build?kaizen=monthly_report')
  }

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [step])

  async function startDiagnosis() {
    setError(null)
    if (!diagnosis) {
      setBusy(true)
      try {
        const got = await diagnoseScenario()
        setDiagnosis(got)
        setDecisions(initialDecisions(got.candidates))
      } catch (e) {
        setError(toBody(e))
        return
      } finally {
        setBusy(false)
      }
    }
    setStep(1)
  }

  /** 判断から改善後の手順を作る（判断を変えて戻ってきたときも、その時点の判断で作り直す） */
  async function buildAfter() {
    setError(null)
    setBusy(true)
    try {
      setImprovement(await buildImprovement(decisions))
      setStep(3)
    } catch (e) {
      setError(toBody(e))
    } finally {
      setBusy(false)
    }
  }

  function restart() {
    clearKaizenState()
    setImprovement(null)
    setDecisions(diagnosis ? initialDecisions(diagnosis.candidates) : {})
    setError(null)
    setStep(0)
  }

  const states: KaizenStepState[] = [0, 1, 2, 3, 4].map((i) => (i === step ? 'current' : i < step ? 'done' : i >= READY_STEPS ? 'soon' : 'todo'))
  const minutes = scenario?.total_minutes ?? 0
  const decisionIssues = diagnosis ? problems(diagnosis.candidates, decisions) : []
  const statusLabel = Object.fromEntries(Object.entries(decisions).map(([id, d]) => [id, STATUS_DONE_LABEL[d.status ?? 'none']]))

  return (
    <div className="min-h-screen bg-canvas">
      <SiteHeader />
      <main className="mx-auto max-w-6xl py-8 px-8">
        <p className="text-[0.85rem] font-bold text-kaizen-text">
          <Search className="mr-1 inline size-4 align-[-3px]" aria-hidden />
          業務改善デモ：その集計、本当に必要？
        </p>
        <div className="mt-3">
          <KaizenProgress states={states} />
        </div>
        <h1 className="mt-6 text-[1.6rem] leading-snug font-bold text-white">
          <span className="mr-2 text-[1rem] text-mint">STEP {step + 1}</span>
          {HEADINGS[step](minutes)}
        </h1>

        {error && (
          <div className="mt-4">
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <div className="mt-6">
          {!scenario && !error && <p className="text-subtle">読み込んでいます…</p>}
          {scenario && step === 0 && <CurrentWork data={scenario} />}
          {scenario && step === 1 && diagnosis && <CandidateList diagnosis={diagnosis} scenario={scenario.scenario} status={statusLabel} />}
          {scenario && step === 2 && diagnosis && (
            <DecisionList candidates={diagnosis.candidates} scenario={scenario.scenario} decisions={decisions} onChange={setDecisions} />
          )}
          {scenario && step === 3 && improvement && <AfterProcedure data={improvement} scenario={scenario.scenario} />}
        </div>

        <nav aria-label="STEPの移動" className="mt-8 flex flex-wrap items-center gap-3 border-t border-edge pt-6">
          {step > 0 && (
            <Button variant="outlineDark" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="size-4" aria-hidden />
              前のSTEPへ戻る
            </Button>
          )}
          {step > 0 && (
            <Button variant="ghostDark" size="sm" onClick={restart}>
              <RotateCcw className="size-4" aria-hidden />
              最初からやり直す
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {step === 0 && (
              <Button variant="primary" size="lg" onClick={() => void startDiagnosis()} disabled={!scenario || busy}>
                {busy ? '診断しています…' : 'この作業を改善診断する'}
                <ArrowRight className="size-4.5" aria-hidden />
              </Button>
            )}
            {step === 1 && (
              <Button variant="primary" size="lg" onClick={() => setStep(2)}>
                次へ進む：改善する作業を選ぶ
                <ArrowRight className="size-4.5" aria-hidden />
              </Button>
            )}
            {step === 2 && (
              <>
                {decisionIssues.length > 0 && <p className="max-w-md text-right text-[0.85rem] text-subtle">判断がすべてそろうと、次へ進めます。</p>}
                <Button variant="primary" size="lg" onClick={() => void buildAfter()} disabled={decisionIssues.length > 0 || busy} title={decisionIssues[0]}>
                  {busy ? '作成しています…' : '次へ進む：改善後の手順を作る'}
                  <ArrowRight className="size-4.5" aria-hidden />
                </Button>
              </>
            )}
            {step === 3 && (
              <>
                {improvement?.flow ? (
                  <Button variant="primary" size="lg" onClick={openAndRun}>
                    <CirclePlay className="size-5" aria-hidden />
                    この作業手順を開いて、サンプルのExcelで実行する
                  </Button>
                ) : (
                  <p className="max-w-md text-right text-[0.85rem] text-subtle">自動化を採用していないため、実行できる作業手順はありません。</p>
                )}
                <Button variant="outlineDark" size="lg" disabled title="STEP 5（改善前後の比較）は準備中です">
                  次へ進む（準備中）
                  <ArrowRight className="size-4.5" aria-hidden />
                </Button>
              </>
            )}
          </div>
        </nav>
      </main>
    </div>
  )
}
