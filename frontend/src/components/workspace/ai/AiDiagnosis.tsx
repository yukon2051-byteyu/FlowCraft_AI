import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CircleHelp, EyeOff, Info, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { askDiagnosisQuestions, buildDiagnosisContext } from '../../../api/ai'
import type { ContextRequest, QuestionsResponse } from '../../../api/ai'
import { listFiles } from '../../../api/files'
import { useFlowStore } from '../../../flow/store'
import { useAiAction } from '../../ai/useAiAction'
import { Button } from '../../ui/Button'
import { ErrorNotice } from '../../ui/ErrorNotice'

/*
 * AI業務改善診断（A-3）：① AIに送る情報を確かめる → ② AIからの質問に答える（任意） → （A-4 で改善案）
 * - 送る情報は、今ある情報からサーバーが組み立てる（同じ内容を再入力させない）。送る前に、そのまま見せる
 * - 質問は初回3問まで。データからは分からない業務の背景だけ。各質問に「なぜ聞くか」。回答は任意
 * - AIを使えないとき（設定なし・上限・応答を確かめられない）は理由を示し、AIを使わずに手順を作る道を示す（簡易診断へ切り替えない）
 */

const LINES_SHOWN = 8

export function AiDiagnosis({ name, purpose, onBack, onSkip }: { name: string; purpose: string; onBack: () => void; onSkip: () => void }) {
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
      flow: flow.nodes.length || flow.completion_criteria.items.length ? flow : null,
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
  const [submitted, setSubmitted] = useState(false)

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] space-y-4 px-6 py-6">
          <header>
            <p className="flex items-center gap-1.5 text-[0.85rem] font-bold text-mint">
              <Sparkles className="size-4" aria-hidden />
              AIで業務を改善する
            </p>
            <h1 className="mt-1 text-[1.6rem] leading-tight font-bold text-white">{questions ? 'AIからの質問（回答は任意）' : 'AIに送る情報を確かめる'}</h1>
            <p className="mt-1 text-[0.92rem] text-subtle">
              {questions
                ? 'データだけでは分からない業務の背景を聞いています。分からない・答えたくない質問は、空欄のままで進めます。'
                : '送るのは、次の内容だけです。AIはこの内容から、データだけでは分からないことを質問します（初回は3問まで）。'}
            </p>
          </header>

          {ai.error && (
            <div className="space-y-2">
              <ErrorNotice error={ai.error} />
              <Button variant="outlineDark" size="sm" onClick={onSkip}>
                AIを使わずに手順を作る
              </Button>
            </div>
          )}

          {!questions && (
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

          {questions && (
            <>
              <p className="rounded-xl bg-panel px-4 py-3 text-[0.92rem] text-white/85 ring-1 ring-edge" aria-label="AIが把握したこと">
                <span className="mr-2 font-bold text-mint">AIが把握したこと</span>
                {questions.understanding}
              </p>
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
              {submitted && (
                <p role="status" className="flex items-center gap-1.5 rounded-xl bg-warning/8 px-4 py-3 text-[0.9rem] text-warning ring-1 ring-warning/30">
                  <TriangleAlert className="size-4" aria-hidden />
                  回答を受け取りました。改善案の作成は、次の段階（A-4）で作ります（準備中）。
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-2.5">
        <Button variant="ghostDark" size="sm" onClick={questions ? () => setQuestions(null) : onBack} className="shrink-0">
          <ArrowLeft className="size-4" aria-hidden />
          {questions ? '送る情報に戻る' : '作業を伝える画面に戻る'}
        </Button>
        <Button variant="ghostDark" size="sm" onClick={onSkip} className="shrink-0">
          AIを使わずに手順を作る
        </Button>
        <div className="ml-auto">
          {questions ? (
            <Button variant="primary" onClick={() => setSubmitted(true)}>
              回答して改善案を作る
              <ArrowRight className="size-4" aria-hidden />
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
    </>
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
