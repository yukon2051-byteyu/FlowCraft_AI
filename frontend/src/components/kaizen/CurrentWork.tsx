import { Bot, FileSpreadsheet, Hand, ShieldCheck } from 'lucide-react'
import type { ScenarioResponse } from '../../api/kaizen'

/** STEP 1：現在の作業（7工程）と、業務の背景（デモ用に入力済み）、受け取るExcel */
export function CurrentWork({ data }: { data: ScenarioResponse }) {
  const { scenario: sc, total_minutes: total, files } = data
  const deliverable = new Map(sc.deliverables.map((d) => [d.deliverable_id, d.name]))
  const ctx = sc.context
  const contextRows: [string, string][] = [
    ['業務の目的', ctx.purpose],
    ['実施頻度', ctx.frequency],
    ['所要時間', `${ctx.minutes_per_run}分（想定）`],
    ['利用者', ctx.users],
    ['成果物', ctx.deliverables.join('・')],
    ['困っていること', ctx.pain_points.join('・')],
    ['品質上の懸念', ctx.quality_concerns.join('・')],
    ['必ず残すこと', ctx.must_keep.join('・')],
    ['廃止できるか不明なこと', ctx.unsure_to_remove.join('・')],
  ]
  return (
    <div className="space-y-6">
      <section aria-labelledby="kz-steps" className="rounded-2xl border border-edge bg-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kz-steps" className="text-[1.1rem] font-bold text-white">
            {sc.business_name}：現在の作業手順
          </h2>
          <p className="text-[0.9rem] text-subtle">
            {sc.steps.length}工程・合計 <span className="font-bold text-white">{total}分</span>（想定）
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[0.9rem]" aria-label="現在の作業の工程">
            <thead>
              <tr className="border-b border-edge text-[0.8rem] text-subtle">
                <th scope="col" className="py-2 pr-3 font-normal">工程</th>
                <th scope="col" className="py-2 pr-3 font-normal">作業内容</th>
                <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">想定時間</th>
                <th scope="col" className="py-2 pr-3 font-normal">手作業／自動</th>
                <th scope="col" className="py-2 pr-3 font-normal">成果物</th>
                <th scope="col" className="py-2 font-normal">関連する品質ルール</th>
              </tr>
            </thead>
            <tbody>
              {sc.steps.map((s, i) => (
                <tr key={s.step_id} className="border-b border-edge/60 align-top last:border-0">
                  <th scope="row" className="py-3 pr-3 font-bold text-white">
                    <span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-panel-hi text-[0.78rem] text-subtle ring-1 ring-edge">{i + 1}</span>
                    {s.name}
                  </th>
                  <td className="max-w-[18rem] py-3 pr-3 text-subtle">{s.detail}</td>
                  <td className="py-3 pr-3 whitespace-nowrap text-white">
                    {s.minutes}分
                    <span className="mt-1.5 block h-1.5 rounded-full bg-kaizen/70" style={{ width: `${Math.max(4, (s.minutes / total) * 160)}px` }} aria-hidden />
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {s.mode === 'manual' ? (
                      <span className="inline-flex items-center gap-1 text-white">
                        <Hand className="size-4 text-subtle" aria-hidden />
                        手作業
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-mint">
                        <Bot className="size-4" aria-hidden />
                        自動
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-subtle">{s.deliverable ? deliverable.get(s.deliverable) : '—'}</td>
                  <td className="py-3 text-subtle">
                    {s.quality_rules.length ? (
                      <ul className="space-y-0.5">
                        {s.quality_rules.map((r) => (
                          <li key={r} className="flex gap-1">
                            <ShieldCheck className={`mt-0.5 size-3.5 shrink-0 ${s.must_keep ? 'text-mint' : 'text-subtle'}`} aria-hidden />
                            {r}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[0.82rem] text-subtle">※ {sc.time_note}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="kz-context" className="rounded-2xl border border-edge bg-panel p-5">
          <h2 id="kz-context" className="text-[1rem] font-bold text-white">
            業務の背景<span className="ml-2 text-[0.8rem] font-normal text-subtle">デモ用に入力済み</span>
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.88rem]">
            {contextRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-subtle">{k}</dt>
                <dd className="text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="kz-files" className="rounded-2xl border border-edge bg-panel p-5">
          <h2 id="kz-files" className="text-[1rem] font-bold text-white">
            受け取るExcel<span className="ml-2 text-[0.8rem] font-normal text-subtle">架空のデータ・{sc.period.replace('-', '年')}月分</span>
          </h2>
          <ul className="mt-3 space-y-3 text-[0.88rem]">
            {files.map((f) => (
              <li key={f.filename}>
                <p className="flex items-center gap-1.5 text-white">
                  <FileSpreadsheet className="size-4 text-mint" aria-hidden />
                  {f.department}：{f.filename}
                  <span className="text-subtle">（{f.rows}件）</span>
                </p>
                <p className="mt-0.5 pl-5.5 text-subtle">列：{f.columns.join('／')}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
