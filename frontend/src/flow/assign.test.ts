import { describe, expect, it } from 'vitest'
import { assignProblems, checkColumns, suggestAssignments } from './assign'
import type { InputDefinition } from './types'

const SALES: InputDefinition = {
  input_id: 'in1',
  label: '売上実績',
  file_kind: 'xlsx',
  sheet_hint: '売上',
  header_row: 1,
  columns: [
    { name: '売上日', type: 'date', required: true },
    { name: '売上金額', type: 'integer', required: true },
    { name: '備考', type: 'string', required: false },
  ],
}
const DEPT: InputDefinition = { input_id: 'in2', label: '部署マスタ', file_kind: 'csv', columns: [{ name: '部署コード', type: 'string', required: true }] }

describe('列の確かめ', () => {
  it('必須の列がない・任意の列がない・定義にない列がある、を分けて返す', () => {
    expect(checkColumns(SALES, ['売上日', '金額', 'メモ'])).toEqual({ missingRequired: ['売上金額'], missingOptional: ['備考'], extra: ['金額', 'メモ'] })
    expect(checkColumns(SALES, ['売上日', '売上金額', '備考'])).toEqual({ missingRequired: [], missingOptional: [], extra: [] })
  })
})

describe('割り当てるファイルの候補', () => {
  it('年月を除いたファイル名が入力の名前と同じものを選ぶ', () => {
    const files = [
      { file_id: 'f1', filename: '売上実績_2026-11.xlsx', kind: 'xlsx' as const },
      { file_id: 'f2', filename: '部署マスタ.csv', kind: 'csv' as const },
    ]
    expect(suggestAssignments([SALES, DEPT], files)).toEqual({ in1: 'f1', in2: 'f2' })
  })

  it('候補が2つあるときは選ばない（曖昧なまま勝手に選ばない）', () => {
    const files = [
      { file_id: 'f1', filename: '売上実績_2026-10.xlsx', kind: 'xlsx' as const },
      { file_id: 'f2', filename: '売上実績_2026-11.xlsx', kind: 'xlsx' as const },
    ]
    expect(suggestAssignments([SALES], files)).toEqual({})
  })

  it('ファイルの種類が違えば選ばない', () => {
    expect(suggestAssignments([SALES], [{ file_id: 'f1', filename: '売上実績.csv', kind: 'csv' }])).toEqual({})
  })
})

describe('割当を確定できない理由', () => {
  const names = { f1: '売上_11月.xlsx', f2: '部署.csv' }
  it('未選択・必須の列の不足・同じファイルの重複を示す', () => {
    expect(assignProblems([SALES, DEPT], { in1: { fileId: 'f1', columns: ['売上日'] } }, names)).toEqual([
      '「売上実績」に選んだ「売上_11月.xlsx」に、必須の列「売上金額」がありません',
      '「部署マスタ」に使うファイルを選んでください',
    ])
    expect(
      assignProblems([SALES, DEPT], { in1: { fileId: 'f1', columns: ['売上日', '売上金額'] }, in2: { fileId: 'f1', columns: ['部署コード'] } }, names),
    ).toEqual(['「売上_11月.xlsx」を2つの入力に選んでいます。入力ごとに別のファイルを選んでください'])
  })

  it('任意の列がないだけなら確定できる', () => {
    expect(assignProblems([SALES], { in1: { fileId: 'f1', columns: ['売上日', '売上金額'] } }, names)).toEqual([])
  })
})
