import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CircleHelp, EyeOff, Hand, Info, LoaderCircle, Sparkles, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { askDiagnosisProposals, askDiagnosisQuestions, buildDiagnosisContext } from '../../../api/ai'
import type { ContextRequest, ProposalsResponse, QuestionsResponse } from '../../../api/ai'
import { BuildLine, ProposalList } from './ProposalList'
import { makePlan, makeRecord } from '../../../flow/aiPlan'
import type { AdoptedImprovement, Decision, ImprovementPlan } from '../../../flow/aiPlan'
import type { DiagnosisRecord } from '../../../flow/types'
import { listFiles } from '../../../api/files'
import { useFlowStore } from '../../../flow/store'
import { useAiAction } from '../../ai/useAiAction'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'

/*
 * AI業務改善診断（A-3〜A-5）：① AIに送る情報を確かめる → ② AIからの質問に答える（任意） → ③ 改善提案を採用・保留・不採用にする
 *   → ④ 採用した改善の反映の計画を確かめて、手順を作る（手順に反映できるもの／人が行う作業として残るものに分ける）
 * - 送る情報は、今ある情報からサーバーが組み立てる（同じ内容を再入力させない）。送る前に、そのまま見せる
 * - 質問は初回3問まで。データからは分からない業務の背景だけ。各質問に「なぜ聞くか」。回答は任意
 * - AIを使えないとき（設定なし・上限・応答を確かめられない）は理由を示し、AIを使わずに手順を作る道を示す（簡易診断へ切り替えない）
 * - AIの提案から処理ステップを自動で組み立てない。ひな形があればそれを選んだ状態で、手順の画面で利用者が確かめながら作る
 * - 回答と判断・理由は、改善の記録（作業手順ファイル 1.5）に残す（A-6）。次の診断では送る情報に入り、同じ質問をしない
 * - 作った手順から見直すとき（existing）は、今の手順を置き換えない。判断を記録して手順の画面に戻る
 */

/** 手順の作り方：ひな形から作る／処理部品を組み合わせて作る（データを読み込んでから）／作り方を選び直す */
export type BuildChoice = { kind: 'template'; templateId: string } | { kind: 'parts' } | { kind: 'choose' } | { kind: 'return' }
/** 診断の段階（上部の「次の操作」の案内に使う） */
export type DiagnosisStage = 'context' | 'questions' | 'proposals' | 'plan'

const LINES_SHOWN = 8

