import { CircleHelp, FileSpreadsheet, Lightbulb, ListChecks, ShieldCheck, Workflow } from 'lucide-react'
import type { Candidate, Diagnosis, Evidence, Scenario } from '../../api/kaizen'

const SOURCE_LABEL: Record<Evidence['source'], string> = { step: '工程', context: '業務情報', file: 'Excel' }
const SOURCE_ICON: Record<Evidence['source'], typeof Workflow> = { step: Workflow, context: ListChecks, file: FileSpreadsheet }

/** STEP 2：改善候補（決まった規則で検出）と、その根拠 */
/** status：候補ごとの判断の状態の表示（STEP 3 で判断したあとに戻ってきたとき） */
export function CandidateList({ diagnosis, scenario, status }: { diagnosis: Diagnosis; scenario: Scenario; status: Record<string, string> }) {
  const stepName = new Map(scenario.steps.map((s, i) => [s.step_id, `工程${i + 1}「${s.name}」`]))
  return (
    <div className="space-y-5">
      <p className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-[0.85rem] text-subtle ring-1 ring-edge">
        <ListChecks className="size-4 text-white" aria-hidden />
        <span>
          診断の方法：<span className="font-bold text-white">{diagnosis.method}</span>
        </span>
      </p>
      <ol className="space-y-4" aria-label="改善候補">
        {diagnosis.candidates.map((c) => (
          <li key={c.candidate_id}>
            <CandidateCard c={c} stepName={stepName} status={status[c.candidate_id] ?? '未判断'} />
          </li>
        ))}
      </ol>
      {diagnosis.kept.length > 0 && (
        <section aria-labelledby="kz-kept" className="rounded-2xl border border-mint-line bg-mint-deep p-4">
          <h3 id="kz-kept" className="flex items-center gap-1.5 text-[0.95rem] font-bold text-mint-title">
            <ShieldCheck className="size-4.5" aria-hidden />
            見直しの対象にしない工程
          </h3>
          <ul className="mt-1.5 space-y-1 text-[0.88rem] text-mint-body">
            {diagnosis.kept.map((k) => (
              <li key={k.step_id}>
                {stepName.get(k.step_id)}：{k.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CandidateCard({ c, stepName, status }: { c: Candidate; stepName: Map<string, string>; status: string }) {
  const titleId = `kz-cand-${c.candidate_id}`
  return (
    <article aria-labelledby={titleId} className="rounded-2xl border border-edge border-l-4 border-l-kaizen bg-panel p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Lightbulb className="size-5 text-kaizen" aria-hidden />
        <span className="rounded-full px-2 py-0.5 text-[0.78rem] font-bold text-kaizen-text ring-1 ring-kaizen/50">改善候補・{c.direction_label}</span>
        <h3 id={titleId} className="text-[1.05rem] font-bold text-white">
          候補{c.candidate_id}：{c.title}
        </h3>
        <span className="ml-auto rounded-full bg-panel-hi px-2.5 py-0.5 text-[0.78rem] text-subtle ring-1 ring-edge" aria-label={`判断の状態：${status}`}>
          {status}
        </span>
      </header>
      <dl className="mt-3 grid gap-x-5 gap-y-3 text-[0.9rem] grid-cols-[8rem_1fr]">
        <dt className="text-subtle">改善内容</dt>
        <dd className="text-white">{c.detail}</dd>

        <dt className="text-subtle">対象工程</dt>
        <dd className="flex flex-wrap gap-1.5">
          {c.target_steps.map((s) => (
            <span key={s} className="rounded-md bg-panel-hi px-2 py-0.5 text-[0.85rem] text-white ring-1 ring-edge">
              {stepName.get(s)}
            </span>
          ))}
        </dd>

        <dt className="text-subtle">判断の根拠</dt>
        <dd>
          <ul className="space-y-1">
            {c.evidence.map((e, i) => {
              const Icon = SOURCE_ICON[e.source]
              return (
                <li key={i} className="flex gap-2 text-white">
                  <span className="inline-flex h-fit shrink-0 items-center gap-1 rounded bg-panel-hi px-1.5 py-0.5 text-[0.74rem] text-subtle">
                    <Icon className="size-3" aria-hidden />
                    {SOURCE_LABEL[e.source]}
                  </span>
                  <span>{e.text}</span>
                </li>
              )
            })}
          </ul>
        </dd>

        <dt className="text-subtle">想定効果</dt>
        <dd className="text-white">
          {c.effect}
          <span className="ml-1 text-[0.8rem] text-subtle">（想定。実測ではありません）</span>
        </dd>

        <dt className="text-subtle">実施前の確認事項</dt>
        <dd>
          <ul className="list-disc space-y-0.5 pl-5 text-white marker:text-subtle">
            {c.checks.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </dd>
      </dl>
      {c.confirm_question && (
        <p className="mt-4 flex gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[0.9rem] text-ink">
          <CircleHelp className="mt-0.5 size-4.5 shrink-0 text-warning-ink" aria-hidden />
          <span>
            <span className="font-bold text-warning-ink">採用する前に確認が必要です：</span>
            {c.confirm_question}
            <span className="block text-[0.82rem] text-ink/75">廃止は提案です。確認なしに採用されることはありません。</span>
          </span>
        </p>
      )}
      {c.depends_on.length > 0 && <p className="mt-3 text-[0.85rem] text-subtle">前提になる候補：候補{c.depends_on.join('・候補')}</p>}
    </article>
  )
}
