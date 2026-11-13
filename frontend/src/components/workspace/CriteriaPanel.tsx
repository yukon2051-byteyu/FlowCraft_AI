import { CircleAlert, CircleCheck, ClipboardList, History, LayoutTemplate, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import {
  applyTemplate,
  columnsOf,
  CRITERION_KINDS,
  criterionProblems,
  describeCriterion,
  diffCriteria,
  isParamRef,
  KIND_ORDER,
  newCriterion,
  ON_FAIL_LABEL,
  refChoices,
  STANDARD_CHECKS,
  TEMPLATES,
} from '../../flow/criteria'
import { OPERATOR_LABEL, operatorsFor } from '../../flow/params'
import type { FilterOperator } from '../../flow/params'
import { useFlowStore } from '../../flow/store'
import type { Criterion, CriterionKind, FlowDoc, RunParameter } from '../../flow/types'
import { Button } from '../ui/Button'
import { ColumnChecks, ColumnSelect, Field, inputCls } from './StepSettings'

/*
 * タスク2-4：完了基準の設定（「何を満たせば完了？」）。処理ステップ（何をする？）とは別の欄。
 * 左：基準の一覧・テンプレート・自動で行う確認 ／ 右：選んだ基準の設定
 * 種類は決まった一覧から選ぶ。テンプレートで推し当てられなかった対象・値は空のまま残し、不足として示す。
 */

const ON_FAIL_STYLE: Record<Criterion['on_fail'], string> = {
  critical: 'bg-error-soft text-error-ink ring-error/40',
  caution: 'bg-warning-soft text-warning-ink ring-warning/40',
  record: 'bg-ink/6 text-muted ring-ink/15',
}
const ON_FAIL_SHORT: Record<Criterion['on_fail'], string> = {
  critical: '重大',
  caution: '注意',
  record: '記録のみ',
}

export function CriteriaPanel() {
  const flow = useFlowStore((s) => s.flow)
  const setCriteria = useFlowStore((s) => s.setCriteria)
  const items = flow.completion_criteria.items
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.criterion_id ?? null)
  const [menu, setMenu] = useState<'none' | 'kind' | 'template'>('none')
  const selected = items.find((c) => c.criterion_id === selectedId) ?? null
  const paramLabel = (id: string) => flow.run_parameters.find((p) => p.param_id === id)?.label ?? id

  const add = (kind: CriterionKind) => {
    const c = newCriterion(flow, kind)
    setCriteria([...items, c])
    setSelectedId(c.criterion_id)
    setMenu('none')
  }
  const addTemplate = (id: (typeof TEMPLATES)[number]['id']) => {
    const t = applyTemplate(flow, id)
    setCriteria([...items, ...t.items], t.parameters)
    setSelectedId(t.items[0]?.criterion_id ?? selectedId)
    setMenu('none')
  }
  const update = (c: Criterion, addParameters?: RunParameter[]) =>
    setCriteria(
      items.map((x) => (x.criterion_id === c.criterion_id ? c : x)),
      addParameters,
    )
  const remove = (id: string) => {
    setCriteria(items.filter((x) => x.criterion_id !== id))
    setSelectedId(null)
  }

  return (
    <div className="mx-auto grid max-w-[1400px] items-start gap-6 px-6 pb-6 lg:grid-cols-[minmax(0,1fr)_27rem]">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-[1.5rem] font-bold text-white">何を満たせば完了？（完了基準）</h1>
          <p className="mt-1 max-w-3xl text-subtle">
            処理がエラーなく終わっても、業務として正しく完了したとは限りません。結果が満たすべき条件を決めておくと、実行のたびにプログラムで確かめ、正常・注意・重大・未検証で判定します。
            簡単な単発の作業なら、決めなくても実行できます。
          </p>
        </div>

        <CriteriaHistory />

        <div className="flex flex-wrap gap-2">
          <Button variant="outlineDark" size="sm" onClick={() => setMenu(menu === 'template' ? 'none' : 'template')}>
            <LayoutTemplate className="size-4" aria-hidden />
            テンプレートから追加
          </Button>
          <Button variant="outlineDark" size="sm" onClick={() => setMenu(menu === 'kind' ? 'none' : 'kind')}>
            <Plus className="size-4" aria-hidden />
            基準を追加
          </Button>
        </div>

        {menu === 'template' && (
          <section className="light-panel rounded-2xl p-4" aria-label="テンプレートを選ぶ">
            <p className="text-[0.85rem] text-muted">作業手順の中身から、対象の列などを推し当てて追加します。推し当てられなかった項目は、空のまま残すので設定してください。</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => addTemplate(t.id)} className="h-full w-full rounded-xl bg-paper px-3 py-2.5 text-left ring-1 ring-line hover:ring-forest/50">
                    <span className="block font-bold">{t.name}</span>
                    <span className="mt-0.5 block text-[0.8rem] text-muted">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {menu === 'kind' && (
          <section className="light-panel rounded-2xl p-4" aria-label="追加する基準を選ぶ">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {KIND_ORDER.map((k) => (
                <li key={k}>
                  <button type="button" onClick={() => add(k)} className="w-full rounded-lg bg-paper px-3 py-2 text-left ring-1 ring-line hover:ring-forest/50">
                    <span className="block text-[0.92rem] font-bold">{CRITERION_KINDS[k].label}</span>
                    <span className="block text-[0.78rem] text-muted">{CRITERION_KINDS[k].help}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-edge px-5 py-6 text-subtle">
            まだ完了基準はありません。この場合は「標準の確認」（下）だけで判定し、結果に「業務の完了基準は設定されていません」と表示します。
          </p>
        ) : (
          <ol className="space-y-2" aria-label="完了基準">
            {items.map((c) => {
              const problems = criterionProblems(c, flow)
              return (
                <li key={c.criterion_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.criterion_id)}
                    aria-label={`完了基準：${c.name}`}
                    className={`light-panel w-full rounded-2xl px-4 py-3 text-left ${c.criterion_id === selectedId ? 'ring-2 ring-mint' : ''}`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-ink">{c.name}</span>
                      {c.name !== CRITERION_KINDS[c.kind].label && <span className="text-[0.8rem] text-muted">{CRITERION_KINDS[c.kind].label}</span>}
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[0.75rem] font-bold ring-1 ring-inset ${ON_FAIL_STYLE[c.on_fail]}`}>{ON_FAIL_SHORT[c.on_fail]}</span>
                    </span>
                    <span className="mt-1 block text-[0.85rem] text-ink/80">{describeCriterion(c, flow, paramLabel)}</span>
                    {c.confirmation_status === 'pending' ? (
                      <span className="mt-1 flex items-center gap-1 text-[0.82rem] text-warning-ink">
                        <CircleAlert className="size-3.5" aria-hidden />
                        未確認：写したルールです。内容を確かめてください
                      </span>
                    ) : problems.length > 0 ? (
                      <span className="mt-1 flex items-center gap-1 text-[0.82rem] text-warning-ink">
                        <CircleAlert className="size-3.5" aria-hidden />
                        設定が必要：{problems[0]}
                        {problems.length > 1 ? ` ほか${problems.length - 1}件` : ''}
                      </span>
                    ) : (
                      <span className="mt-1 flex items-center gap-1 text-[0.82rem] text-success-ink">
                        <CircleCheck className="size-3.5" aria-hidden />
                        設定済み
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        )}

        <section className="rounded-2xl bg-panel px-5 py-4 ring-1 ring-edge" aria-label="自動で行う確認">
          <h2 className="flex items-center gap-2 font-bold text-white">
            <ListChecks className="size-4.5 text-mint" aria-hidden />
            自動で行う確認（標準の確認・設定は不要）
          </h2>
          <ul className="mt-2 grid list-disc gap-x-6 gap-y-0.5 pl-5 text-[0.88rem] text-subtle sm:grid-cols-2">
            {STANDARD_CHECKS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:rounded-2xl">
        {selected ? (
          <CriterionEditor key={selected.criterion_id} c={selected} onChange={update} onRemove={() => remove(selected.criterion_id)} />
        ) : (
          <p className="rounded-2xl bg-panel px-6 py-10 text-center text-subtle ring-1 ring-edge">完了基準を選ぶと、ここで設定できます。</p>
        )}
      </div>
    </div>
  )
}

/* ---------- 完了基準の版と変更の記録（タスク2-6） ---------- */

function CriteriaHistory() {
  const cc = useFlowStore((s) => s.flow.completion_criteria)
  const savedSnapshot = useFlowStore((s) => s.savedSnapshot)
  // 前の保存から変えた内容（保存すると、版を上げてこの要約が記録される）
  const pending = savedSnapshot === null ? [] : diffCriteria((JSON.parse(savedSnapshot) as FlowDoc).completion_criteria?.items ?? [], cc.items)
  const recent = [...cc.changelog].reverse().slice(0, 3)
  if (!recent.length && !pending.length) return null
  return (
    <section className="rounded-2xl bg-panel px-5 py-3 ring-1 ring-edge" aria-label="完了基準の変更の記録">
      <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-bold text-white">
        <History className="size-4 text-mint" aria-hidden />
        完了基準の版 {cc.version}
        {pending.length > 0 && <span className="text-[0.8rem] font-normal text-warning">（保存していない変更があります。保存すると版{cc.version + 1}として記録します）</span>}
      </p>
      {pending.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-[0.82rem] text-warning" aria-label="保存していない変更">
          {pending.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[0.82rem] text-subtle" aria-label="これまでの変更">
          {recent.map((c) => (
            <li key={`${c.version}-${c.changed_at}`}>
              版{c.version}（{new Date(c.changed_at).toLocaleString('ja-JP')}）：{c.summary}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------- 1つの基準の設定 ---------- */

function CriterionEditor({ c, onChange, onRemove }: { c: Criterion; onChange: (c: Criterion, add?: RunParameter[]) => void; onRemove: () => void }) {
  const flow = useFlowStore((s) => s.flow)
  const info = CRITERION_KINDS[c.kind]
  const p = (c.params ?? {}) as Record<string, unknown>
  const setP = (patch: Record<string, unknown>, add?: RunParameter[]) => {
    const next = { ...p, ...patch }
    // 空の値は書かない（サーバーの決まりでは、空の値は「形の誤り」になるため）
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] === undefined) delete next[k]
    onChange({ ...c, params: next }, add)
  }
  const cols = c.target.ref ? columnsOf(flow, c.target.ref) : []
  const problems = criterionProblems(c, flow)
  const needsColumn = info.column === 'required' || (info.column === 'sum_only' && p.measure !== 'count')
  const allowTypes =
    c.kind === 'period'
      ? (['date'] as const)
      : c.kind === 'value_range'
        ? (['integer', 'decimal', 'date'] as const)
        : c.kind === 'total_match' || c.kind === 'expected_value'
          ? (['integer', 'decimal'] as const)
          : undefined

  return (
    <section className="light-panel rounded-2xl" aria-label={`完了基準「${c.name}」の設定`}>
      <div className="flex items-start gap-2 border-b border-line px-5 pt-4 pb-3">
        <ClipboardList className="mt-1 size-5 text-forest" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8rem] text-muted">{info.label}</p>
          <p className="text-[0.82rem] text-muted">{info.help}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="この基準を削除"
          title="この基準を削除"
          className="rounded-full p-1.5 text-muted hover:bg-error-soft hover:text-error-ink"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">
        {/* ひな形・複製から写したルール：対象の列・期間・基準値を確かめるまで、評価では未検証（重大なら正式な出力を止める） */}
        {c.confirmation_status === 'pending' && (
          <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-[0.85rem] text-warning-ink ring-1 ring-warning/40" role="note" aria-label="未確認のルール">
            <p>
              ひな形・複製から写したルールです。<b>確かめる対象・列・期間・基準値</b>が今回の業務に合っているかを確かめてください。確認するまで、このルールは「未検証」として扱います（重大のルールなら正式な出力を止めます）。
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...c, confirmation_status: 'confirmed' })}
              disabled={problems.length > 0}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-forest px-3 text-[0.85rem] font-bold text-white hover:bg-[#0f4f43] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CircleCheck className="size-4" aria-hidden />
              内容を確かめた（確認済みにする）
            </button>
          </div>
        )}
        <Field label="基準の名前">
          <input value={c.name} maxLength={100} onChange={(e) => onChange({ ...c, name: e.target.value })} aria-label="基準の名前" className={`${inputCls} w-full`} />
        </Field>

        <Field label={info.target === 'input' ? '確かめるファイル（入力）' : info.target === 'join' ? '確かめる照合のステップ' : '確かめる結果'}>
          <select
            value={c.target.ref}
            onChange={(e) => onChange({ ...c, target: { ref: e.target.value, column: null } })}
            aria-label="確かめる対象"
            className={`${inputCls} w-full`}
          >
            <option value="">（選ぶ）</option>
            {refChoices(flow, c.kind).map((r) => (
              <option key={r.ref} value={r.ref}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {needsColumn && (
          <Field label="確かめる列">
            <div className="flex">
              <ColumnSelect
                value={c.target.column ?? ''}
                cols={cols}
                allow={allowTypes ? [...allowTypes] : undefined}
                onChange={(v) => onChange({ ...c, target: { ...c.target, column: v || null } })}
                label="確かめる列"
              />
            </div>
          </Field>
        )}

        <KindForm c={c} p={p} setP={setP} cols={cols} />

        <Field label="満たさないとき">
          <div className="space-y-1" role="radiogroup" aria-label="満たさないとき">
            {(c.kind === 'list_rows' ? (['record'] as const) : (['critical', 'caution', 'record'] as const)).map((o) => (
              <label key={o} className="flex items-center gap-2 text-[0.9rem]">
                <input
                  type="radio"
                  name={`onfail-${c.criterion_id}`}
                  checked={c.on_fail === o}
                  onChange={() => onChange({ ...c, on_fail: o })}
                  className="size-4 accent-[#135f50]"
                />
                {ON_FAIL_LABEL[o]}
              </label>
            ))}
          </div>
        </Field>

        <Field label="メモ（任意）">
          <textarea
            value={c.note ?? ''}
            maxLength={500}
            rows={2}
            onChange={(e) => onChange({ ...c, note: e.target.value })}
            aria-label="メモ"
            className="w-full rounded-lg bg-card px-2 py-1.5 text-[0.9rem] ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
          />
        </Field>

        {problems.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-warning-soft px-3 py-2 text-[0.85rem] text-warning-ink ring-1 ring-warning/40" aria-label="設定が必要なこと">
            {problems.map((x) => (
              <li key={x}>・{x}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

type FormProps = {
  c: Criterion
  p: Record<string, unknown>
  setP: (patch: Record<string, unknown>, add?: RunParameter[]) => void
  cols: ReturnType<typeof columnsOf>
}

function KindForm({ c, p, setP, cols }: FormProps) {
  const flow = useFlowStore((s) => s.flow)
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v)) || 0))
  switch (c.kind) {
    case 'required_columns':
      return (
        <Field label="確かめる列（何も選ばなければ、「必ずある列」すべて）">
          <ColumnChecks picked={(p.columns as string[]) ?? []} cols={cols} set={(columns) => setP({ columns })} label={(n) => `「${n}」を確かめる`} />
        </Field>
      )
    case 'no_blank':
    case 'all_matched':
      return (
        <Field label="許容件数">
          <input
            type="number"
            min={0}
            value={String(p.max_count ?? 0)}
            onChange={(e) => setP({ max_count: num(e.target.value) ?? 0 })}
            aria-label="許容件数"
            className={`${inputCls} w-28`}
          />
        </Field>
      )
    case 'unique':
      return (
        <Field label="重複を確かめる列（組み合わせ）">
          <ColumnChecks picked={(p.columns as string[]) ?? []} cols={cols} set={(columns) => setP({ columns })} label={(n) => `「${n}」で重複を確かめる`} />
        </Field>
      )
    case 'value_range':
      return (
        <div className="grid grid-cols-2 gap-3">
          <ValueInput c={c} field="min" label="最小" paramLabel="最小の値" paramType="decimal" value={p.min} setP={setP} />
          <ValueInput c={c} field="max" label="最大" paramLabel="最大の値" paramType="decimal" value={p.max} setP={setP} />
        </div>
      )
    case 'period': {
      const byMonth = 'month' in p || (!('start' in p) && !('end' in p))
      return (
        <div className="space-y-3">
          <div className="flex gap-4 text-[0.9rem]" role="radiogroup" aria-label="期間の決め方">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={byMonth} onChange={() => setP({ start: undefined, end: undefined, month: null })} className="size-4 accent-[#135f50]" />
              対象の月
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!byMonth} onChange={() => setP({ month: undefined, start: null, end: null })} className="size-4 accent-[#135f50]" />
              開始日・終了日
            </label>
          </div>
          {byMonth ? (
            <ValueInput c={c} field="month" label="対象の月（例 2026-10）" paramLabel="対象月" paramType="month" value={p.month} setP={setP} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <ValueInput c={c} field="start" label="開始日（例 2026-10-01）" paramLabel="開始日" paramType="date" value={p.start} setP={setP} />
              <ValueInput c={c} field="end" label="終了日" paramLabel="終了日" paramType="date" value={p.end} setP={setP} />
            </div>
          )}
        </div>
      )
    }
    case 'total_match': {
      const compareCols = p.compare_ref ? columnsOf(flow, String(p.compare_ref)) : []
      return (
        <div className="space-y-3">
          <Field label="比べる相手の結果">
            <select
              value={String(p.compare_ref ?? '')}
              onChange={(e) => setP({ compare_ref: e.target.value, compare_column: '' })}
              aria-label="比べる相手の結果"
              className={`${inputCls} w-full`}
            >
              <option value="">（選ぶ）</option>
              {refChoices(flow, 'total_match').map((r) => (
                <option key={r.ref} value={r.ref}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="比べる相手の列">
            <div className="flex">
              <ColumnSelect
                value={String(p.compare_column ?? '')}
                cols={compareCols}
                allow={['integer', 'decimal']}
                onChange={(v) => setP({ compare_column: v })}
                label="比べる相手の列"
              />
            </div>
          </Field>
          <Field label="許容差">
            <input value={String(p.tolerance ?? '0')} onChange={(e) => setP({ tolerance: e.target.value })} aria-label="許容差" className={`${inputCls} w-28`} />
          </Field>
        </div>
      )
    }
    case 'row_count':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="最小（件）">
            <input
              type="number"
              min={0}
              value={p.min == null ? '' : String(p.min)}
              onChange={(e) => setP({ min: num(e.target.value) })}
              aria-label="最小の件数"
              className={`${inputCls} w-full`}
            />
          </Field>
          <Field label="最大（件）">
            <input
              type="number"
              min={0}
              value={p.max == null ? '' : String(p.max)}
              onChange={(e) => setP({ max: num(e.target.value) })}
              aria-label="最大の件数"
              className={`${inputCls} w-full`}
            />
          </Field>
        </div>
      )
    case 'expected_value':
      return (
        <div className="space-y-3">
          <Field label="確かめる値">
            <div className="flex gap-4 text-[0.9rem]" role="radiogroup" aria-label="確かめる値">
              {(['sum', 'count'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="radio" checked={(p.measure ?? 'sum') === m} onChange={() => setP({ measure: m })} className="size-4 accent-[#135f50]" />
                  {m === 'sum' ? '列の合計' : '件数'}
                </label>
              ))}
            </div>
          </Field>
          <ValueInput c={c} field="value" label="確認用の値（別の資料の値）" paramLabel="確認用の値" paramType="decimal" value={p.value} setP={setP} />
          <Field label="許容差">
            <input value={String(p.tolerance ?? '0')} onChange={(e) => setP({ tolerance: e.target.value })} aria-label="許容差" className={`${inputCls} w-28`} />
          </Field>
        </div>
      )
    case 'list_rows': {
      const cond = (p.condition ?? {
        kind: 'condition',
        column: '',
        operator: 'eq',
        value: '',
      }) as {
        kind: 'condition'
        column: string
        operator: FilterOperator
        value: string | null
      }
      const type = cols.find((x) => x.name === cond.column)?.type ?? 'string'
      const noValue = cond.operator === 'is_empty' || cond.operator === 'is_not_empty'
      const setCond = (patch: Partial<typeof cond>) => {
        const next = { ...cond, ...patch }
        if (next.operator === 'is_empty' || next.operator === 'is_not_empty') next.value = null
        setP({ condition: next })
      }
      return (
        <Field label="一覧にする行の条件">
          <div className="space-y-1.5">
            <div className="flex">
              <ColumnSelect value={cond.column} cols={cols} onChange={(v) => setCond({ column: v })} label="条件の列" />
            </div>
            <div className="flex gap-1.5">
              {!noValue && <input value={cond.value ?? ''} onChange={(e) => setCond({ value: e.target.value })} aria-label="条件の値" className={`${inputCls} min-w-0 flex-1`} />}
              <select value={cond.operator} onChange={(e) => setCond({ operator: e.target.value as FilterOperator })} aria-label="条件の比べ方" className={inputCls}>
                {operatorsFor(type).map((o) => (
                  <option key={o} value={o}>
                    {OPERATOR_LABEL[o]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Field>
      )
    }
    default:
      return null
  }
}

/** 値を直接入れるか、「実行するたびに指定する」（実行時に指定する値）にするか */
function ValueInput({
  c,
  field,
  label,
  paramLabel,
  paramType,
  value,
  setP,
}: {
  c: Criterion
  field: string
  label: string
  paramLabel: string
  paramType: RunParameter['type']
  value: unknown
  setP: (patch: Record<string, unknown>, add?: RunParameter[]) => void
}) {
  const flow = useFlowStore((s) => s.flow)
  const asParam = isParamRef(value)
  const def = asParam ? flow.run_parameters.find((x) => x.param_id === value.$param) : undefined
  return (
    <Field label={label}>
      <div className="space-y-1">
        {asParam ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-mint-soft px-2 py-1 text-[0.85rem] text-forest">
            実行するたびに指定（{def?.label ?? paramLabel}）
            <button type="button" aria-label={`${label}を直接入力に戻す`} onClick={() => setP({ [field]: null })} className="ml-auto rounded p-0.5 hover:bg-white/60">
              <X className="size-3.5" aria-hidden />
            </button>
          </p>
        ) : (
          <input value={value == null ? '' : String(value)} onChange={(e) => setP({ [field]: e.target.value })} aria-label={label} className={`${inputCls} w-full`} />
        )}
        {!asParam && (
          <label className="flex items-center gap-1.5 text-[0.8rem] text-muted">
            <input
              type="checkbox"
              checked={false}
              onChange={() => {
                const param_id = `${c.criterion_id}_${field}`
                setP({ [field]: { $param: param_id } }, [
                  {
                    param_id,
                    label: paramLabel,
                    type: paramType,
                    required: true,
                  },
                ])
              }}
              aria-label={`${label}を実行するたびに指定する`}
              className="size-3.5 accent-[#135f50]"
            />
            実行するたびに指定する（毎月変わる値など）
          </label>
        )}
      </div>
    </Field>
  )
}
