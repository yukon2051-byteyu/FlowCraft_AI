import { ArrowRight, Info, ShieldCheck, Workflow } from 'lucide-react'
import type { DemoStart } from '../../../api/demos'
import { useFlowStore } from '../../../flow/store'
import { DemoFrame } from './DemoFrame'
import { isRuleStep, refLabel } from './refs'

/**
 * デモ STEP 2「手順と改善を確認」（見せ場）：改善前 → 改善後の比較と、改善後の処理手順。
 * 改善例は事前に用意したもの（AIがその場で作ったものではない）。
 * 改善後の手順は、このあと実際に実行する作業手順の処理ステップ・品質ルールと対応づけて示す（説明だけが先走らない）。
 */
export function DemoImprove({ demo, onBack, onNext }: { demo: DemoStart; onBack: () => void; onNext: () => void }) {
  const flow = useFlowStore((s) => s.flow)
  const st = demo.story
  const nodes = flow.nodes
  const criteria = flow.completion_criteria?.items ?? []
  return (
    <DemoFrame back={{ label: '前へ：作業を知る', onClick: onBack }} next={{ label: '次へ：使用するデータを見る', onClick: onNext }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.85rem] font-bold text-mint">{st?.business_name ?? demo.title}</p>
          <h1 className="mt-1 text-[1.6rem] font-bold text-white">手作業を、確かめられる作業手順に変える</h1>
        </div>
        <p className="flex items-center gap-1.5 rounded-full bg-white/6 px-3 py-1 text-[0.82rem] text-subtle ring-1 ring-white/15">
          <Info className="size-3.5" aria-hidden />
          事前に用意した改善例です（AIの提案ではありません）
        </p>
      </header>

      {st && (
        <section aria-labelledby="demo-compare" className="rounded-2xl bg-panel p-5 ring-1 ring-edge">
          <h2 id="demo-compare" className="font-bold text-white">
            改善前と改善後
          </h2>
          <table className="mt-3 w-full border-collapse text-left text-[0.93rem]" aria-label="改善前と改善後">
            <thead>
              <tr className="border-b border-edge text-[0.8rem] text-subtle">
                <th scope="col" className="w-[27%] py-2 pr-3 font-normal">
                  改善前（今の作業）
                </th>
                <th scope="col" className="w-8 py-2">
                  <span className="sr-only">変化</span>
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  改善後（この作業手順）
                </th>
                <th scope="col" className="w-[30%] py-2 font-normal">
                  実現している処理
                </th>
              </tr>
            </thead>
            <tbody>
              {st.improvements.map((x) => (
                <tr key={x.before} className="border-b border-edge/60 align-top last:border-0">
                  <td className="py-3 pr-3 text-white/65">{x.before}</td>
                  <td className="py-3 text-mint">
                    <ArrowRight className="mt-0.5 size-4" aria-hidden />
                  </td>
                  <td className="py-3 pr-3 font-bold text-white">{x.after}</td>
                  <td className="py-3">
                    <ul className="space-y-0.5 text-[0.83rem] text-subtle">
                      {x.refs.map((r) => (
                        <li key={r}>{refLabel(r, nodes, criteria)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {st && (
        <section aria-labelledby="demo-steps" className="rounded-2xl border border-mint-line bg-panel p-5">
          <h2 id="demo-steps" className="flex flex-wrap items-center gap-x-2 font-bold text-white">
            <Workflow className="size-5 text-mint" aria-hidden />
            改善後の処理手順
            <span className="text-[0.82rem] font-normal text-subtle">（「実行・品質確認」で、この作業手順を実際に実行します）</span>
          </h2>
          <ol className="mt-3 grid grid-cols-3 gap-3" aria-label="改善後の処理手順">
            {st.steps.map((s, i) => {
              const rule = isRuleStep(s.refs, criteria)
              return (
                <li key={s.label} className={`rounded-xl p-3.5 ring-1 ${rule ? 'bg-mint/8 ring-mint/40' : 'bg-panel-hi ring-edge'}`}>
                  <p className="flex items-start gap-2 font-bold text-white">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mint text-[0.78rem] text-on-mint">{i + 1}</span>
                    {s.label}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-[0.8rem] text-subtle">
                    {s.refs.map((r) => (
                      <li key={r} className="flex items-start gap-1">
                        {rule && <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-mint" aria-hidden />}
                        {refLabel(r, nodes, criteria)}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </DemoFrame>
  )
}
