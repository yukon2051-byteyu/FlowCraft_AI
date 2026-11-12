/*
 * タスク1-4：処理ステップの設定（parameters）。
 * 型・初期値・「各ステップで使える列」の計算・設定の不足や誤りの判定・一覧に出す説明文。
 *
 * 形はサーバーの backend/app/flow/schema.py と同じ。最終的な判定は常にサーバーの検証で行い、
 * ここでは「画面ですぐに理由を示す」ための判定をする。
 * 列の計算は、処理エンジン（backend/app/engine/nodes/*.py）の列の決まりに合わせている。
 */

import type { ColumnType, FlowDoc, FlowNode, NodeType } from './types'

export type Col = { name: string; type: ColumnType }

/* ---------- 設定の型 ---------- */

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
export type Condition = { kind: 'condition'; column: string; operator: FilterOperator; value: string | null }
export type FilterParams = { condition: { kind: 'group'; logic: 'and' | 'or'; conditions: Condition[] } }
export type SelectColumnsParams = { columns: string[] }
export type Rename = { source: string; target: string }
export type RenameColumnsParams = { renames: Rename[] }
export type JoinHow = 'inner' | 'left' | 'right' | 'outer'
export type Relationship = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
export type JoinParams = {
  keys: { left: string; right: string }[]
  how: JoinHow
  expected_relationship: Relationship
  unmatched_policy: 'warn' | 'error'
  key_normalization: 'none' | 'trim'
  check_amount_columns: string[]
  right_suffix: string
}
export type ConcatSource = { reference: string; label: string | null; renames: Rename[] }
export type ConcatParams = { sources: ConcatSource[]; missing_columns: 'error' | 'allow'; source_column: string | null }
export type AggFunction = 'sum' | 'mean' | 'max' | 'min' | 'count' | 'nunique'
export type Rounding = 'half_up' | 'down' | 'up' | 'half_even'
export type Aggregation = { function: AggFunction; column: string | null; output_column: string; scale: number | null; rounding: Rounding }
export type AggregateParams = { group_by: string[]; aggregations: Aggregation[] }
export type CalcOp = 'add' | 'subtract' | 'multiply' | 'divide' | 'ratio_percent'
export type Operand = { kind: 'column'; column: string } | { kind: 'constant'; value: string }
export type CalculateParams = {
  output_column: string
  expression: { kind: 'operation'; op: CalcOp; left: Operand; right: Operand }
  scale: number | null
  rounding: Rounding
  on_zero_division: 'warn' | 'error'
}
export type OutputParams = { sheets: { reference: string; sheet_name: string }[] }

/** 1-4 で設定画面を作った種類（残りの6種は 1-5） */
export const FORM_TYPES: NodeType[] = ['load', 'filter', 'select_columns', 'rename_columns', 'join', 'concat', 'aggregate', 'calculate', 'output']

/* ---------- 表示用の名前 ---------- */

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  eq: 'と等しい',
  ne: 'と等しくない',
  gt: 'より大きい',
  ge: '以上',
  lt: 'より小さい',
  le: '以下',
  contains: 'を含む',
  not_contains: 'を含まない',
  is_empty: '空欄である',
  is_not_empty: '空欄ではない',
}

export const AGG_LABEL: Record<AggFunction, string> = { sum: '合計', mean: '平均', max: '最大', min: '最小', count: '件数', nunique: '種類の数' }

export const CALC_LABEL: Record<CalcOp, string> = { add: '＋', subtract: '－', multiply: '×', divide: '÷', ratio_percent: '÷ … × 100（％）' }

export const ROUNDING_LABEL: Record<Rounding, string> = { half_up: '四捨五入', down: '切り捨て', up: '切り上げ', half_even: '偶数への丸め' }

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  many_to_one: '元の表には同じ値が何行もあり、付け加える表には1行だけ（例：売上と商品マスタ）',
  one_to_one: 'どちらの表にも、同じ値は1行だけ',
  one_to_many: '元の表には1行だけ、付け加える表には何行もある（行が増えます）',
  many_to_many: 'どちらの表にも、同じ値が何行もある（行が大きく増えます）',
}

export const HOW_LABEL: Record<JoinHow, string> = {
  left: '元の表の行をすべて残す（相手が見つからない行も残す）',
  inner: '両方の表で照合できた行だけ残す',
  right: '付け加える表の行をすべて残す',
  outer: '両方の表の行をすべて残す',
}

const NUMERIC: ColumnType[] = ['integer', 'decimal']

