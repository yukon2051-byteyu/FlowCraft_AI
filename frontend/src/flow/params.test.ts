import { describe, expect, it } from 'vitest'
import { newStep, setInputs } from './ops'
import { defaultParams, inferColumns, paramProblems, summarize } from './params'
import type { Col } from './params'
import type { FlowNode, InputDefinition } from './types'

/*
 * タスク1-4：処理ステップの設定。
 * 列の計算は処理エンジン（backend/app/engine/nodes）の決まりと同じであることを確かめる。
 */

const defs: InputDefinition[] = [
  {
    input_id: 'in1',
    label: '売上実績',
    file_kind: 'xlsx',
    columns: [
      { name: '売上日', type: 'date' },
      { name: '商品コード', type: 'string' },
      { name: '数量', type: 'integer' },
      { name: '売上金額', type: 'integer' },
    ],
  },
  { input_id: 'in2', label: '商品マスタ', file_kind: 'xlsx', columns: [{ name: '商品コード', type: 'string' }, { name: '商品名', type: 'string' }, { name: '単価', type: 'decimal' }] },
]

const node = (id: string, type: FlowNode['node_type'], inputs: string[], out: string | null, parameters: Record<string, unknown>): FlowNode => ({
  node_id: id,
  node_type: type,
  node_name: id,
  parameters,
  input_references: inputs,
  output_reference: out,
  confirmation_status: 'unset',
  open_questions: [],
})

const load1 = node('n1', 'load', [], 'in1', { input_id: 'in1' })
const load2 = node('n2', 'load', [], 'in2', { input_id: 'in2' })
const join = node('n3', 'join', ['in1', 'in2'], 'r1', { ...defaultParams('join'), keys: [{ left: '商品コード', right: '商品コード' }] })
const agg = node('n4', 'aggregate', ['r1'], 'r2', {
  group_by: ['商品名'],
  aggregations: [
    { function: 'sum', column: '売上金額', output_column: '売上合計', scale: null, rounding: 'half_up' },
    { function: 'mean', column: '数量', output_column: '平均数量', scale: null, rounding: 'half_up' },
    { function: 'count', column: null, output_column: '件数', scale: null, rounding: 'half_up' },
  ],
})
const flow = { nodes: [load1, load2, join, agg], input_definitions: defs }
const names = (cols: Col[] | null) => cols?.map((c) => `${c.name}:${c.type}`)

describe('各ステップで使える列（処理エンジンと同じ決まり）', () => {
  const cols = inferColumns(flow)

  it('読み込み：入力の定義の列', () => {
    expect(names(cols.in1)).toEqual(['売上日:date', '商品コード:string', '数量:integer', '売上金額:integer'])
  })

  it('結合：元の表の列 → 付け加える表の列（照合に使う列は除く）', () => {
    expect(names(cols.r1)).toEqual(['売上日:date', '商品コード:string', '数量:integer', '売上金額:integer', '商品名:string', '単価:decimal'])
  })

  it('集計：項目の列 → 結果の列（合計は元の形式、平均は小数、件数は整数）', () => {
    expect(names(cols.r2)).toEqual(['商品名:string', '売上合計:integer', '平均数量:decimal', '件数:integer'])
  })

  it('結合で名前が重なる列には、指定した文字を付ける', () => {
    const j = node('n3', 'join', ['in1', 'in2'], 'r1', { ...defaultParams('join'), keys: [{ left: '売上日', right: '商品名' }] })
    const c = inferColumns({ nodes: [load1, load2, j], input_definitions: defs })
    expect(c.r1?.map((x) => x.name)).toContain('商品コード_右')
  })

  it('上流の設定が分からないときは null（推測しない）', () => {
    const broken = { nodes: [load1, node('n5', 'filter', ['zz'], 'r9', defaultParams('filter'))], input_definitions: defs }
    expect(inferColumns(broken).r9).toBeNull()
  })
})

