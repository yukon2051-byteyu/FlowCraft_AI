import { CircleCheck, ClipboardList, Target, TriangleAlert } from 'lucide-react'
import type { DemoStart } from '../../../api/demos'
import { DemoFrame } from './DemoFrame'

/**
 * デモ STEP 1「作業を知る」（30秒で「何が問題で、何を改善できるか」が分かる量に）。すべてのデモで同じ構成：
 *   ① デモ名・業務の目的 → ② 今の作業（手作業）と困っていること（横2列） → ③ このデモで体験できること（帯） → 次へ
 * 中身はデモごとの設定（backend/app/demos/catalog.py の story・experience）から作る。体験できることは正常・異常で変わる
 */
export function DemoIntro({ demo, onNext }: { demo: DemoStart; onNext: () => void }) {
  const st = demo.story
  const ng = demo.pattern === 'ng'
  return (
    <DemoFrame next={{ label: '次へ：作業手順と改善案を見る', onClick: onNext }}>
      {/* ① デモ名・業務の目的 */}
      <header>
        <p className="flex flex-wrap items-center gap-2 text-[0.85rem]">
          <span className="font-bold text-mint">{demo.title}</span>
          <span className="rounded-full bg-white/6 px-2.5 py-0.5 text-subtle ring-1 ring-white/15">架空の業務シナリオ（デモ用の架空データ）</span>
        </p>
        <h1 className="mt-2 text-[2rem] leading-tight font-bold text-white">{st?.business_name ?? demo.title}</h1>
        {st && (
          <p className="mt-2 flex items-start gap-2 text-[1.02rem] leading-relaxed text-white/85">
            <Target className="mt-1 size-4.5 shrink-0 text-mint" aria-hidden />
            {st.purpose}
          </p>
        )}
      </header>

      {/* ② 今の作業と困っていること（PCでは横2列。高さは中身に合わせ、余白でそろえない） */}
      {st ? (
        <div className="grid grid-cols-2 items-start gap-5">
          <section aria-labelledby="demo-current" className="rounded-2xl bg-panel px-5 py-4 ring-1 ring-edge">
            <h2 id="demo-current" className="flex items-center gap-2 font-bold text-white">
              <ClipboardList className="size-5 text-subtle" aria-hidden />
              今の作業（手作業）
            </h2>
            <ol className="mt-3 space-y-2 text-[0.95rem] leading-relaxed text-white/85">
              {st.current_work.map((w, i) => (
                <li key={w} className="flex gap-2.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-panel-hi text-[0.78rem] text-subtle ring-1 ring-edge">{i + 1}</span>
                  <span>{w}</span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="demo-issues" className="rounded-2xl border-l-4 border-l-kaizen bg-panel px-5 py-4 ring-1 ring-edge">
            <h2 id="demo-issues" className="flex items-center gap-2 font-bold text-white">
              <TriangleAlert className="size-5 text-kaizen" aria-hidden />
              困っていること
            </h2>
            <ul className="mt-3 space-y-2 text-[0.95rem] leading-relaxed text-white/85">
              {st.issues.map((x) => (
                <li key={x} className="flex gap-2.5">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-kaizen" aria-hidden />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="text-subtle">このデモの業務の説明を読み込めませんでした（サーバーが古い版の可能性があります）。</p>
      )}

      {/* ③ このデモで体験できること（帯。大きなカードにしない）。正常・異常で内容が変わる */}
      <section aria-label="このデモで体験できること" className={`flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ${ng ? 'bg-kaizen/10 ring-kaizen/40' : 'bg-mint/8 ring-mint/35'}`}>
        {ng ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-kaizen" aria-hidden /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-mint" aria-hidden />}
        <div className="min-w-0 text-[0.93rem] leading-relaxed">
          <p className="text-white/90">
            <span className={`mr-2 font-bold ${ng ? 'text-kaizen-text' : 'text-mint'}`}>このデモで体験できること</span>
            {demo.experience || demo.description}
          </p>
          <p className="mt-0.5 text-[0.86rem] text-subtle">
            今回のデータ（{ng ? '品質異常' : '正常'}）：{demo.description}
          </p>
        </div>
      </section>
    </DemoFrame>
  )
}