/** 演算子ごとに使える列の形式 */
export function operatorsFor(type: ColumnType): FilterOperator[] {
  if (type === 'string') return ['eq', 'ne', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
  if (type === 'boolean') return ['eq', 'ne', 'is_empty', 'is_not_empty']
  return ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'is_empty', 'is_not_empty']
}

/** 集計方法ごとに使える列の形式 */
export function aggTypes(fn: AggFunction): ColumnType[] {
  if (fn === 'sum' || fn === 'mean') return NUMERIC
  if (fn === 'max' || fn === 'min') return [...NUMERIC, 'date']
  return ['string', 'integer', 'decimal', 'date', 'boolean']
}

/* ---------- 初期値と、使うデータとの同期 ---------- */

export function defaultParams(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'filter':
      return { condition: { kind: 'group', logic: 'and', conditions: [] } }
    case 'select_columns':
      return { columns: [] }
    case 'rename_columns':
      return { renames: [{ source: '', target: '' }] }
    case 'join':
      return {
        keys: [{ left: '', right: '' }],
        how: 'left',
        expected_relationship: 'many_to_one',
        unmatched_policy: 'warn',
        key_normalization: 'none',
        check_amount_columns: [],
        right_suffix: '_右',
      }
    case 'concat':
      return { sources: [], missing_columns: 'error', source_column: null }
    case 'aggregate':
      return { group_by: [], aggregations: [{ function: 'sum', column: null, output_column: '', scale: null, rounding: 'half_up' }] }
    case 'calculate':
      return {
        output_column: '',
        expression: { kind: 'operation', op: 'multiply', left: { kind: 'column', column: '' }, right: { kind: 'column', column: '' } },
        scale: null,
        rounding: 'half_up',
        on_zero_division: 'warn',
      }
    case 'output':
      return { sheets: [] }
    default:
      return {}
  }
}

const SHEET_FORBIDDEN = /[[\]:*?/\\]/g

/** 縦にまとめる・出力では、設定の並び（sources / sheets）を使うデータと同じ順序にそろえる（サーバーの決まり） */
export function syncParams(node: FlowNode, nodes: FlowNode[]): Record<string, unknown> {
  const refs = node.input_references
  if (node.node_type === 'concat') {
    const p = node.parameters as Partial<ConcatParams>
    const old = p.sources ?? []
    return { ...p, sources: refs.map((r) => old.find((s) => s.reference === r) ?? { reference: r, label: null, renames: [] }) }
  }
  if (node.node_type === 'output') {
    const p = node.parameters as Partial<OutputParams>
    const old = p.sheets ?? []
    return {
      ...p,
      sheets: refs.map((r) => {
        const kept = old.find((s) => s.reference === r)
        if (kept) return kept
        const producer = nodes.find((n) => n.output_reference === r)
        return { reference: r, sheet_name: (producer?.node_name ?? '').replace(SHEET_FORBIDDEN, '').slice(0, 31) }
      }),
    }
  }
  return node.parameters
}

/* ---------- 各ステップで使える列 ---------- */

/** 参照名 → その結果の列。上流の設定が未完成で分からないときは null */
export function inferColumns(flow: Pick<FlowDoc, 'nodes' | 'input_definitions'>): Record<string, Col[] | null> {
  const out: Record<string, Col[] | null> = {}
  for (const node of flow.nodes) {
    if (!node.output_reference) continue
    const inputs = node.input_references.map((r) => out[r] ?? null)
    out[node.output_reference] = node.node_type === 'load' ? loadColumns(node, flow) : inputs.some((c) => c === null) ? null : resultColumns(node, inputs as Col[][])
  }
  return out
}

function loadColumns(node: FlowNode, flow: Pick<FlowDoc, 'input_definitions'>): Col[] | null {
  const def = flow.input_definitions.find((d) => d.input_id === node.parameters.input_id)
  return def ? def.columns.map((c) => ({ name: c.name, type: c.type })) : null
}

