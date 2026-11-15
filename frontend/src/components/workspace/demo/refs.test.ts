import { describe, expect, it } from 'vitest'
import type { SheetDetail } from '../../../api/files'
import type { InputDefinition } from '../../../flow/types'
import { isRuleStep, missingColumns, refLabel } from './refs'

const nodes = [
  { node_id: 'n1', node_name: '売上実績を読み込む' },
  { node_id: 'n2', node_name: '集計する' },
]
const criteria = [{ criterion_id: 'c1', name: '合計が一致' }]

describe('デモの説明と、実際の作業手順・データの対応', () => {
  it('処理ステップは作業手順の画面と同じ番号、完了基準は品質ルールとして示す', () => {
    expect(refLabel('n2', nodes, criteria)).toBe('ステップ2「集計する」')
    expect(refLabel('c1', nodes, criteria)).toBe('品質ルール「合計が一致」')
    expect(isRuleStep(['c1'], criteria)).toBe(true)
    expect(isRuleStep(['n1', 'c1'], criteria)).toBe(false)
  })

  it('作業手順が必ず使う列がファイルにあるか（任意の列は問わない）', () => {
    const def = { input_id: 'sales', label: '売上', file_kind: 'xlsx', columns: [{ name: '売上日', type: 'date' }, { name: '金額', type: 'integer' }, { name: '備考', type: 'string', required: false }] } as InputDefinition
    const detail = { columns: [{ name: '売上日' }] } as unknown as SheetDetail
    expect(missingColumns(def, detail)).toEqual(['金額'])
  })
})
