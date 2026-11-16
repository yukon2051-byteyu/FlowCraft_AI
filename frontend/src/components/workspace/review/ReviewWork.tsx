import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleCheck, Info, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ACTION_LABEL, ACTION_ORDER, MAX_STEPS, moveStep, newReview, newStep, removeStep, reviewProblems, totalMinutes } from '../../../kaizen/review'
import type { ReviewStepDraft, WorkAction, WorkReviewDraft } from '../../../kaizen/review'
import { useFlowStore } from '../../../flow/store'
import { Button } from '../../ui/Button'

/*
 * 自分の業務の見直し（Phase K-1b）：業務の情報と、今の作業の工程の表を入力する。
 * 「やりたい作業を伝える」の②で「今の工程から見直す」を選んだときだけ開く（通常の流れには割り込まない）。
 * 入力した内容は状態管理（review）に残し、画面を移っても消えない。
 */

const inputCls = 'h-8 w-full rounded-md bg-paper px-2 text-[0.88rem] ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none'

export function ReviewWork({ purpose, onBack, onNext }: { purpose: string; onBack: () => void; onNext?: () => void }) {
  const stored = useFlowStore((s) => s.review)
  const setReview = useFlowStore((s) => s.setReview)
  const r: WorkReviewDraft = stored ?? newReview(purpose)
  const set = (patch: Partial<WorkReviewDraft>) => setReview({ ...r, ...patch })
  const setSteps = (steps: ReviewStepDraft[]) => set({ steps })
  const setStep = (id: string, patch: Partial<ReviewStepDraft>) => setSteps(r.steps.map((s) => (s.step_id === id ? { ...s, ...patch } : s)))

  // 入力の誤りは、次へ進もうとした後だけ示す（入力の途中から赤くしない）
  const [tried, setTried] = useState(false)
  const problems = reviewProblems(r)
  const shown = tried ? problems : []
  const rowProblems = (id: string) => shown.filter((p) => p.stepId === id).map((p) => p.message)
  const tableRef = useRef<HTMLElement>(null)
  const total = totalMinutes(r)
  // 改善候補の画面（K-1c）をつなぐまでは、入力に問題がないことだけを示す
  const [checked, setChecked] = useState(false)

  const next = () => {
    if (problems.length) {
      setTried(true)
      const first = problems[0].stepId
      const el = first ? document.getElementById(`review-row-${first}`) : tableRef.current
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      ;(el?.querySelector('input, select') as HTMLElement | null)?.focus({ preventScroll: true })
      return
    }
    setTried(false)
    if (onNext) onNext()
    else setChecked(true)
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] space-y-4 px-6 py-5">
          <section className="light-panel rounded-2xl p-6" aria-label="業務の情報">
            <p className="text-[0.85rem] font-bold text-forest">今の工程から見直す</p>
            <h1 className="mt-0.5 text-[1.5rem] leading-tight font-bold">今の作業を書き出す</h1>
            <p className="mt-1 text-[0.92rem] text-ink/80">今の作業を1行に1工程ずつ入力すると、決まった規則で改善候補を示します（AIは使いません）。業務の情報はすべて任意です。</p>
            <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
              <Labeled label="業務の目的" className="col-span-3">
                <input value={r.purpose} onChange={(e) => set({ purpose: e.target.value })} maxLength={500} aria-label="業務の目的" placeholder="例：支店の経費を毎月まとめ、役員会に報告する" className={inputCls} />
              </Labeled>
              <Labeled label="実施頻度">
                <input value={r.frequency} onChange={(e) => set({ frequency: e.target.value })} maxLength={100} aria-label="実施頻度" placeholder="例：毎月" className={inputCls} />
              </Labeled>
              <Labeled label="成果物を使う人" className="col-span-2">
                <input value={r.users} onChange={(e) => set({ users: e.target.value })} maxLength={200} aria-label="成果物を使う人" placeholder="例：経理部長・役員会" className={inputCls} />
              </Labeled>
              <Labeled label="困っていること（1行に1つ）" className="col-span-2">
                <textarea value={r.pain_points} onChange={(e) => set({ pain_points: e.target.value })} rows={2} aria-label="困っていること" placeholder="例：同じ数値を何度も書き写している" className={`${inputCls} h-auto py-1.5`} />
              </Labeled>
              <Labeled label="必ず残すこと（1行に1つ）">
                <textarea value={r.must_keep} onChange={(e) => set({ must_keep: e.target.value })} rows={2} aria-label="必ず残すこと" placeholder="例：経理部長の承認" className={`${inputCls} h-auto py-1.5`} />
              </Labeled>
            </div>
          </section>

          <section ref={tableRef} className="light-panel scroll-mt-4 rounded-2xl p-6" aria-label="今の工程">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[1.15rem] font-bold">今の工程</h2>
              <p className="text-[0.85rem] text-muted">上から作業の順に入力してください（{r.steps.length}／{MAX_STEPS}工程）</p>
              <p className="ml-auto text-[0.85rem] text-muted" aria-label="所要時間の合計">
                {total === null ? '時間をすべての工程に入れると、合計を表示します' : `合計 ${total.toLocaleString()}分（想定値。くり返しを含む）`}
              </p>
            </div>
            <table className="mt-3 w-full table-fixed text-[0.85rem]">
              <colgroup>
                <col className="w-9" />
                <col />
                <col className="w-[13rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[4.8rem]" />
                <col className="w-[4.8rem]" />
                <col className="w-[7rem]" />
                <col className="w-[10rem]" />
                <col className="w-[3.6rem]" />
                <col className="w-[6.4rem]" />
              </colgroup>
              <thead className="text-left text-[0.78rem] text-muted">
                <tr>
                  <th className="pb-1.5 font-bold">No</th>
                  <th className="pb-1.5 font-bold">工程名</th>
                  <th className="pb-1.5 font-bold">作業の種類</th>
                  <th className="pb-1.5 font-bold">手作業・自動</th>
                  <th className="pb-1.5 font-bold" title="1回の所要時間（任意）。想定値として扱います">時間（分）</th>
                  <th className="pb-1.5 font-bold" title="部署ごとなど、同じ作業を何回くり返しているか">くり返し</th>
                  <th className="pb-1.5 font-bold" title="前の工程の結果を書き写しているとき、その工程">書き写し元</th>
                  <th className="pb-1.5 font-bold" title="書き写した先の資料・ファイルの名前">書き写し先</th>
                  <th className="pb-1.5 font-bold" title="承認・監査など、なくせない工程">必ず残す</th>
                  <th className="pb-1.5 font-bold">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.steps.map((s, i) => (
                  <StepRow
                    key={s.step_id}
                    s={s}
                    index={i}
                    steps={r.steps}
                    problems={rowProblems(s.step_id)}
                    onChange={(patch) => setStep(s.step_id, patch)}
                    onMove={(to) => setSteps(moveStep(r.steps, i, to))}
                    onRemove={() => setSteps(removeStep(r.steps, s.step_id))}
                  />
                ))}
              </tbody>
            </table>
            {shown.some((p) => p.stepId === null) && (
              <p className="mt-2 text-[0.85rem] font-bold text-error-ink" role="alert">
                {shown.find((p) => p.stepId === null)!.message}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={r.steps.length >= MAX_STEPS} onClick={() => setSteps([...r.steps, newStep(r.steps)])}>
                <Plus className="size-4" aria-hidden />
                工程を追加
              </Button>
              <p className="flex items-start gap-1.5 text-[0.8rem] text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                工程名の言葉ではなく、作業の種類・書き写し元・くり返しの回数で判定します。部署ごとに列名がそろっているかは、部署のExcelを読み込むと調べられます（今後対応）。
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-2.5">
        <Button variant="ghostDark" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="size-4" aria-hidden />
          作業を伝える画面に戻る
        </Button>
        <p className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-[0.88rem] ${shown.length ? 'font-bold text-warning' : 'text-subtle'}`} role="status" aria-label="入力の状態">
          {shown.length ? <TriangleAlert className="size-4 shrink-0" aria-hidden /> : <CircleCheck className="size-4 shrink-0" aria-hidden />}
          {shown.length
            ? `入力を直してください（${shown.length}件）`
            : checked && !problems.length
              ? '入力に問題はありません（改善候補の表示は準備中です）'
              : `${r.steps.length}工程を入力しています。入力した内容は、画面を移っても残ります`}
        </p>
        <Button variant="primary" onClick={next} className="shrink-0">
          改善候補を見る
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </>
  )
}

function Labeled({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[0.8rem] font-bold text-muted">{label}</span>
      {children}
    </label>
  )
}

function StepRow({
  s,
  index,
  steps,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  s: ReviewStepDraft
  index: number
  steps: ReviewStepDraft[]
  problems: string[]
  onChange: (patch: Partial<ReviewStepDraft>) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const n = index + 1
  const bad = problems.length > 0
  const cell = 'py-1 pr-1.5 align-top'
  return (
    <>
      <tr id={`review-row-${s.step_id}`} className={`scroll-mt-4 border-t border-line ${bad ? 'bg-error-soft/60' : ''}`} aria-label={`工程${n}`}>
        <td className={`${cell} pt-2.5 font-bold text-muted`}>{n}</td>
        <td className={cell}>
          <input value={s.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={200} aria-label={`工程${n}の工程名`} placeholder="例：支店の経費Excelを受け取る" className={inputCls} />
        </td>
        <td className={cell}>
          <select value={s.action} onChange={(e) => onChange({ action: e.target.value as WorkAction })} aria-label={`工程${n}の作業の種類`} className={inputCls}>
            {ACTION_ORDER.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </td>
        <td className={cell}>
          <select value={s.mode} onChange={(e) => onChange({ mode: e.target.value as 'manual' | 'auto' })} aria-label={`工程${n}の手作業・自動`} className={inputCls}>
            <option value="manual">手作業</option>
            <option value="auto">自動</option>
          </select>
        </td>
        <td className={cell}>
          <input value={s.minutes} onChange={(e) => onChange({ minutes: e.target.value })} inputMode="numeric" aria-label={`工程${n}の時間（分）`} placeholder="任意" className={inputCls} />
        </td>
        <td className={cell}>
          <input
            type="number"
            min={1}
            max={50}
            value={s.repeat_count}
            onChange={(e) => onChange({ repeat_count: Number(e.target.value) })}
            aria-label={`工程${n}のくり返しの回数`}
            className={inputCls}
          />
        </td>
        <td className={cell}>
          <select value={s.transcribes_from} onChange={(e) => onChange({ transcribes_from: e.target.value })} aria-label={`工程${n}の書き写し元`} className={inputCls}>
            <option value="">なし</option>
            {/* 書き写し元は、それより前の工程だけ */}
            {steps.slice(0, index).map((x, i) => (
              <option key={x.step_id} value={x.step_id}>
                工程{i + 1}
              </option>
            ))}
            {s.transcribes_from && steps.findIndex((x) => x.step_id === s.transcribes_from) >= index && <option value={s.transcribes_from}>（後ろの工程）</option>}
          </select>
        </td>
        <td className={cell}>
          <input
            value={s.deliverable}
            onChange={(e) => onChange({ deliverable: e.target.value })}
            maxLength={200}
            disabled={!s.transcribes_from}
            aria-label={`工程${n}の書き写し先`}
            placeholder={s.transcribes_from ? '例：役員会資料' : '—'}
            className={`${inputCls} disabled:bg-ink/4 disabled:text-muted`}
          />
        </td>
        <td className={`${cell} pt-2 text-center`}>
          <input type="checkbox" checked={s.must_keep} onChange={(e) => onChange({ must_keep: e.target.checked })} aria-label={`工程${n}を必ず残す`} className="size-4 accent-[#135f50]" />
        </td>
        <td className={`${cell} whitespace-nowrap`}>
          <RowButton label={`工程${n}を上へ移動`} disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUp className="size-4" />
          </RowButton>
          <RowButton label={`工程${n}を下へ移動`} disabled={index === steps.length - 1} onClick={() => onMove(index + 1)}>
            <ArrowDown className="size-4" />
          </RowButton>
          <RowButton label={`工程${n}を削除`} disabled={steps.length === 1} onClick={onRemove}>
            <Trash2 className="size-4" />
          </RowButton>
        </td>
      </tr>
      {bad && (
        <tr className="bg-error-soft/60">
          <td />
          <td colSpan={9} className="pb-1.5">
            {problems.map((p) => (
              <p key={p} role="alert" className="text-[0.82rem] font-bold text-error-ink">
                {p}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}

function RowButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-grid size-7 place-items-center rounded-md text-muted hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}