function resultColumns(node: FlowNode, inputs: Col[][]): Col[] | null {
  const [first = []] = inputs
  const typeOf = (cols: Col[], name: string) => cols.find((c) => c.name === name)?.type
  const p = node.parameters as Record<string, unknown>
  switch (node.node_type) {
    case 'filter':
    case 'sort':
    case 'duplicates':
    case 'missing':
      return first
    case 'select_columns':
      return ((p.columns as string[]) ?? []).flatMap((n) => first.filter((c) => c.name === n))
    case 'rename_columns': {
      const map = new Map(((p.renames as Rename[]) ?? []).map((r) => [r.source, r.target]))
      return first.map((c) => ({ ...c, name: map.get(c.name) || c.name }))
    }
    case 'drop_columns':
      return first.filter((c) => !((p.columns as string[]) ?? []).includes(c.name))
    case 'add_constant':
      return p.column ? [...first, { name: String(p.column), type: (p.value_type as ColumnType) ?? 'string' }] : first
    case 'cast': {
      const casts = (p.casts as { column: string; to: ColumnType }[]) ?? []
      return first.map((c) => ({ ...c, type: casts.find((x) => x.column === c.name)?.to ?? c.type }))
    }
    case 'join': {
      const jp = p as unknown as JoinParams
      const [left, right = []] = inputs
      const keyPairs = new Map((jp.keys ?? []).map((k) => [k.left, k.right]))
      const cols: Col[] = left.map((c) => {
        const rk = keyPairs.get(c.name)
        const rt = rk ? typeOf(right, rk) : undefined
        return rt && rt !== c.type ? { name: c.name, type: 'decimal' } : c
      })
      const rightKeys = new Set((jp.keys ?? []).map((k) => k.right))
      for (const c of right) {
        if (rightKeys.has(c.name)) continue
        const name = cols.some((x) => x.name === c.name) ? `${c.name}${jp.right_suffix ?? '_右'}` : c.name
        cols.push({ name, type: c.type })
      }
      return cols
    }
    case 'concat': {
      const cp = p as unknown as ConcatParams
      const cols: Col[] = []
      inputs.forEach((t, i) => {
        const map = new Map((cp.sources?.[i]?.renames ?? []).map((r) => [r.source, r.target]))
        for (const c of t) {
          const name = map.get(c.name) || c.name
          const have = cols.find((x) => x.name === name)
          if (!have) cols.push({ name, type: c.type })
          else if (have.type !== c.type && NUMERIC.includes(have.type) && NUMERIC.includes(c.type)) have.type = 'decimal'
        }
      })
      return cp.source_column ? [{ name: cp.source_column, type: 'string' }, ...cols] : cols
    }
    case 'aggregate': {
      const ap = p as unknown as AggregateParams
      const keys = (ap.group_by ?? []).flatMap((n) => first.filter((c) => c.name === n))
      const aggs = (ap.aggregations ?? []).map((a): Col => {
        const src = a.column ? typeOf(first, a.column) : undefined
        let type: ColumnType = 'integer'
        if (a.function === 'mean') type = 'decimal'
        else if (a.function !== 'count' && a.function !== 'nunique' && src) type = src === 'integer' && a.scale === null ? 'integer' : src === 'date' ? 'date' : 'decimal'
        return { name: a.output_column, type }
      })
      return [...keys, ...aggs]
    }
    case 'calculate':
      return p.output_column ? [...first, { name: String(p.output_column), type: 'decimal' }] : first
    default:
      return null
  }
}

/* ---------- 設定の不足・誤り（画面ですぐに示す理由） ---------- */

const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/
const DATE = /^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$/

function valueProblem(type: ColumnType, value: string): string | null {
  if (NUMERIC.includes(type) && !NUMBER.test(value)) return '数値（半角）で入力してください'
  if (type === 'date' && !DATE.test(value)) return '日付は 2026-10-01 または 2026/10/01 の形で入力してください'
  if (type === 'boolean' && !['true', 'false'].includes(value)) return '「はい」か「いいえ」を選んでください'
  return null
}

