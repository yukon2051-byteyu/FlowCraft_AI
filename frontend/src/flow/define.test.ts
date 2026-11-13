import { describe, expect, it } from 'vitest'
import { buildFromChoices, undecidedBlanks, choiceProblems, suggestLabel } from './define'
import type { InputChoice } from './define'
import { checkOrder, describeInputs } from './ops'
import { useFlowStore } from './store'

describe('入力の名前の候補（ファイル名から年月を取り除く）', () => {
  it.each([
    ['売上実績_2026-10.xlsx', '売上実績'],
    ['売上実績_202610.xlsx', '売上実績'],
    ['売上実績（2026年10月）.xlsx', '売上実績'],
    ['202610_在庫台帳.csv', '在庫台帳'],
    ['勤怠_10月分.xlsx', '勤怠'],
    ['売上実績_2026-10-31.xlsx', '売上実績'],
    ['商品マスタ.xlsx', '商品マスタ'],
    ['部署マスタ.csv', '部署マスタ'],
    ['2026-10.xlsx', '2026-10'], // 名前が残らない場合は、元のファイル名のまま
  ])('%s → %s', (file, label) => {
    expect(suggestLabel(file)).toBe(label)
  })
})

const choice = (over: Partial<InputChoice> = {}): InputChoice => ({
  fileId: 'f1',
  fileName: '売上実績_2026-10.xlsx',
  kind: 'xlsx',
  sheet: '売上',
  headerRow: 1,
  label: '売上実績',
  columns: [
    { name: '商品コード', use: true, type: 'string', required: true },
    { name: '金額', use: true, type: 'integer', required: true },
    { name: '備考', use: false, type: 'string', required: false },
  ],
  ...over,
})

describe('作る前の確認', () => {
  it('問題がなければ空', () => {
    expect(choiceProblems([choice()], {})).toEqual([])
  })

  it('名前が空・使う列がない・変換できない値がある・名前の重複', () => {
    expect(choiceProblems([choice({ label: ' ' })], {})[0]).toContain('入力の名前を入れて')
    expect(choiceProblems([choice({ columns: [] })], {})[0]).toContain('使う列を1つ以上')
    expect(choiceProblems([choice()], { f1: ['商品コード'] })[0]).toContain('「商品コード」に、選んだ形式にできない値')
    const two = [choice(), choice({ fileId: 'f2', fileName: '売上実績_2026-11.xlsx' })]
    expect(choiceProblems(two, {})).toEqual([expect.stringContaining('「売上実績」が重なって')])
  })
})

describe('入力の定義・割当・読み込みステップを作る', () => {
  const csv = choice({
    fileId: 'f3',
    fileName: '部署マスタ.csv',
    kind: 'csv',
    sheet: 'CSV',
    label: '部署マスタ',
    columns: [{ name: '部署コード', use: true, type: 'string', required: true }],
  })
  const built = buildFromChoices([choice(), csv])

  it('使う列だけを、選んだ形式で定義する（先頭0のコードは文字のまま）', () => {
    expect(built.definitions[0]).toEqual({
      input_id: 'in1',
      label: '売上実績',
      file_kind: 'xlsx',
      sheet_hint: '売上',
      header_row: 1,
      columns: [
        { name: '商品コード', type: 'string', required: true },
        { name: '金額', type: 'integer', required: true },
      ],
      // 空白の扱い（Phase Q）：決めていなければ初期値（未定義・空白文字は空欄として扱う）
      blank_rules: { blank_rows: 'unset', whitespace_is_blank: true, last_row: 'unset' },
    })
    expect(built.definitions[1].sheet_hint).toBeNull() // CSVにシートはない
  })

  it('空欄の扱いを決めた列は、作業手順に保存する。決めていないことを一覧にする（Phase Q-4）', () => {
    const c = choice()
    c.columns = c.columns.map((x) => (x.name === '金額' ? { ...x, blank: 'critical' as const } : x))
    c.blankRules = { blank_rows: 'skip', whitespace_is_blank: true, last_row: 'unset' }
    const def = buildFromChoices([c]).definitions[0]
    expect(def.columns.find((x) => x.name === '金額')?.blank).toEqual({ action: 'critical' })
    expect(def.columns.find((x) => x.name === '商品コード')?.blank).toBeUndefined()
    expect(def.blank_rules?.blank_rows).toBe('skip')
    // 必須の列「商品コード」に空欄があり未定義、最後の行も未定義。空白行は決めてある。金額は決めてある
    expect(undecidedBlanks(c, { columns: { 商品コード: 2, 金額: 1 }, middleRows: 3, lastRow: true })).toEqual([
      `「${c.fileName}」の「商品コード」の空欄の扱い`,
      `「${c.fileName}」の最後の行（合計・メモの可能性）の扱い`,
    ])
    // 任意の列の空欄は聞かない
    c.columns = c.columns.map((x) => ({ ...x, required: false }))
    expect(undecidedBlanks(c, { columns: { 商品コード: 2 }, middleRows: 0, lastRow: false })).toEqual([])
  })

  it('入力の割当はファイルIDを持つが、定義には入らない', () => {
    expect(built.bindings[0]).toEqual({ input_id: 'in1', file_id: 'f1', sheet: '売上', header_row: 1, column_mapping: {} })
    expect(JSON.stringify(built.definitions)).not.toContain('f1')
  })

  it('読み込みステップが確認済みで並び、決まりを満たす', () => {
    expect(built.loadNodes.map((n) => n.node_name)).toEqual(['売上実績を読み込む', '部署マスタを読み込む'])
    useFlowStore.getState().newFlow('テスト')
    useFlowStore.getState().startFromInputs(built.definitions, built.bindings, built.loadNodes)
    const s = useFlowStore.getState()
    expect(s.flow.nodes.map((n) => n.node_id)).toEqual(['n1', 'n2'])
    expect(s.bindings.in2.file_id).toBe('f3')
    expect(checkOrder(s.flow.nodes)).toEqual({ ok: true })
    expect(describeInputs(s.flow.nodes, 1, { in1: '売上実績', in2: '部署マスタ' })).toEqual(['読み込むファイル：部署マスタ'])
  })
})