export function AiDiagnosis({
  name,
  purpose,
  onBack,
  onSkip,
  onBuild,
  building = false,
  onStage,
  existing = false,
}: {
  name: string
  purpose: string
  onBack: () => void
  onSkip: () => void
  /** ④ 反映の計画を確かめて、手順を作る（record：改善の記録に加える1回分） */
  onBuild: (plan: ImprovementPlan, how: BuildChoice, record: DiagnosisRecord) => void
  /** ひな形を読み込んでいる */
  building?: boolean
  /** 段階が変わったとき */
  onStage?: (stage: DiagnosisStage) => void
  /** 作った作業手順から見直す（手順は置き換えず、判断を記録して手順の画面に戻る） */
  existing?: boolean
}) {
  const flow = useFlowStore((s) => s.flow)
  const bindings = useFlowStore((s) => s.bindings)
  const files = useQuery({ queryKey: ['files'], queryFn: listFiles })
  // 材料に入れるファイル：割当があれば割当（シート・見出し行・作業手順での名前）、なければ読み込んだファイル
  const req: ContextRequest | null = useMemo(() => {
    if (files.isPending) return null
    const bound = Object.values(bindings)
    const label = (inputId: string) => flow.input_definitions.find((d) => d.input_id === inputId)?.label ?? null
    return {
      name,
      purpose,
      // 改善の記録（前回までの診断）があれば、手順がまだなくても送る
      flow: flow.nodes.length || flow.completion_criteria.items.length || flow.improvement_log?.length ? flow : null,
      files: bound.length
        ? bound.map((b) => ({ file_id: b.file_id, sheet: b.sheet, header_row: b.header_row, label: label(b.input_id) }))
        : (files.data ?? []).map((f) => ({ file_id: f.file_id, label: f.filename })),
    }
  }, [files.isPending, files.data, bindings, flow, name, purpose])
  const context = useQuery({ queryKey: ['ai-context', req], queryFn: () => buildDiagnosisContext(req!), enabled: req !== null })

  const [questions, setQuestions] = useState<QuestionsResponse | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const ask = useCallback(() => askDiagnosisQuestions(req!), [req])
  const onAsked = useCallback((q: QuestionsResponse) => {
    setQuestions(q)
    setAnswers(q.questions.map(() => ''))
  }, [])
  const ai = useAiAction(ask, onAsked)

  // ③ 改善提案（回答と一緒に材料を送る。回答していない質問は送らない）
  const [proposals, setProposals] = useState<ProposalsResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const propose = useCallback(
    () => askDiagnosisProposals({ ...req!, answers: (questions?.questions ?? []).map((q, i) => ({ question: q.question, answer: answers[i] ?? '' })) }),
    [req, questions, answers],
  )
  const onProposed = useCallback((p: ProposalsResponse) => {
    setProposals(p)
    setDecisions({})
  }, [])
  const ai2 = useAiAction(propose, onProposed)
  // ④ 反映の計画（採用した提案から作る。提案や判断を変えたら作り直す）
  const [planning, setPlanning] = useState(false)
  const plan = useMemo(() => makePlan(proposals?.proposals ?? [], decisions), [proposals, decisions])
  const stage: DiagnosisStage = planning && proposals ? 'plan' : proposals ? 'proposals' : questions ? 'questions' : 'context'
  useEffect(() => onStage?.(stage), [stage, onStage])
  const error = ai.error ?? ai2.error
  const count = (k: Decision['status']) => Object.values(decisions).filter((d) => d.status === k).length
  const undecided = (proposals?.proposals.length ?? 0) - count('adopt') - count('hold') - count('reject')
  const build = (how: BuildChoice) =>
    onBuild(
      plan,
      how,
      makeRecord(
        (questions?.questions ?? []).map((q, i) => ({ question: q.question, answer: answers[i] ?? '' })),
        proposals?.proposals ?? [],
        decisions,
      ),
    )

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] space-y-4 px-6 py-6">
          <header>
            <p className="flex items-center gap-1.5 text-[0.85rem] font-bold text-mint">
              <Sparkles className="size-4" aria-hidden />
              AIで業務を改善する
            </p>
            <h1 className="mt-1 text-[1.6rem] leading-tight font-bold text-white">
              {stage === 'plan' ? '採用した改善を手順に反映する' : stage === 'proposals' ? 'AIの改善提案' : stage === 'questions' ? 'AIからの質問（回答は任意）' : 'AIに送る情報を確かめる'}
            </h1>
            <p className="mt-1 text-[0.92rem] text-subtle">
              {stage === 'plan'
                ? 'AIの提案から処理ステップを自動では組み立てません。手順の画面で、部品を確かめながら作ります。手順にできない改善は、人が行う作業として残ります。'
                : stage === 'proposals'
                ? '廃止→簡素化→標準化→自動化の順に検討した提案です（重要な順）。採用するかどうかは、あなたが決めます。根拠の「AIの推測」は、データで確かめていない内容です。'
                : stage === 'questions'
                  ? 'データだけでは分からない業務の背景を聞いています。分からない・答えたくない質問は、空欄のままで進めます。'
                  : '送るのは、次の内容だけです。AIはこの内容から、データだけでは分からないことを質問します（初回は3問まで）。'}
            </p>
          </header>

          {error && (
            <div className="space-y-2">
              <ErrorNotice error={error} />
              <Button variant="outlineDark" size="sm" onClick={onSkip}>
                AIを使わずに手順を作る
              </Button>
            </div>
          )}

          {stage === 'context' && (
            <>
              {context.isPending && (
                <p className="flex items-center gap-1.5 text-subtle">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  送る情報をまとめています…
                </p>
              )}
              {context.data && (
                <>
                  <section className="light-panel rounded-2xl px-5 py-4" aria-label="AIに送る情報">
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-bold">AIに送る情報</h2>
                      <span className="text-[0.82rem] text-muted">{context.data.chars.toLocaleString()}文字</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
                      {context.data.sections.map((s) => (
                        <ContextBlock key={s.key} title={s.title} lines={s.lines} />
                      ))}
                    </div>
                  </section>
                  {context.data.excluded.length > 0 && (
                    <section className="rounded-xl bg-panel px-4 py-3 ring-1 ring-edge" aria-label="送らない情報">
                      <h2 className="flex items-center gap-1.5 text-[0.92rem] font-bold text-white">
                        <EyeOff className="size-4 text-mint" aria-hidden />
                        送らない情報
                      </h2>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.85rem] text-subtle">
                        {context.data.excluded.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <section className="rounded-xl bg-warning/8 px-4 py-3 ring-1 ring-warning/30" aria-label="足りない情報">
                    <h2 className="flex items-center gap-1.5 text-[0.92rem] font-bold text-warning">
                      <Info className="size-4" aria-hidden />
                      足りない情報（AIには「ない」と伝えます）
                    </h2>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.85rem] text-white/80">
                      {context.data.missing.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </>
          )}

          {stage === 'questions' && questions && (
            <>
              <p className="rounded-xl bg-panel px-4 py-3 text-[0.92rem] text-white/85 ring-1 ring-edge" aria-label="AIが把握したこと">
                <span className="mr-2 font-bold text-mint">AIが把握したこと</span>
                {questions.understanding}
              </p>
              {questions.skipped > 0 && (
                <p className="flex items-start gap-1.5 rounded-xl bg-mint-soft/10 px-4 py-2.5 text-[0.88rem] text-white/85 ring-1 ring-mint/30" role="note" aria-label="前回の回答">
                  <Info className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
                  前回までの診断で答えた質問（{questions.skipped}問）は、もう一度聞きません。前回の回答は、AIに送る情報に入っています。
                </p>
              )}
              {questions.questions.length === 0 && (
                <p className="rounded-xl bg-panel px-4 py-3 text-[0.92rem] text-subtle ring-1 ring-edge">追加の質問はありません。このまま改善案を作れます。</p>
              )}
              <ol className="space-y-3" aria-label="AIからの質問">
                {questions.questions.map((q, i) => (
                  <li key={q.question} className="light-panel rounded-2xl px-5 py-4">
                    <p className="flex items-start gap-2 font-bold">
                      <CircleHelp className="mt-0.5 size-4.5 shrink-0 text-forest" aria-hidden />
                      質問{i + 1}：{q.question}
                    </p>
                    <p className="mt-1 pl-6.5 text-[0.85rem] text-muted">なぜ聞くか：{q.why}</p>
                    <textarea
                      value={answers[i] ?? ''}
                      onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                      rows={2}
                      maxLength={1000}
                      aria-label={`質問${i + 1}への回答`}
                      placeholder="任意。分からなければ空欄のままで進めます"
                      className="mt-2 ml-6.5 block w-[calc(100%-1.6rem)] rounded-lg bg-paper px-3 py-2 text-[0.92rem] ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                    />
                    {q.examples.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6.5 text-[0.8rem] text-muted">
                        回答の例：
                        {q.examples.map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => setAnswers(answers.map((a, j) => (j === i ? ex : a)))}
                            className="rounded-full bg-ink/6 px-2 py-0.5 text-ink/80 ring-1 ring-ink/10 hover:bg-mint-soft"
                          >
                            {ex}
                          </button>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}

          {stage === 'proposals' && proposals && (
            <>
              {proposals.note && (
                <p className="flex items-start gap-1.5 rounded-xl bg-panel px-4 py-3 text-[0.88rem] text-subtle ring-1 ring-edge" aria-label="AIからの断り書き">
                  <Info className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
                  {proposals.note}
                </p>
              )}
              {proposals.proposals.length ? (
                <ProposalList proposals={proposals.proposals} shownFirst={proposals.shown_first} decisions={decisions} onDecide={(id, d) => setDecisions({ ...decisions, [id]: d })} />
              ) : (
                <p className="rounded-xl bg-panel px-4 py-3 text-subtle ring-1 ring-edge">今の情報からは、改善提案はありませんでした。</p>
              )}
            </>
          )}

          {stage === 'plan' && <PlanView plan={plan} undecided={undecided} held={count('hold')} existing={existing} />}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-2.5">
        <Button
          variant="ghostDark"
          size="sm"
          onClick={stage === 'plan' ? () => setPlanning(false) : stage === 'proposals' ? () => setProposals(null) : stage === 'questions' ? () => setQuestions(null) : onBack}
          className="shrink-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {stage === 'plan'
            ? '改善提案に戻る'
            : stage === 'proposals'
              ? '質問に戻る'
              : stage === 'questions'
                ? '送る情報に戻る'
                : existing
                  ? '作業手順に戻る'
                  : '作業を伝える画面に戻る'}
        </Button>
        {stage !== 'plan' && !(existing && stage === 'context') && (
          <Button variant="ghostDark" size="sm" onClick={onSkip} className="shrink-0">
            {existing ? 'AIを使わずに作業手順に戻る' : 'AIを使わずに手順を作る'}
          </Button>
        )}
        {stage === 'plan' && plan.template && !existing && (
          <Button variant="ghostDark" size="sm" onClick={() => build({ kind: 'parts' })} disabled={building} className="shrink-0">
            ひな形を使わずに処理部品で作る
          </Button>
        )}
        {stage === 'proposals' && proposals && (
          <p className="min-w-0 flex-1 truncate text-[0.88rem] text-subtle" role="status" aria-label="判断の状況">
            採用{count('adopt')}・保留{count('hold')}・採用しない{count('reject')}・未判断{undecided}
          </p>
        )}
        <div className="ml-auto">
          {stage === 'plan' ? (
            <Button
              variant="primary"
              disabled={building}
              onClick={() =>
                build(existing ? { kind: 'return' } : plan.template ? { kind: 'template', templateId: plan.template.id } : plan.buildable.length ? { kind: 'parts' } : { kind: 'choose' })
              }
            >
              {building && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {building
                ? 'ひな形を読み込んでいます…'
                : existing
                  ? '判断を記録して作業手順に戻る'
                  : plan.template
                  ? `ひな形「${plan.template.title}」で手順を作る`
                  : plan.buildable.length
                    ? '処理部品を組み合わせて手順を作る'
                    : '手順の作り方を選ぶ'}
              {!building && <ArrowRight className="size-4" aria-hidden />}
            </Button>
          ) : stage === 'proposals' ? (
            <Button variant="primary" onClick={() => setPlanning(true)}>
              次へ：手順への反映を確かめる
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : stage === 'questions' ? (
            <Button variant="primary" onClick={ai2.run} disabled={ai2.busy}>
              {ai2.busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {ai2.busy ? 'AIが改善案を考えています…' : '回答して改善案を作る'}
            </Button>
          ) : (
            <Button variant="primary" onClick={ai.run} disabled={!context.data || ai.busy}>
              {ai.busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {ai.busy ? 'AIが質問を考えています…' : 'この内容でAIに質問を作ってもらう'}
            </Button>
          )}
        </div>
      </div>
      {ai.dialog}
      {ai2.dialog}
    </>
  )
}

/** ④ 反映の計画：手順に反映できるもの／人が行う作業として残るもの */
function PlanView({ plan, undecided, held, existing }: { plan: ImprovementPlan; undecided: number; held: number; existing: boolean }) {
  const others = [held && `保留${held}件`, undecided && `未判断${undecided}件`].filter(Boolean).join('・')
  if (!plan.adopted.length)
    return (
      <p className="rounded-xl bg-panel px-4 py-3 text-[0.92rem] text-subtle ring-1 ring-edge" aria-label="採用した改善">
        採用した提案はありません{others && `（${others}は反映しません）`}。{existing ? '判断は記録して、作業手順に戻ります。' : '手順の作り方を選んで進めます。'}
        採用する提案があれば「改善提案に戻る」で選び直してください。
      </p>
    )
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <PlanGroup
          icon={Wrench}
          title="手順に反映できるもの"
          empty="ありません（採用した改善は、すべて人が行う作業です）"
          items={plan.buildable}
          render={(a) => <BuildLine b={{ ...a.build, note: '' }} />}
        />
        <PlanGroup
          icon={Hand}
          title="人が行う作業として残るもの"
          empty="ありません（採用した改善は、すべて手順に反映できます）"
          items={plan.manual}
          render={(a) => <span className="text-[0.85rem] text-muted">{a.build.note || '手順の変更はありません（業務の進め方の見直しです）'}</span>}
        />
      </div>
      <ul className="space-y-1 rounded-xl bg-panel px-4 py-3 text-[0.88rem] text-subtle ring-1 ring-edge" aria-label="手順の作り方">
        <li>
          {existing
            ? '今の作業手順は、そのまま残します（ひな形で置き換えません）。採用した改善は、手順の画面で処理ステップや完了基準を直して反映します。'
            : plan.template
            ? `もとにするひな形：「${plan.template.title}」（反映できる提案で挙げられたひな形）。選んだ状態で手順の画面へ進みます。`
            : plan.buildable.length
              ? 'もとにできるひな形はありません。データを読み込んでから、処理部品を組み合わせて作ります。'
              : '手順に反映できる改善がないため、手順の作り方を選び直します。'}
        </li>
        <li>採用した改善は、手順の画面の上部に一覧で表示します（作りながら確かめられます）。</li>
        {others && <li>{others}の提案は反映しません。</li>}
        <li>回答と判断（理由を含む）は、作業手順に「改善の記録」として残します。次の診断では、同じことを聞きません（作業手順を保存すると残ります）。</li>
      </ul>
    </>
  )
}

function PlanGroup({
  icon: Icon,
  title,
  empty,
  items,
  render,
}: {
  icon: typeof Wrench
  title: string
  empty: string
  items: AdoptedImprovement[]
  render: (a: AdoptedImprovement) => ReactNode
}) {
  return (
    <section className="light-panel rounded-2xl px-5 py-4" aria-label={title}>
      <h2 className="flex items-center gap-1.5 font-bold">
        <Icon className="size-4.5 text-forest" aria-hidden />
        {title}
        <span className="text-[0.85rem] font-normal text-muted">{items.length}件</span>
      </h2>
      {items.length ? (
        <ul className="mt-2 space-y-2.5">
          {items.map((a) => (
            <li key={a.proposal_id} className="text-[0.9rem]">
              <p className="font-bold">{a.title}</p>
              <p className="text-ink/85">{a.change}</p>
              <div className="mt-0.5">{render(a)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[0.88rem] text-muted">{empty}</p>
      )}
    </section>
  )
}

/** 送る情報の1まとまり（長いときは先頭だけ見せ、残りは開いて見る） */
function ContextBlock({ title, lines }: { title: string; lines: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(0, LINES_SHOWN)
  return (
    <div className="min-w-0">
      <h3 className="text-[0.88rem] font-bold text-ink">{title}</h3>
      <ul className="mt-1 space-y-0.5 text-[0.84rem] text-ink/80">
        {shown.map((l) => (
          <li key={l} className="break-words">
            {l}
          </li>
        ))}
      </ul>
      {lines.length > LINES_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[0.8rem] font-bold text-forest hover:underline">
          {all ? '閉じる' : `すべて表示（ほか${lines.length - LINES_SHOWN}行）`}
        </button>
      )}
    </div>
  )
}