/** 設定の不足・誤り。空なら設定は完了している */
export function paramProblems(node: FlowNode, inputs: (Col[] | null)[]): string[] {
  const out: string[] = []
  if (node.input_references.some((r) => r === '')) out.push('使うデータを選んでください')
  if (inputs.some((c) => c === null) && node.node_type !== 'load') {
    out.push('使うデータのステップの設定が終わっていないため、列が分かりません')
    return out
  }
  const cols = (inputs[0] ?? []) as Col[]
  const has = (name: string, list: Col[] = cols) => list.some((c) => c.name === name)
  const typeOf = (name: string, list: Col[] = cols) => list.find((c) => c.name === name)?.type
  const p = node.parameters as Record<string, unknown>

  switch (node.node_type) {
    case 'filter': {
      const conds = (p as unknown as FilterParams).condition?.conditions ?? []
      if (conds.length === 0) out.push('条件を1つ以上追加してください')
      conds.forEach((c, i) => {
        const at = `条件${i + 1}：`
        if (!c.column) return out.push(`${at}列を選んでください`)
        const t = typeOf(c.column)
        if (!t) return out.push(`${at}列「${c.column}」がありません`)
        if (!operatorsFor(t).includes(c.operator)) out.push(`${at}この列では「${OPERATOR_LABEL[c.operator]}」は使えません`)
        if (c.operator !== 'is_empty' && c.operator !== 'is_not_empty') {
          if (c.value === null || c.value === '') out.push(`${at}値を入力してください`)
          else if (!['contains', 'not_contains'].includes(c.operator)) {
            const vp = valueProblem(t, c.value)
            if (vp) out.push(`${at}${vp}`)
          }
        }
      })
      break
    }
    case 'select_columns': {
      const picked = (p.columns as string[]) ?? []
      if (picked.length === 0) out.push('取り出す列を1つ以上選んでください')
      picked.filter((n) => !has(n)).forEach((n) => out.push(`列「${n}」がありません`))
      break
    }
    case 'rename_columns': {
      const rs = (p.renames as Rename[]) ?? []
      if (rs.length === 0) out.push('名前を変える列を1つ以上指定してください')
      rs.forEach((r, i) => {
        const at = `${i + 1}つ目：`
        if (!r.source) out.push(`${at}元の列を選んでください`)
        else if (!has(r.source)) out.push(`${at}列「${r.source}」がありません`)
        if (!r.target.trim()) out.push(`${at}新しい名前を入力してください`)
      })
      const after = cols.map((c) => rs.find((r) => r.source === c.name)?.target || c.name)
      const dup = after.filter((n, i) => n && after.indexOf(n) !== i)
      if (dup.length) out.push(`名前を変えると「${[...new Set(dup)].join('」「')}」が重なります`)
      break
    }
    case 'join': {
      const jp = p as unknown as JoinParams
      const right = (inputs[1] ?? []) as Col[]
      ;(jp.keys ?? []).forEach((k, i) => {
        const at = (jp.keys.length > 1 ? `照合に使う列${i + 1}：` : '照合に使う列：')
        if (!k.left || !k.right) return out.push(`${at}元の表と付け加える表の列を選んでください`)
        const lt = typeOf(k.left)
        const rt = typeOf(k.right, right)
        if (!lt || !rt) return out.push(`${at}選んだ列がありません`)
        const num = (t: ColumnType) => NUMERIC.includes(t)
        if (lt !== rt && !(num(lt) && num(rt))) out.push(`${at}データの形式が違うため照合できません（元の表：${TYPE_JA[lt]}、付け加える表：${TYPE_JA[rt]}）`)
      })
      ;(jp.check_amount_columns ?? []).forEach((c) => {
        const t = typeOf(c)
        if (!t) out.push(`金額を確かめる列「${c}」がありません`)
        else if (!NUMERIC.includes(t)) out.push(`金額を確かめる列「${c}」は数値ではありません`)
      })
      if (!jp.right_suffix?.trim()) out.push('名前が重なった列に付ける文字を入力してください')
      break
    }
    case 'concat': {
      const cp = p as unknown as ConcatParams
      const all = inputs.flat() as Col[]
      if (cp.source_column !== null && cp.source_column !== undefined) {
        if (!cp.source_column.trim()) out.push('入力元を記録する列の名前を入力してください')
        else if (has(cp.source_column, all)) out.push(`入力元を記録する列「${cp.source_column}」は、すでにある列名です`)
      }
      break
    }
    case 'aggregate': {
      const ap = p as unknown as AggregateParams
      ;(ap.group_by ?? []).filter((n) => !has(n)).forEach((n) => out.push(`項目の列「${n}」がありません`))
      if (!ap.aggregations?.length) out.push('集計する内容を1つ以上追加してください')
      ;(ap.aggregations ?? []).forEach((a, i) => {
        const at = `集計${i + 1}：`
        if (a.function !== 'count' && !a.column) out.push(`${at}集計する列を選んでください`)
        if (a.column) {
          const t = typeOf(a.column)
          if (!t) out.push(`${at}列「${a.column}」がありません`)
          else if (!aggTypes(a.function).includes(t)) out.push(`${at}${TYPE_JA[t]}の列では「${AGG_LABEL[a.function]}」は使えません`)
        }
        if (!a.output_column.trim()) out.push(`${at}結果の列名を入力してください`)
      })
      const names = [...(ap.group_by ?? []), ...(ap.aggregations ?? []).map((a) => a.output_column)].filter(Boolean)
      const dup = names.filter((n, i) => names.indexOf(n) !== i)
      if (dup.length) out.push(`結果の列名「${[...new Set(dup)].join('」「')}」が重なっています`)
      break
    }
    case 'calculate': {
      const cp = p as unknown as CalculateParams
      if (!cp.output_column?.trim()) out.push('計算結果の列名を入力してください')
      else if (has(cp.output_column)) out.push(`列「${cp.output_column}」はすでにあります。別の名前にしてください`)
      for (const [side, o] of [['左', cp.expression?.left], ['右', cp.expression?.right]] as const) {
        if (!o) continue
        if (o.kind === 'column') {
          if (!o.column) out.push(`計算式の${side}側の列を選んでください`)
          else if (!has(o.column)) out.push(`列「${o.column}」がありません`)
          else if (!NUMERIC.includes(typeOf(o.column)!)) out.push(`列「${o.column}」は数値ではないため計算に使えません`)
        } else if (!NUMBER.test(o.value)) out.push(`計算式の${side}側の値は、数値（半角）で入力してください`)
      }
      break
    }
    case 'output': {
      const sheets = (p as unknown as OutputParams).sheets ?? []
      sheets.forEach((s, i) => {
        const at = `シート${i + 1}：`
        if (!s.sheet_name.trim()) out.push(`${at}シート名を入力してください`)
        else if (s.sheet_name.length > 31) out.push(`${at}シート名は31文字までです`)
        else if (/[[\]:*?/\\]/.test(s.sheet_name)) out.push(`${at}シート名に [ ] : * ? / \\ は使えません`)
      })
      const names = sheets.map((s) => s.sheet_name)
      if (names.some((n, i) => n && names.indexOf(n) !== i)) out.push('シート名が重なっています')
      break
    }
    case 'load':
      break
    default:
      out.push('この処理の設定画面は準備中です（次のタスクで作ります）')
  }
  return out
}