describe('設定の不足・誤り', () => {
  const cols = inferColumns(flow)
  const inputs = (n: FlowNode) => n.input_references.map((r) => cols[r] ?? null)

  it('完成した設定には問題がない', () => {
    expect(paramProblems(join, inputs(join))).toEqual([])
    expect(paramProblems(agg, inputs(agg))).toEqual([])
  })

  it('条件で残す：条件なし・値の形式違い・使えない比べ方', () => {
    const f = (conditions: unknown[]) => node('f', 'filter', ['in1'], 'r', { condition: { kind: 'group', logic: 'and', conditions } })
    expect(paramProblems(f([]), [cols.in1])).toEqual(['条件を1つ以上追加してください'])
    expect(paramProblems(f([{ kind: 'condition', column: '売上金額', operator: 'ge', value: '１０００' }]), [cols.in1])).toEqual(['条件1：数値（半角）で入力してください'])
    expect(paramProblems(f([{ kind: 'condition', column: '商品コード', operator: 'gt', value: 'P' }]), [cols.in1])).toEqual(['条件1：この列では「より大きい」は使えません'])
    expect(paramProblems(f([{ kind: 'condition', column: '売上日', operator: 'ge', value: '2026-10-01' }]), [cols.in1])).toEqual([])
  })

  it('結合：形式の違う列では照合できない（整数と小数はよい）', () => {
    const j = node('j', 'join', ['in1', 'in2'], 'r', { ...defaultParams('join'), keys: [{ left: '売上日', right: '商品コード' }] })
    expect(paramProblems(j, [cols.in1, cols.in2])[0]).toContain('データの形式が違うため照合できません（元の表：日付、付け加える表：文字）')
    const ok = node('j', 'join', ['in1', 'in2'], 'r', { ...defaultParams('join'), keys: [{ left: '数量', right: '単価' }] })
    expect(paramProblems(ok, [cols.in1, cols.in2])).toEqual([])
  })

  it('集計：文字の列は合計できない／結果の列名の重なり', () => {
    const a = node('a', 'aggregate', ['in1'], 'r', {
      group_by: ['商品コード'],
      aggregations: [{ function: 'sum', column: '商品コード', output_column: '商品コード', scale: null, rounding: 'half_up' }],
    })
    expect(paramProblems(a, [cols.in1])).toEqual(['集計1：文字の列では「合計」は使えません', '結果の列名「商品コード」が重なっています'])
  })

  it('計算：既存の列名は使えない・文字の列は計算に使えない', () => {
    const c = node('c', 'calculate', ['in1'], 'r', {
      ...defaultParams('calculate'),
      output_column: '数量',
      expression: { kind: 'operation', op: 'multiply', left: { kind: 'column', column: '商品コード' }, right: { kind: 'constant', value: '1.1' } },
    })
    expect(paramProblems(c, [cols.in1])).toEqual(['列「数量」はすでにあります。別の名前にしてください', '列「商品コード」は数値ではないため計算に使えません'])
  })

  it('出力：シート名の文字数・使えない文字・重なり', () => {
    const o = node('o', 'output', ['in1', 'in2'], null, { sheets: [{ reference: 'in1', sheet_name: '売上/明細' }, { reference: 'in2', sheet_name: '' }] })
    expect(paramProblems(o, [cols.in1, cols.in2])).toEqual(['シート1：シート名に [ ] : * ? / \\ は使えません', 'シート2：シート名を入力してください'])
  })

  it('上流が未完成なら、列が分からないことを理由として示す', () => {
    const f = node('f', 'filter', ['r9'], 'r', defaultParams('filter'))
    expect(paramProblems(f, [null])).toEqual(['使うデータのステップの設定が終わっていないため、列が分かりません'])
  })
})

describe('使うデータとの同期（縦にまとめる・出力）', () => {
  it('出力を追加すると、すぐ上の結果のシートが用意され、シート名はステップの名前', () => {
    const s = newStep([load1, load2, join, { ...agg, node_name: '商品別に集計する' }], 'output', 4, 'Excelに出力する')
    expect(s.parameters).toEqual({ sheets: [{ reference: 'r2', sheet_name: '商品別に集計する' }] })
  })

  it('使うデータを増やす・入れ替えると、設定の並びも同じ順になり、入力済みの名前は残る', () => {
    const out = { ...node('n5', 'output', ['r2'], null, { sheets: [{ reference: 'r2', sheet_name: '商品別' }] }) }
    const r = setInputs([load1, load2, join, agg, out], 'n5', ['r1', 'r2'])
    expect('nodes' in r && r.nodes[4].parameters).toEqual({ sheets: [{ reference: 'r1', sheet_name: 'n3' }, { reference: 'r2', sheet_name: '商品別' }] })
  })
})

describe('一覧に出す処理内容', () => {
  it('業務の言葉で、具体的な内容を示す', () => {
    expect(summarize(join)).toBe('商品コードを使って、情報を付け加える')
    expect(summarize(agg)).toBe('商品名ごとに売上金額の合計・数量の平均・件数を求める')
    expect(summarize(node('f', 'filter', ['in1'], 'r', { condition: { kind: 'group', logic: 'and', conditions: [{ kind: 'condition', column: '売上金額', operator: 'ge', value: '1000' }] } }))).toBe(
      '「売上金額」が 1000 以上の行だけ残す',
    )
    expect(summarize(node('f', 'filter', ['in1'], 'r', defaultParams('filter')))).toBeNull()
  })
})
