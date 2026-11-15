import { CircleCheck, ClipboardList, Hand, Target, TriangleAlert } from 'lucide-react'
import type { DemoStart } from '../../../api/demos'
import { DemoFrame } from './DemoFrame'

/** デモ STEP 1「作業を知る」：何をする業務か・どこに課題があるか（30秒で分かる量に） */
export function DemoIntro({ demo, onNext }: { demo: DemoStart; onNext: () => void }) {
  const st = demo.story
  const ng = demo.pattern === 'ng'
  return (
    <DemoFrame next={{ label: '次へ：作業手順を見る', onClick: onNext }}>
      <header>
        <p className="inline-flex items-center rounded-full bg-white/6 px-2.5 py-0.5 text-[0.8rem] text-subtle ring-1 ring-white/15">
          架空の業務シナリオ（デモ用の架空データ）
        </p>
        <h1 className="mt-3 text-[2rem] leading-tight font-bold text-white">{st?.business_name ?? demo.title}</h1>
        {st && (
          <p className="mt-2 flex items-start gap-2 text-[1.02rem] text-white/85">
            <Target className="mt-1 size-4.5 shrink-0 text-mint" aria-hidden />
            {st.purpose}
          </p>
        )}
      </header>
      {st ? (
        <div className="grid grid-cols-2 gap-5">
          <section aria-labelledby="demo-current" className="rounded-2xl bg-panel p-5 ring-1 ring-edge">
            <h2 id="demo-current" className="flex items-center gap-2 font-bold text-white">
              <ClipboardList className="size-5 text-subtle" aria-hidden />
              今の作業（手作業）
            </h2>
            <ol className="mt-3 space-y-2 text-[0.93rem] text-white/85">
              {st.current_work.map((w, i) => (
                <li key={w} className="flex gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-panel-hi text-[0.78rem] text-subtle ring-1 ring-edge">{i + 1}</span>
                  <span className="flex items-start gap-1.5">
                    <Hand className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                    {w}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="demo-issues" className="rounded-2xl border-l-4 border-l-kaizen bg-panel p-5 ring-1 ring-edge">
            <h2 id="demo-issues" className="flex items-center gap-2 font-bold text-white">
              <TriangleAlert className="size-5 text-kaizen" aria-hidden />
              困っていること
            </h2>
            <ul className="mt-3 space-y-2 text-[0.93rem] text-white/85">
              {st.issues.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-kaizen" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="text-subtle">このデモの業務の説明を読み込めませんでした（サーバーが古い版の可能性があります）。</p>
      )}
      <section aria-label="今回の体験" className={`flex items-start gap-3 rounded-2xl p-4 ring-1 ${ng ? 'bg-kaizen/10 ring-kaizen/40' : 'bg-mint/8 ring-mint/35'}`}>
        {ng ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-kaizen" aria-hidden /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-mint" aria-hidden />}
        <p className="text-[0.93rem] text-white/90">
          <span className={`font-bold ${ng ? 'text-kaizen-text' : 'text-mint'}`}>今回の体験：{demo.pattern_label}</span>
          <span className="ml-2">{demo.description}</span>
        </p>
      </section>
    </DemoFrame>
  )
}