const TYPE_JA: Record<ColumnType, string> = { string: '文字', integer: '整数', decimal: '小数', date: '日付', boolean: 'はい／いいえ' }

/* ---------- 一覧に出す、具体的な処理内容 ---------- */

export function summarize(node: FlowNode): string | null {
  const p = node.parameters as Record<string, unknown>
  switch (node.node_type) {
    case 'filter': {
      const g = (p as unknown as FilterParams).condition
      if (!g?.conditions?.length) return null
      const parts = g.conditions.map((c) => (c.operator === 'is_empty' || c.operator === 'is_not_empty' ? `「${c.column}」が${OPERATOR_LABEL[c.operator]}` : `「${c.column}」が ${c.value ?? ''} ${OPERATOR_LABEL[c.operator]}`))
      const text = parts.join(g.logic === 'and' ? '、かつ ' : '、または ')
      return `${text}${/(以上|以下)$/.test(text) ? 'の' : ''}行だけ残す`
    }
    case 'select_columns': {
      const c = (p.columns as string[]) ?? []
      return c.length ? `${c.slice(0, 4).join('・')}${c.length > 4 ? ` など${c.length}列` : ''}を取り出す` : null
    }
    case 'rename_columns': {
      const rs = ((p.renames as Rename[]) ?? []).filter((r) => r.source && r.target)
      return rs.length ? rs.map((r) => `「${r.source}」を「${r.target}」に`).join('、') + '変える' : null
    }
    case 'join': {
      const keys = ((p as unknown as JoinParams).keys ?? []).filter((k) => k.left)
      return keys.length ? `${keys.map((k) => k.left).join('・')}を使って、情報を付け加える` : null
    }
    case 'concat':
      return `${node.input_references.length}つの表を縦にまとめる`
    case 'aggregate': {
      const ap = p as unknown as AggregateParams
      const aggs = (ap.aggregations ?? []).filter((a) => a.output_column)
      if (!aggs.length) return null
      const by = ap.group_by?.length ? `${ap.group_by.join('・')}ごとに` : '全体で'
      return `${by}${aggs.map((a) => (a.column ? `${a.column}の${AGG_LABEL[a.function]}` : '件数')).join('・')}を求める`
    }
    case 'calculate': {
      const cp = p as unknown as CalculateParams
      const side = (o: Operand) => (o.kind === 'column' ? o.column || '？' : o.value)
      return cp.output_column ? `「${cp.output_column}」＝ ${side(cp.expression.left)} ${CALC_LABEL[cp.expression.op].split(' ')[0]} ${side(cp.expression.right)}` : null
    }
    case 'output': {
      const s = ((p as unknown as OutputParams).sheets ?? []).map((x) => x.sheet_name).filter(Boolean)
      return s.length ? `「${s.join('」「')}」の${s.length}シートを出力する` : null
    }
    default:
      return null
  }
}
