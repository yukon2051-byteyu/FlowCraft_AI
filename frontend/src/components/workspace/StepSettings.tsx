import { CircleCheck, Plus, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { COLUMN_TYPE_LABEL } from '../../api/files'
import { STEP_TYPES } from '../../flow/catalog'
import {
  AGG_LABEL,
  aggTypes,
  CALC_LABEL,
  DATE_FORMATS,
  HOW_LABEL,
  OPERATOR_LABEL,
  operatorsFor,
  RELATIONSHIP_LABEL,
  ROUNDING_LABEL,
} from '../../flow/params'
import type {
  AddConstantParams,
  AggFunction,
  AggregateParams,
  CastParams,
  DuplicatesParams,
  MissingParams,
  SortParams,
  CalcOp,
  CalculateParams,
  Col,
  ConcatParams,
  Condition,
  FilterParams,
  JoinHow,
  JoinParams,
  Operand,
  OutputParams,
  Relationship,
  Rename,
  Rounding,
} from '../../flow/params'
import { useFlowStore } from '../../flow/store'
import type { ColumnType, FlowNode } from '../../flow/types'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'

type Props = {
  node: FlowNode
  index: number
  /** 使うデータごとの列（分からないときは null） */
  inputs: (Col[] | null)[]
  /** 使うデータの名前（例：「ステップ1の結果：売上実績を読み込む」） */
  inputNames: string[]
  problems: string[]
  /** 作業手順のチェック（サーバー）で見つかった、このステップの問題 */
  serverProblems: string[]
  definitionColumns?: { name: string; type: Col['type']; required?: boolean }[]
}

/**
 * 選んだ処理ステップの設定（タスク1-4）。
 * 設定に不足や誤りがあれば理由を表示し、すべて解消すると「確認済み」にできる。
 */
export function StepSettings({ node, index, inputs, inputNames, problems, serverProblems, definitionColumns }: Props) {
  const setParams = useFlowStore((s) => s.setParams)
  const renameNode = useFlowStore((s) => s.renameNode)
  const confirmNode = useFlowStore((s) => s.confirmNode)
  const info = STEP_TYPES[node.node_type]
  const p = node.parameters
  const set = (next: object) => setParams(node.node_id, next as Record<string, unknown>)
  const cols = inputs[0] ?? []
  const all = [...problems, ...serverProblems]
  const confirmed = node.confirmation_status === 'confirmed'

  let form: ReactNode
  switch (node.node_type) {
    case 'load':
      form = <LoadInfo columns={definitionColumns ?? []} />
      break
    case 'filter':
      form = <FilterForm p={p as unknown as FilterParams} cols={cols} set={set} />
      break
    case 'select_columns':
      form = <SelectForm picked={(p.columns as string[]) ?? []} cols={cols} set={(columns) => set({ columns })} />
      break
    case 'rename_columns':
      form = <RenameForm renames={(p.renames as Rename[]) ?? []} cols={cols} set={(renames) => set({ renames })} />
      break
    case 'join':
      form = <JoinForm p={p as unknown as JoinParams} left={cols} right={inputs[1] ?? []} names={inputNames} set={set} />
      break
    case 'concat':
      form = <ConcatForm p={p as unknown as ConcatParams} names={inputNames} set={set} />
      break
    case 'aggregate':
      form = <AggregateForm p={p as unknown as AggregateParams} cols={cols} set={set} />
      break
    case 'calculate':
      form = <CalculateForm p={p as unknown as CalculateParams} cols={cols} set={set} />
      break
    case 'output':
      form = <OutputForm p={p as unknown as OutputParams} names={inputNames} set={set} />
      break
    case 'sort':
      form = <SortForm p={p as unknown as SortParams} cols={cols} set={set} />
      break
    case 'drop_columns':
      form = <DropForm picked={(p.columns as string[]) ?? []} cols={cols} set={(columns) => set({ columns })} />
      break
    case 'add_constant':
      form = <AddConstantForm p={p as unknown as AddConstantParams} set={set} />
      break
    case 'cast':
      form = <CastForm p={p as unknown as CastParams} cols={cols} set={set} />
      break
    case 'duplicates':
      form = <DuplicatesForm p={p as unknown as DuplicatesParams} cols={cols} set={set} />
      break
    case 'missing':
      form = <MissingForm p={p as unknown as MissingParams} cols={cols} set={set} />
      break
    default:
      form = <p className="text-[0.9rem] text-muted">この処理の設定画面は準備中です。</p>
  }

  return (
    <section className="light-panel rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]" aria-label={`ステップ${index + 1}の設定`}>
      <div className="border-b border-line px-5 pt-4 pb-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <p className="text-[0.82rem] font-bold text-muted">ステップ{index + 1}の設定</p>
            <p className="text-[0.78rem] text-muted">{info.name}（{info.technical}）</p>
          </div>
          <StatusBadge status={confirmed ? 'confirmed' : 'unset'} className="ml-auto" />
        </div>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[0.8rem] font-bold text-muted">ステップの名前</span>
          <input
            value={node.node_name}
            maxLength={100}
            onChange={(e) => renameNode(node.node_id, e.target.value)}
            className="h-9 rounded-lg bg-card px-3 font-bold ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
          />
        </label>
      </div>

      <div className="space-y-4 px-5 py-4">{form}</div>

      <div className="border-t border-line px-5 py-3">
        {all.length > 0 ? (
          <ul className="mb-3 space-y-1 rounded-lg bg-warning-soft px-3 py-2 ring-1 ring-warning/30" aria-label="設定が必要なこと">
            {all.map((m) => (
              <li key={m} className="flex gap-1.5 text-[0.85rem] text-ink">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        ) : (
          !confirmed && <p className="mb-3 text-[0.85rem] text-muted">設定に不足はありません。内容を確かめてから、確認済みにしてください。</p>
        )}
        {confirmed ? (
          <p className="flex items-center gap-1.5 text-[0.9rem] font-bold text-success-ink">
            <CircleCheck className="size-4" aria-hidden />
            確認済みです。設定を変えると、もう一度確認が必要になります。
          </p>
        ) : (
          <Button variant="primary" size="sm" disabled={all.length > 0} onClick={() => confirmNode(node.node_id)} title={all.length ? '設定が必要なことが残っています' : undefined}>
            <CircleCheck className="size-4" aria-hidden />
            この内容で確認済みにする
          </Button>
        )}
      </div>
    </section>
  )
}

/* ---------- 共通の部品 ---------- */

const inputCls = 'h-8 rounded-lg bg-card px-2 text-[0.9rem] ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[0.8rem] font-bold text-muted">{label}</p>
      {children}
    </div>
  )
}

function ColumnSelect({ value, cols, onChange, label, allow }: { value: string; cols: Col[]; onChange: (v: string) => void; label: string; allow?: Col['type'][] }) {
  const usable = allow ? cols.filter((c) => allow.includes(c.type)) : cols
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${inputCls} min-w-0 flex-1`}>
      <option value="">（列を選ぶ）</option>
      {usable.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}（{COLUMN_TYPE_LABEL[c.type]}）
        </option>
      ))}
      {value && !usable.some((c) => c.name === value) && <option value={value}>{value}（見つかりません）</option>}
    </select>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-ink/6 hover:text-ink">
      <X className="size-4" />
    </button>
  )
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Plus className="size-4" aria-hidden />
      {children}
    </Button>
  )
}

/* ---------- 種類ごとの設定 ---------- */

function LoadInfo({ columns }: { columns: { name: string; type: Col['type']; required?: boolean }[] }) {
  return (
    <Field label={`使う列（${columns.length}列）`}>
      <ul className="flex flex-wrap gap-1.5">
        {columns.map((c) => (
          <li key={c.name} className="rounded-md bg-card px-2 py-0.5 text-[0.85rem] ring-1 ring-line">
            {c.name}
            <span className="ml-1 text-muted">{COLUMN_TYPE_LABEL[c.type]}</span>
          </li>
        ))}
      </ul>
      <p className="text-[0.82rem] text-muted">使う列とデータの形式は、「使う列と形式の設定に戻る」から変更できます。</p>
    </Field>
  )
}

function FilterForm({ p, cols, set }: { p: FilterParams; cols: Col[]; set: (p: FilterParams) => void }) {
  const g = p.condition ?? { kind: 'group', logic: 'and', conditions: [] }
  const update = (conditions: Condition[], logic = g.logic) => set({ condition: { kind: 'group', logic, conditions } })
  const change = (i: number, patch: Partial<Condition>) => update(g.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <>
      {g.conditions.length > 1 && (
        <Field label="条件の組み合わせ">
          <select value={g.logic} onChange={(e) => update(g.conditions, e.target.value as 'and' | 'or')} aria-label="条件の組み合わせ" className={inputCls}>
            <option value="and">すべての条件に合う行を残す</option>
            <option value="or">どれか1つの条件に合う行を残す</option>
          </select>
        </Field>
      )}
      <Field label="残す行の条件">
        <div className="space-y-2">
          {g.conditions.map((c, i) => {
            const type = cols.find((x) => x.name === c.column)?.type ?? 'string'
            const noValue = c.operator === 'is_empty' || c.operator === 'is_not_empty'
            return (
              <div key={i} className="space-y-1.5 rounded-lg bg-card/60 p-2 ring-1 ring-line">
                <div className="flex items-center gap-1.5">
                  <ColumnSelect
                    value={c.column}
                    cols={cols}
                    label={`条件${i + 1}の列`}
                    onChange={(column) => {
                      const t = cols.find((x) => x.name === column)?.type ?? 'string'
                      change(i, { column, operator: operatorsFor(t).includes(c.operator) ? c.operator : 'eq' })
                    }}
                  />
                  <RemoveButton label={`条件${i + 1}を外す`} onClick={() => update(g.conditions.filter((_, j) => j !== i))} />
                </div>
                <div className="flex items-center gap-1.5">
                  {!noValue &&
                    (type === 'boolean' ? (
                      <select value={c.value ?? ''} onChange={(e) => change(i, { value: e.target.value })} aria-label={`条件${i + 1}の値`} className={`${inputCls} flex-1`}>
                        <option value="">（選ぶ）</option>
                        <option value="true">はい</option>
                        <option value="false">いいえ</option>
                      </select>
                    ) : (
                      <input
                        value={c.value ?? ''}
                        onChange={(e) => change(i, { value: e.target.value })}
                        aria-label={`条件${i + 1}の値`}
                        placeholder={type === 'date' ? '例：2026-10-01' : NUMERIC_TYPES.includes(type) ? '例：1000' : '値'}
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                    ))}
                  <select
                    value={c.operator}
                    onChange={(e) => {
                      const operator = e.target.value as Condition['operator']
                      change(i, { operator, value: operator === 'is_empty' || operator === 'is_not_empty' ? null : (c.value ?? '') })
                    }}
                    aria-label={`条件${i + 1}の比べ方`}
                    className={`${inputCls} ${noValue ? 'flex-1' : ''}`}
                  >
                    {operatorsFor(type).map((o) => (
                      <option key={o} value={o}>
                        {OPERATOR_LABEL[o]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
          <AddButton onClick={() => update([...g.conditions, { kind: 'condition', column: '', operator: 'eq', value: '' }])}>条件を追加</AddButton>
        </div>
      </Field>
    </>
  )
}

const NUMERIC_TYPES: Col['type'][] = ['integer', 'decimal']

function SelectForm({ picked, cols, set }: { picked: string[]; cols: Col[]; set: (c: string[]) => void }) {
  // 並びは元の表の列の順（選んだ順ではない）
  const toggle = (name: string, on: boolean) => set(cols.map((c) => c.name).filter((n) => (n === name ? on : picked.includes(n))))
  return (
    <Field label={`取り出す列（${picked.length} ／ ${cols.length}列）`}>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => set(cols.map((c) => c.name))}>
          すべて選ぶ
        </Button>
        <Button variant="ghost" size="sm" onClick={() => set([])}>
          すべて外す
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {cols.map((c) => (
          <li key={c.name}>
            <label className="flex items-center gap-2 text-[0.9rem]">
              <input type="checkbox" checked={picked.includes(c.name)} onChange={(e) => toggle(c.name, e.target.checked)} className="size-4 accent-[#135f50]" />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
    </Field>
  )
}

function RenameForm({ renames, cols, set }: { renames: Rename[]; cols: Col[]; set: (r: Rename[]) => void }) {
  return (
    <Field label="名前を変える列">
      <div className="space-y-1.5">
        {renames.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <ColumnSelect value={r.source} cols={cols} label={`${i + 1}つ目の元の列`} onChange={(source) => set(renames.map((x, j) => (j === i ? { ...x, source } : x)))} />
            <span className="text-muted">→</span>
            <input
              value={r.target}
              onChange={(e) => set(renames.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}
              aria-label={`${i + 1}つ目の新しい名前`}
              placeholder="新しい名前"
              className={`${inputCls} min-w-0 flex-1`}
            />
            <RemoveButton label={`${i + 1}つ目を外す`} onClick={() => set(renames.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddButton onClick={() => set([...renames, { source: '', target: '' }])}>列を追加</AddButton>
      </div>
    </Field>
  )
}

function JoinForm({ p, left, right, names, set }: { p: JoinParams; left: Col[]; right: Col[]; names: string[]; set: (p: JoinParams) => void }) {
  const patch = (x: Partial<JoinParams>) => set({ ...p, ...x })
  return (
    <>
      <Field label="照合に使う列（2つの表で同じ値が入っている列）">
        <div className="space-y-1.5">
          {p.keys.map((k, i) => (
            <div key={i} className="space-y-1 rounded-lg bg-card/60 p-2 ring-1 ring-line">
              <div className="flex items-center gap-1.5">
                <span className="w-24 shrink-0 text-[0.8rem] text-muted">元の表</span>
                <ColumnSelect value={k.left} cols={left} label={`元の表の照合に使う列${i + 1}`} onChange={(v) => patch({ keys: p.keys.map((x, j) => (j === i ? { left: v, right: x.right || (right.some((c) => c.name === v) ? v : '') } : x)) })} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-24 shrink-0 text-[0.8rem] text-muted">付け加える表</span>
                <ColumnSelect value={k.right} cols={right} label={`付け加える表の照合に使う列${i + 1}`} onChange={(v) => patch({ keys: p.keys.map((x, j) => (j === i ? { ...x, right: v } : x)) })} />
                {p.keys.length > 1 && <RemoveButton label={`照合に使う列${i + 1}を外す`} onClick={() => patch({ keys: p.keys.filter((_, j) => j !== i) })} />}
              </div>
            </div>
          ))}
          {p.keys.length < 5 && <AddButton onClick={() => patch({ keys: [...p.keys, { left: '', right: '' }] })}>照合に使う列を追加</AddButton>}
        </div>
        <p className="text-[0.8rem] text-muted">元の表：{names[0] ?? '—'} ／ 付け加える表：{names[1] ?? '—'}</p>
      </Field>
      <Field label="照合に使う列の値は、それぞれの表に何行ありますか？">
        <select value={p.expected_relationship} onChange={(e) => patch({ expected_relationship: e.target.value as Relationship })} aria-label="照合に使う列の値の行数" className={`${inputCls} h-auto w-full py-1.5`}>
          {(Object.keys(RELATIONSHIP_LABEL) as Relationship[]).map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABEL[r]}
            </option>
          ))}
        </select>
        <p className="text-[0.8rem] text-muted">実際のデータがこの想定と違う場合は、売上が二重に数えられるのを防ぐため、処理を止めてお知らせします。</p>
      </Field>
      <Field label="残す行">
        <select value={p.how} onChange={(e) => patch({ how: e.target.value as JoinHow })} aria-label="残す行" className={`${inputCls} w-full`}>
          {(['left', 'inner', 'right', 'outer'] as JoinHow[]).map((h) => (
            <option key={h} value={h}>
              {HOW_LABEL[h]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="相手の表に見つからない値があったとき">
        <select value={p.unmatched_policy} onChange={(e) => patch({ unmatched_policy: e.target.value as 'warn' | 'error' })} aria-label="相手の表に見つからない値があったとき" className={`${inputCls} w-full`}>
          <option value="warn">お知らせして続ける（行は消しません）</option>
          <option value="error">作業を止める</option>
        </select>
        <label className="flex items-center gap-2 text-[0.88rem]">
          <input type="checkbox" checked={p.key_normalization === 'trim'} onChange={(e) => patch({ key_normalization: e.target.checked ? 'trim' : 'none' })} className="size-4 accent-[#135f50]" />
          照合するとき、値の前後の空白を無視する（データは変えません）
        </label>
      </Field>
      <Field label="付け加える前後で合計が変わらないか確かめる列（任意）">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {left
            .filter((c) => NUMERIC_TYPES.includes(c.type))
            .map((c) => (
              <li key={c.name}>
                <label className="flex items-center gap-2 text-[0.88rem]">
                  <input
                    type="checkbox"
                    checked={p.check_amount_columns.includes(c.name)}
                    onChange={(e) => patch({ check_amount_columns: e.target.checked ? [...p.check_amount_columns, c.name] : p.check_amount_columns.filter((x) => x !== c.name) })}
                    className="size-4 accent-[#135f50]"
                  />
                  {c.name}
                </label>
              </li>
            ))}
        </ul>
      </Field>
      <Field label="名前が重なった列に付ける文字">
        <input value={p.right_suffix} onChange={(e) => patch({ right_suffix: e.target.value })} maxLength={20} aria-label="名前が重なった列に付ける文字" className={`${inputCls} w-32`} />
      </Field>
    </>
  )
}

function ConcatForm({ p, names, set }: { p: ConcatParams; names: string[]; set: (p: ConcatParams) => void }) {
  const recording = p.source_column !== null && p.source_column !== undefined
  return (
    <>
      <Field label="入力元を記録する列（任意）">
        <label className="flex items-center gap-2 text-[0.88rem]">
          <input type="checkbox" checked={recording} onChange={(e) => set({ ...p, source_column: e.target.checked ? '入力元' : null })} className="size-4 accent-[#135f50]" />
          どの表の行かを、列に記録する
        </label>
        {recording && (
          <>
            <input value={p.source_column ?? ''} onChange={(e) => set({ ...p, source_column: e.target.value })} aria-label="入力元を記録する列の名前" className={`${inputCls} w-48`} />
            <div className="space-y-1">
              {p.sources.map((s, i) => (
                <label key={i} className="flex items-center gap-2 text-[0.85rem]">
                  <span className="w-36 shrink-0 truncate text-muted" title={names[i]}>
                    {names[i] ?? `表${i + 1}`}
                  </span>
                  <input
                    value={s.label ?? ''}
                    onChange={(e) => set({ ...p, sources: p.sources.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)) })}
                    aria-label={`まとめる表${i + 1}の記録する名前`}
                    placeholder="例：東京"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </Field>
      <Field label="一部の表に列がないとき">
        <select value={p.missing_columns} onChange={(e) => set({ ...p, missing_columns: e.target.value as 'error' | 'allow' })} aria-label="一部の表に列がないとき" className={`${inputCls} w-full`}>
          <option value="error">作業を止める（列名をそろえてから実行）</option>
          <option value="allow">空欄のまままとめ、件数をお知らせする</option>
        </select>
      </Field>
      <p className="text-[0.82rem] text-muted">列の名前が表によって違う場合は、まとめる前に「列の名前を変える」でそろえてください。</p>
    </>
  )
}

function AggregateForm({ p, cols, set }: { p: AggregateParams; cols: Col[]; set: (p: AggregateParams) => void }) {
  const aggs = p.aggregations
  const setAgg = (i: number, patch: Partial<AggregateParams['aggregations'][number]>) =>
    set({ ...p, aggregations: aggs.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const autoName = (fn: AggFunction, col: string | null) => (col ? `${col}${AGG_LABEL[fn]}` : '件数')
  return (
    <>
      <Field label="項目（この列の値ごとにまとめる。選ばなければ全体で1行）">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {cols.map((c) => (
            <li key={c.name}>
              <label className="flex items-center gap-2 text-[0.9rem]">
                <input
                  type="checkbox"
                  checked={p.group_by.includes(c.name)}
                  onChange={(e) => set({ ...p, group_by: cols.map((x) => x.name).filter((n) => (n === c.name ? e.target.checked : p.group_by.includes(n))) })}
                  aria-label={`「${c.name}」ごとにまとめる`}
                  className="size-4 accent-[#135f50]"
                />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
      </Field>
      <Field label="集計する内容">
        <div className="space-y-2">
          {aggs.map((a, i) => (
            <div key={i} className="space-y-1.5 rounded-lg bg-card/60 p-2 ring-1 ring-line">
              <div className="flex items-center gap-1.5">
                <select
                  value={a.function}
                  onChange={(e) => {
                    const fn = e.target.value as AggFunction
                    const column = fn === 'count' ? null : a.column
                    const auto = a.output_column === '' || a.output_column === autoName(a.function, a.column)
                    setAgg(i, { function: fn, column, ...(auto ? { output_column: autoName(fn, column) } : {}) })
                  }}
                  aria-label={`集計${i + 1}の方法`}
                  className={inputCls}
                >
                  {(Object.keys(AGG_LABEL) as AggFunction[]).map((f) => (
                    <option key={f} value={f}>
                      {AGG_LABEL[f]}
                    </option>
                  ))}
                </select>
                {a.function !== 'count' && (
                  <ColumnSelect
                    value={a.column ?? ''}
                    cols={cols}
                    allow={aggTypes(a.function)}
                    label={`集計${i + 1}の列`}
                    onChange={(v) => {
                      const auto = a.output_column === '' || a.output_column === autoName(a.function, a.column)
                      setAgg(i, { column: v || null, ...(auto ? { output_column: autoName(a.function, v || null) } : {}) })
                    }}
                  />
                )}
                {aggs.length > 1 && <RemoveButton label={`集計${i + 1}を外す`} onClick={() => set({ ...p, aggregations: aggs.filter((_, j) => j !== i) })} />}
              </div>
              <label className="flex items-center gap-1.5 text-[0.85rem]">
                <span className="shrink-0 text-muted">結果の列名</span>
                <input value={a.output_column} onChange={(e) => setAgg(i, { output_column: e.target.value })} aria-label={`集計${i + 1}の結果の列名`} className={`${inputCls} min-w-0 flex-1`} />
              </label>
            </div>
          ))}
          <AddButton onClick={() => set({ ...p, aggregations: [...aggs, { function: 'sum', column: null, output_column: '', scale: null, rounding: 'half_up' }] })}>集計する内容を追加</AddButton>
        </div>
      </Field>
    </>
  )
}

function OperandInput({ o, cols, side, set }: { o: Operand; cols: Col[]; side: string; set: (o: Operand) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={o.kind}
        onChange={(e) => set(e.target.value === 'column' ? { kind: 'column', column: '' } : { kind: 'constant', value: '' })}
        aria-label={`${side}側の種類`}
        className={inputCls}
      >
        <option value="column">列</option>
        <option value="constant">数値</option>
      </select>
      {o.kind === 'column' ? (
        <ColumnSelect value={o.column} cols={cols} allow={NUMERIC_TYPES} label={`${side}側の列`} onChange={(column) => set({ kind: 'column', column })} />
      ) : (
        <input value={o.value} onChange={(e) => set({ kind: 'constant', value: e.target.value })} aria-label={`${side}側の数値`} placeholder="例：1.1" className={`${inputCls} min-w-0 flex-1`} />
      )}
    </div>
  )
}

function CalculateForm({ p, cols, set }: { p: CalculateParams; cols: Col[]; set: (p: CalculateParams) => void }) {
  const ex = p.expression
  return (
    <>
      <Field label="計算結果の列名">
        <input value={p.output_column} onChange={(e) => set({ ...p, output_column: e.target.value })} aria-label="計算結果の列名" placeholder="例：金額" className={`${inputCls} w-full`} />
      </Field>
      <Field label="計算式">
        <div className="space-y-1.5">
          <OperandInput o={ex.left} cols={cols} side="左" set={(left) => set({ ...p, expression: { ...ex, left } })} />
          <select value={ex.op} onChange={(e) => set({ ...p, expression: { ...ex, op: e.target.value as CalcOp } })} aria-label="計算の方法" className={inputCls}>
            {(Object.keys(CALC_LABEL) as CalcOp[]).map((o) => (
              <option key={o} value={o}>
                {CALC_LABEL[o]}
              </option>
            ))}
          </select>
          <OperandInput o={ex.right} cols={cols} side="右" set={(right) => set({ ...p, expression: { ...ex, right } })} />
        </div>
      </Field>
      <Field label="小数の桁数と端数の処理">
        <div className="flex items-center gap-1.5">
          <select
            value={p.scale === null ? '' : String(p.scale)}
            onChange={(e) => set({ ...p, scale: e.target.value === '' ? null : Number(e.target.value) })}
            aria-label="小数の桁数"
            className={inputCls}
          >
            <option value="">そのまま</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                小数{n}桁{n === 0 ? '（整数）' : ''}
              </option>
            ))}
          </select>
          {p.scale !== null && (
            <select value={p.rounding} onChange={(e) => set({ ...p, rounding: e.target.value as Rounding })} aria-label="端数の処理" className={inputCls}>
              {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </div>
      </Field>
      <Field label="0で割る計算があったとき">
        <select value={p.on_zero_division} onChange={(e) => set({ ...p, on_zero_division: e.target.value as 'warn' | 'error' })} aria-label="0で割る計算があったとき" className={`${inputCls} w-full`}>
          <option value="warn">空欄にして、件数をお知らせする</option>
          <option value="error">作業を止める</option>
        </select>
      </Field>
    </>
  )
}

function OutputForm({ p, names, set }: { p: OutputParams; names: string[]; set: (p: OutputParams) => void }) {
  return (
    <Field label="出力するシート（使うデータの順に並びます）">
      <div className="space-y-1.5">
        {p.sheets.map((s, i) => (
          <label key={i} className="block space-y-1 rounded-lg bg-card/60 p-2 ring-1 ring-line">
            <span className="block truncate text-[0.8rem] text-muted" title={names[i]}>
              {names[i] ?? `出力する表${i + 1}`}
            </span>
            <input
              value={s.sheet_name}
              onChange={(e) => set({ sheets: p.sheets.map((x, j) => (j === i ? { ...x, sheet_name: e.target.value } : x)) })}
              aria-label={`シート${i + 1}の名前`}
              maxLength={31}
              className={`${inputCls} w-full`}
            />
          </label>
        ))}
        <p className="text-[0.8rem] text-muted">出力する表を増やすときは、ステップの「表を追加」から選んでください。</p>
      </div>
    </Field>
  )
}

/* ---------- 1-5：残りの6種 ---------- */

const TYPE_OPTIONS: ColumnType[] = ['string', 'integer', 'decimal', 'date', 'boolean']

/** 列のチェックボックス一覧（並びは元の表の列の順） */
function ColumnChecks({ picked, cols, set, label }: { picked: string[]; cols: Col[]; set: (c: string[]) => void; label: (name: string) => string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
      {cols.map((c) => (
        <li key={c.name}>
          <label className="flex items-center gap-2 text-[0.9rem]">
            <input
              type="checkbox"
              checked={picked.includes(c.name)}
              onChange={(e) => set(cols.map((x) => x.name).filter((n) => (n === c.name ? e.target.checked : picked.includes(n))))}
              aria-label={label(c.name)}
              className="size-4 accent-[#135f50]"
            />
            {c.name}
          </label>
        </li>
      ))}
    </ul>
  )
}

function SortForm({ p, cols, set }: { p: SortParams; cols: Col[]; set: (p: SortParams) => void }) {
  const keys = p.keys ?? []
  const patch = (i: number, x: Partial<SortParams['keys'][number]>) => set({ keys: keys.map((k, j) => (j === i ? { ...k, ...x } : k)) })
  return (
    <Field label="並べ替えに使う列（上の列から順に優先）">
      <div className="space-y-1.5">
        {keys.map((k, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-center text-[0.8rem] text-muted">{i + 1}</span>
            <ColumnSelect value={k.column} cols={cols} label={`並べ替え${i + 1}の列`} onChange={(column) => patch(i, { column })} />
            <select value={k.ascending ? 'asc' : 'desc'} onChange={(e) => patch(i, { ascending: e.target.value === 'asc' })} aria-label={`並べ替え${i + 1}の順番`} className={inputCls}>
              <option value="asc">小さい順（古い順・あいうえお順）</option>
              <option value="desc">大きい順（新しい順）</option>
            </select>
            {keys.length > 1 && <RemoveButton label={`並べ替え${i + 1}を外す`} onClick={() => set({ keys: keys.filter((_, j) => j !== i) })} />}
          </div>
        ))}
        {keys.length < 10 && <AddButton onClick={() => set({ keys: [...keys, { column: '', ascending: true }] })}>列を追加</AddButton>}
        <p className="text-[0.8rem] text-muted">空欄の行は最後に並びます。同じ値の行は、元の順番のままです。</p>
      </div>
    </Field>
  )
}

function DropForm({ picked, cols, set }: { picked: string[]; cols: Col[]; set: (c: string[]) => void }) {
  return (
    <Field label={`消す列（${picked.length} ／ ${cols.length}列）`}>
      <ColumnChecks picked={picked} cols={cols} set={set} label={(n) => `「${n}」を消す`} />
    </Field>
  )
}

function AddConstantForm({ p, set }: { p: AddConstantParams; set: (p: AddConstantParams) => void }) {
  return (
    <>
      <Field label="追加する列の名前">
        <input value={p.column} onChange={(e) => set({ ...p, column: e.target.value })} aria-label="追加する列の名前" placeholder="例：対象月" className={`${inputCls} w-full`} />
      </Field>
      <Field label="データの形式と、すべての行に入れる値">
        <div className="flex items-center gap-1.5">
          <select
            value={p.value_type}
            onChange={(e) => set({ ...p, value_type: e.target.value as ColumnType, value: e.target.value === 'boolean' ? 'true' : p.value })}
            aria-label="追加する列のデータの形式"
            className={inputCls}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {COLUMN_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {p.value_type === 'boolean' ? (
            <select value={p.value ?? 'true'} onChange={(e) => set({ ...p, value: e.target.value })} aria-label="入れる値" className={`${inputCls} flex-1`}>
              <option value="true">はい</option>
              <option value="false">いいえ</option>
            </select>
          ) : (
            <input
              value={p.value ?? ''}
              onChange={(e) => set({ ...p, value: e.target.value })}
              aria-label="入れる値"
              placeholder={p.value_type === 'date' ? '例：2026-10-01' : p.value_type === 'string' ? '例：2026年10月' : '例：100'}
              className={`${inputCls} min-w-0 flex-1`}
            />
          )}
        </div>
      </Field>
    </>
  )
}

function CastForm({ p, cols, set }: { p: CastParams; cols: Col[]; set: (p: CastParams) => void }) {
  const casts = p.casts ?? []
  const patch = (i: number, x: Partial<CastParams['casts'][number]>) => set({ ...p, casts: casts.map((c, j) => (j === i ? { ...c, ...x } : c)) })
  return (
    <>
      <Field label="形式をそろえる列">
        <div className="space-y-2">
          {casts.map((c, i) => {
            const from = cols.find((x) => x.name === c.column)?.type
            return (
              <div key={i} className="space-y-1.5 rounded-lg bg-card/60 p-2 ring-1 ring-line">
                <div className="flex items-center gap-1.5">
                  <ColumnSelect value={c.column} cols={cols} label={`${i + 1}つ目の列`} onChange={(column) => patch(i, { column })} />
                  {casts.length > 1 && <RemoveButton label={`${i + 1}つ目を外す`} onClick={() => set({ ...p, casts: casts.filter((_, j) => j !== i) })} />}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.85rem]">
                  <span className="text-muted">{from ? `${COLUMN_TYPE_LABEL[from]} →` : '→'}</span>
                  <select
                    value={c.to}
                    onChange={(e) => patch(i, { to: e.target.value as ColumnType, scale: null, date_format: null })}
                    aria-label={`${i + 1}つ目の変換後の形式`}
                    className={inputCls}
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {COLUMN_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  {c.to === 'decimal' && (
                    <select
                      value={c.scale === null ? '' : String(c.scale)}
                      onChange={(e) => patch(i, { scale: e.target.value === '' ? null : Number(e.target.value) })}
                      aria-label={`${i + 1}つ目の小数の桁数`}
                      className={inputCls}
                    >
                      <option value="">桁数はそのまま</option>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          小数{n}桁
                        </option>
                      ))}
                    </select>
                  )}
                  {c.to === 'decimal' && c.scale !== null && (
                    <select value={c.rounding} onChange={(e) => patch(i, { rounding: e.target.value as Rounding })} aria-label={`${i + 1}つ目の端数の処理`} className={inputCls}>
                      {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((r) => (
                        <option key={r} value={r}>
                          {ROUNDING_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  {c.to === 'date' && (
                    <select
                      value={c.date_format ?? ''}
                      onChange={(e) => patch(i, { date_format: e.target.value || null })}
                      aria-label={`${i + 1}つ目の日付の書き方`}
                      className={inputCls}
                    >
                      {DATE_FORMATS.map((f) => (
                        <option key={f.label} value={f.value ?? ''}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )
          })}
          <AddButton onClick={() => set({ ...p, casts: [...casts, { column: '', to: 'string', scale: null, date_format: null, rounding: 'half_up' }] })}>列を追加</AddButton>
        </div>
      </Field>
      <Field label="変換できない値があったとき">
        <select value={p.on_failure} onChange={(e) => set({ ...p, on_failure: e.target.value as 'error' | 'warn' })} aria-label="変換できない値があったとき" className={`${inputCls} w-full`}>
          <option value="error">作業を止める（行番号を表示）</option>
          <option value="warn">空欄にして、件数と行番号をお知らせする</option>
        </select>
      </Field>
    </>
  )
}

function DuplicatesForm({ p, cols, set }: { p: DuplicatesParams; cols: Col[]; set: (p: DuplicatesParams) => void }) {
  return (
    <>
      <Field label="重複を判断する列（選んだ列の値がすべて同じ行を、重複とみなす）">
        <ColumnChecks picked={p.key_columns} cols={cols} set={(key_columns) => set({ ...p, key_columns })} label={(n) => `「${n}」で重複を判断する`} />
      </Field>
      <Field label="重複があったとき">
        <select value={p.mode} onChange={(e) => set({ ...p, mode: e.target.value as 'detect' | 'remove' })} aria-label="重複があったとき" className={`${inputCls} w-full`}>
          <option value="detect">調べてお知らせするだけ（データは変えない）</option>
          <option value="remove">重複した行を取り除く</option>
        </select>
        {p.mode === 'remove' && (
          <select value={p.keep} onChange={(e) => set({ ...p, keep: e.target.value as 'first' | 'last' })} aria-label="残す行" className={`${inputCls} w-full`}>
            <option value="first">最初に出てくる行を残す</option>
            <option value="last">最後に出てくる行を残す</option>
          </select>
        )}
      </Field>
    </>
  )
}

function MissingForm({ p, cols, set }: { p: MissingParams; cols: Col[]; set: (p: MissingParams) => void }) {
  return (
    <>
      <Field label="空欄を調べる列">
        <ColumnChecks picked={p.columns} cols={cols} set={(columns) => set({ ...p, columns })} label={(n) => `「${n}」の空欄を調べる`} />
      </Field>
      <Field label="空欄があったとき">
        <select
          value={p.mode}
          onChange={(e) => {
            const mode = e.target.value as MissingParams['mode']
            set({ ...p, mode, fill_value: mode === 'fill' ? (p.fill_value ?? '') : null })
          }}
          aria-label="空欄があったとき"
          className={`${inputCls} w-full`}
        >
          <option value="detect">調べてお知らせするだけ（データは変えない）</option>
          <option value="fill">決めた値で埋める</option>
          <option value="drop_rows">空欄がある行を除く</option>
        </select>
        {p.mode === 'fill' && (
          <>
            <input value={p.fill_value ?? ''} onChange={(e) => set({ ...p, fill_value: e.target.value })} aria-label="空欄に入れる値" placeholder="例：0" className={`${inputCls} w-full`} />
            <p className="text-[0.8rem] text-muted">空欄を0とみなしてよいかは、業務によって違います。埋めた件数と行は、実行結果に記録されます。</p>
          </>
        )}
      </Field>
    </>
  )
}
