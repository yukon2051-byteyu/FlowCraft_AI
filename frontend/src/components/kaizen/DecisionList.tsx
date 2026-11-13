import { CircleHelp, Lightbulb, TriangleAlert } from 'lucide-react'
import type { Candidate, Scenario } from '../../api/kaizen'
import {
  CONFIRM_LABEL,
  REASON_MAX,
  REASONS,
  STATUS_DONE_LABEL,
  STATUS_LABEL,
  adoptBlocker,
  answerConfirm,
  counts,
  decide,
  problems,
  setReason,
} from '../../kaizen/decisions'
import type { ConfirmAnswer, Decisions, DecisionStatus } from '../../kaizen/decisions'

const STATUSES: DecisionStatus[] = ['adopt', 'hold', 'reject']
const ANSWERS: ConfirmAnswer[] = ['none', 'exists', 'unknown']

/** STEP 3：利用者が、改善候補ごとに 採用する／保留する／採用しない を選ぶ（理由も選べる） */
export function DecisionList({
  candidates,
  scenario,
  decisions,
  onChange,
}: {
  candidates: Candidate[]
  scenario: Scenario
  decisions: Decisions
  onChange: (ds: Decisions) => void
}) {
  const stepNo = new Map(scenario.steps.map((s, i) => [s.step_id, i + 1]))
  const n = counts(candidates, decisions)
  const issues = problems(candidates, decisions)
  return (
    <div className="space-y-4">
      <p className="text-[0.92rem] text-subtle">
        改善候補は提案です。採用するかどうかは、あなたが決めます。採用した候補だけが、次のSTEPで作る作業手順に反映されます。
      </p>
      <ol className="space-y-4" aria-label="改善候補の判断">
        {candidates.map((c) => {
          const d = decisions[c.candidate_id]
          const blocker = adoptBlocker(c, decisions)
          const groupId = `kz-dec-${c.candidate_id}`
          return (
            <li key={c.candidate_id}>
              <fieldset aria-labelledby={groupId} className="rounded-2xl border border-edge border-l-4 border-l-kaizen bg-panel p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Lightbulb className="size-5 text-kaizen" aria-hidden />
                  <span className="rounded-full px-2 py-0.5 text-[0.78rem] font-bold text-kaizen-text ring-1 ring-kaizen/50">{c.direction_label}</span>
                  <h3 id={groupId} className="text-[1.02rem] font-bold text-white">
                    候補{c.candidate_id}：{c.title}
                  </h3>
                  <span className="text-[0.82rem] text-subtle">対象：工程{c.target_steps.map((s) => stepNo.get(s)).join('・')}</span>
                </div>

                {c.confirm_question && (
                  <div className="mt-3 rounded-xl bg-warning-soft px-3.5 py-3 text-[0.9rem] text-ink [color-scheme:light]">
                    <p id={`${groupId}-q`} className="flex gap-2 font-bold text-warning-ink">
                      <CircleHelp className="mt-0.5 size-4.5 shrink-0" aria-hidden />
                      確認：{c.confirm_question}
                    </p>
                    <div role="radiogroup" aria-labelledby={`${groupId}-q`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 pl-6.5">
                      {ANSWERS.map((a) => (
                        <label key={a} className="inline-flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name={`${groupId}-confirm`}
                            checked={d.confirm === a}
                            onChange={() => onChange(answerConfirm(c, decisions, a))}
                            className="size-4 accent-forest"
                          />
                          {CONFIRM_LABEL[a]}
                        </label>
                      ))}
                    </div>
                    {d.confirm === 'exists' && <p className="mt-2 pl-6.5 text-[0.85rem]">要件がある場合は、「採用しない」を選び、理由を残してください。</p>}
                    {d.confirm === 'unknown' && <p className="mt-2 pl-6.5 text-[0.85rem]">分からない場合は、「保留する」を選び、関係者に確かめてから判断してください。</p>}
                  </div>
                )}

                <div role="radiogroup" aria-label={`候補${c.candidate_id}の判断`} className="mt-4 flex flex-wrap gap-2">
                  {STATUSES.map((s) => {
                    const disabled = s === 'adopt' && blocker !== null && d.status !== 'adopt'
                    const on = d.status === s
                    return (
                      <label
                        key={s}
                        title={disabled ? (blocker ?? undefined) : undefined}
                        className={
                          'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[0.92rem] font-bold ring-1 ring-inset transition-colors ' +
                          (disabled
                            ? 'cursor-not-allowed text-subtle/50 ring-edge'
                            : on
                              ? s === 'adopt'
                                ? 'cursor-pointer bg-mint text-on-mint ring-mint'
                                : 'cursor-pointer bg-white text-ink ring-white'
                              : 'cursor-pointer text-white ring-white/25 hover:bg-white/8') +
                          ' has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-mint'
                        }
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${groupId}-status`}
                          checked={on}
                          disabled={disabled}
                          onChange={() => onChange(decide(c, decisions, s))}
                        />
                        {STATUS_LABEL[s]}
                      </label>
                    )
                  })}
                  {blocker && d.status !== 'adopt' && <span className="self-center text-[0.84rem] text-subtle">採用するには：{blocker}</span>}
                </div>

                {d.status && (
                  <div className="mt-3">
                    <label htmlFor={`${groupId}-reason`} className="text-[0.85rem] text-subtle">
                      判断の理由（任意・{REASON_MAX}文字まで）
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {REASONS[d.status].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => onChange(setReason(c.candidate_id, decisions, r))}
                          aria-pressed={d.reason === r}
                          className={
                            'rounded-full px-3 py-1 text-[0.82rem] ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-mint ' +
                            (d.reason === r ? 'bg-panel-hi text-white ring-white/60' : 'text-subtle ring-edge hover:text-white')
                          }
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <input
                      id={`${groupId}-reason`}
                      value={d.reason}
                      maxLength={REASON_MAX}
                      onChange={(e) => onChange(setReason(c.candidate_id, decisions, e.target.value))}
                      placeholder="選択肢から選ぶか、短く書いてください"
                      className="mt-2 h-10 w-full max-w-xl rounded-lg border border-edge bg-canvas px-3 text-[0.9rem] text-white placeholder:text-subtle/60 focus-visible:outline-2 focus-visible:outline-mint"
                    />
                  </div>
                )}
              </fieldset>
            </li>
          )
        })}
      </ol>

      <section aria-label="判断の集計" className="rounded-2xl border border-edge bg-panel-hi p-4 text-[0.92rem]">
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-white">
          {(['adopt', 'hold', 'reject', 'none'] as const).map((k) => (
            <span key={k}>
              {STATUS_DONE_LABEL[k]}：<span className="font-bold">{n[k]}件</span>
            </span>
          ))}
        </p>
        {issues.length > 0 && (
          <ul className="mt-2 space-y-1 text-warning">
            {issues.map((x) => (
              <li key={x} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
