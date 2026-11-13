import { Bot, CircleSlash, Hand, ListChecks, ShieldCheck, UserCheck, Workflow } from 'lucide-react'
import type { Improvement, Scenario } from '../../api/kaizen'

const MODE: Record<Improvement['after_steps'][number]['mode'], { label: string; icon: typeof Bot; tone: string }> = {
  auto: { label: '自動', icon: Bot, tone: 'text-mint' },
  mixed: { label: '自動＋人', icon: UserCheck, tone: 'text-mint' },
  manual: { label: '手作業', icon: Hand, tone: 'text-white' },
}

const STATUS_TONE = { adopt: 'text-mint', hold: 'text-warning', reject: 'text-subtle' } as const

type FlowNodeLike = { node_id: string; node_name: string }
type CriterionLike = { criterion_id: string; name: string; kind: string; on_fail: string }

/** STEP 4：判断から作った、改善後の作業の流れと、実行できる作業手順 */
export function AfterProcedure({ data, scenario }: { data: Improvement; scenario: Scenario }) {
  const stepNo = new Map(scenario.steps.map((s, i) => [s.step_id, i + 1]))
  const nodes = ((data.flow?.nodes as FlowNodeLike[] | undefined) ?? []).map((n, i) => ({ ...n, no: i + 1 }))
  const nodeNo = new Map(nodes.map((n) => [n.node_id, n.no]))
  const criteria = ((data.flow?.completion_criteria as { items?: CriterionLike[] } | undefined)?.items ?? []) as CriterionLike[]

  return (
    <div className="space-y-6">
      <section aria-labelledby="kz-changes" className="rounded-2xl border border-edge bg-panel p-5">
        <h2 id="kz-changes" className="text-[1rem] font-bold text-white">
          あなたの判断の反映<span className="ml-2 text-[0.8rem] font-normal text-subtle">採用した候補だけを反映しています（AIは使っていません）</span>
        </h2>
        <ul className="mt-3 space-y-1.5 text-[0.92rem]">
          {data.changes.map((c) => (
            <li key={c.candidate_id} className={STATUS_TONE[c.status]}>
              {c.text}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kz-after" className="rounded-2xl border border-mint-line bg-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kz-after" className="text-[1.1rem] font-bold text-white">
            改善後の作業の流れ
          </h2>
          <p className="text-[0.9rem] text-subtle">
            {scenario.steps.length}工程・{data.minutes_before}分 →{' '}
            <span className="font-bold text-white">
              {data.after_steps.length}工程・{data.minutes_after}分
            </span>
            （想定）
          </p>
        </div>
        <ol className="mt-4 space-y-2.5" aria-label="改善後の工程">
          {data.after_steps.map((s, i) => {
            const m = MODE[s.mode]
            return (
              <li key={s.name} className="grid grid-cols-[2rem_minmax(0,1fr)_7rem_4.5rem] items-start gap-3 rounded-xl bg-panel-hi px-4 py-3 ring-1 ring-edge">
                <span className="grid size-7 place-items-center rounded-full bg-mint/15 text-[0.82rem] font-bold text-mint">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-bold text-white">{s.name}</p>
                  <p className="mt-0.5 text-[0.82rem] text-subtle">
                    もとの工程：{s.from_steps.map((x) => `工程${stepNo.get(x)}`).join('・')}
                    {s.node_ids.length > 0 && <> ／ 処理ステップ：{s.node_ids.map((n) => nodeNo.get(n)).join('・')}</>}
                    {s.changed_by.length > 0 && <> ／ 反映した候補：{s.changed_by.join('・')}</>}
                  </p>
                  {s.criteria.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {s.criteria.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded bg-mint/10 px-1.5 py-0.5 text-[0.78rem] text-mint ring-1 ring-mint/30">
                          <ShieldCheck className="size-3" aria-hidden />
                          {c}
                        </span>
                      ))}
                    </p>
                  )}
                  {s.note && <p className="mt-1 text-[0.85rem] text-subtle">{s.note}</p>}
                </div>
                <span className={`inline-flex items-center gap-1 text-[0.88rem] ${m.tone}`}>
                  <m.icon className="size-4" aria-hidden />
                  {m.label}
                </span>
                <span className="text-right text-[0.9rem] text-white">{s.minutes}分</span>
              </li>
            )
          })}
        </ol>
        <p className="mt-3 text-[0.82rem] text-subtle">
          ※ 所要時間はすべて想定値です（実測ではありません）。自動の処理そのものは0分とし、ファイルの指定と実行・結果の確認・共有など、人が行う部分の時間だけを数えています。
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="kz-flow" className="rounded-2xl border border-edge bg-panel p-5">
          <h2 id="kz-flow" className="flex items-center gap-1.5 text-[1rem] font-bold text-white">
            <Workflow className="size-4.5 text-mint" aria-hidden />
            作成した作業手順の処理ステップ
          </h2>
          <p className="mt-1 text-[0.85rem] text-subtle">{data.flow_note}</p>
          {data.flow ? (
            <>
              <p className="mt-3 text-[0.9rem] text-white">
                作業手順の名前：<span className="font-bold">{String(data.flow.flow_name)}</span>（新しい作業手順・版1）
              </p>
              <ol className="mt-2 space-y-1 text-[0.9rem]" aria-label="処理ステップ">
                {nodes.map((n) => (
                  <li key={n.node_id} className="flex gap-2 text-white">
                    <span className="w-6 shrink-0 text-right text-subtle tabular-nums">{n.no}.</span>
                    {n.node_name}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-[0.9rem] text-subtle">
              <CircleSlash className="size-4" aria-hidden />
              実行できる作業手順はありません
            </p>
          )}
        </section>
        <section aria-labelledby="kz-rules" className="rounded-2xl border border-edge bg-panel p-5">
          <h2 id="kz-rules" className="flex items-center gap-1.5 text-[1rem] font-bold text-white">
            <ListChecks className="size-4.5 text-mint" aria-hidden />
            引き継ぐ品質の確認
          </h2>
          <ul className="mt-2 space-y-1 text-[0.9rem]">
            {data.kept_rules.map((r) => (
              <li key={r} className="flex items-center gap-1.5 text-mint">
                <ShieldCheck className="size-4" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          {criteria.length > 0 && (
            <>
              <p className="mt-3 text-[0.85rem] text-subtle">作業手順の完了基準（実行のたびに自動で確かめます）</p>
              <ul className="mt-1 space-y-1 text-[0.9rem]" aria-label="完了基準">
                {criteria.map((c) => (
                  <li key={c.criterion_id} className="flex flex-wrap items-center gap-2 text-white">
                    {c.name}
                    <span className={`rounded px-1.5 text-[0.75rem] ring-1 ${c.on_fail === 'critical' ? 'text-kaizen-text ring-kaizen/50' : 'text-warning ring-warning/50'}`}>
                      満たさないとき：{c.on_fail === 'critical' ? '重大（出力を止める）' : '注意'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.unsupported.length > 0 && (
            <>
              <p className="mt-4 text-[0.85rem] font-bold text-white">処理エンジンでは行えないため、手作業のまま残る工程</p>
              <ul className="mt-1 space-y-0.5 text-[0.88rem] text-subtle">
                {data.unsupported.map((u) => (
                  <li key={u}>未対応：{u}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
