import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { criterionProblems } from './criteria'
import { normalizeFlow } from './ops'
import { suggestCriteria, suggestionsToCriteria } from './suggest'
import type { FlowDoc } from './types'

const load = (name: string): FlowDoc => normalizeFlow(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../backend/app/demos/flows/${name}`, import.meta.url)), 'utf-8')))
// 完了基準をまだ決めていない作業手順として使う
const bare = (f: FlowDoc): FlowDoc => ({ ...f, completion_criteria: { ...f.completion_criteria, items: [], dismissed_suggestions: [] }, run_parameters: [] })
const SALES = bare(load('demo_monthly_sales.json'))
const INVENTORY = bare(load('demo_inventory.json'))

describe('処理手順から品質チェックを提案する', () => {
  it('マスタ照合（結合）から、照合できない行の確認と、照合キーの空欄の確認を提案する', () => {
    const s = suggestCriteria(SALES)
    const matched = s.filter((x) => x.kind === 'all_matched')
    expect(matched.map((x) => x.target.ref)).toEqual(['sales_p', 'sales_full'])
    expect(matched[0].reason).toContain('ステップ4「')
    // 許容件数は業務で決めること：仮の値を入れて「要確認」にする（根拠なく正解として決めない）
    expect(matched[0]).toMatchObject({ pending: true, params: { max_count: 0 } })
    expect(matched[0].needsUser[0]).toContain('許容する件数')
    expect(s.find((x) => x.kind === 'no_blank' && x.target.column === '商品コード')).toMatchObject({ target: { ref: 'sales_selected' }, pending: false })
  })

  it('集計の端数処理：整数の列を丸めても値は変わらないので要確認にしない', () => {
    const f: FlowDoc = {
      ...SALES,
      input_definitions: SALES.input_definitions.map((d) => ({ ...d, columns: d.columns.map((c) => (c.name === '売上金額' ? { ...c, type: 'integer' as const } : c)) })),
    }
    expect(suggestCriteria(f).filter((x) => x.kind === 'total_match').every((x) => !x.pending)).toBe(true)
  })

  it('集計から、集計前後の合計の一致を提案する（比べる相手は集計前の列）', () => {
    const t = suggestCriteria(SALES).filter((x) => x.kind === 'total_match')
    expect(t.map((x) => [x.target.ref, x.target.column, x.params.compare_ref, x.params.compare_column])).toEqual([
      ['by_dept', '売上合計', 'sales_full', '売上金額'],
      ['by_category', '売上合計', 'sales_full', '売上金額'],
    ])
  })

  it('絞り込み・計算からも提案する（0件でないこと・計算結果の空欄）', () => {
    const s = suggestCriteria(INVENTORY)
    expect(s.find((x) => x.kind === 'row_count')).toMatchObject({ target: { ref: 'gaps' }, params: { min: 1, max: null } })
    expect(s.filter((x) => x.kind === 'no_blank' && x.name.startsWith('計算結果')).map((x) => x.target.column)).toEqual(['理論在庫', '差異'])
  })

  it('存在しない列を参照する候補は作らない（どの候補も、対象の列が実際にある）', () => {
    for (const f of [SALES, INVENTORY]) {
      for (const c of suggestionsToCriteria(f, suggestCriteria(f)).items) {
        expect(criterionProblems(c, f).filter((m) => m.includes('ありません') || m.includes('選んでください'))).toEqual([])
      }
    }
  })

  it('既にある基準と同じ候補・「提案しない」とした候補は出さない。同じ候補を2回出さない', () => {
    const all = suggestCriteria(SALES)
    const keys = all.map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
    const added = suggestionsToCriteria(SALES, all.slice(0, 1)).items
    const withOne: FlowDoc = { ...SALES, completion_criteria: { ...SALES.completion_criteria, items: added } }
    expect(suggestCriteria(withOne).map((x) => x.key)).not.toContain(all[0].key)
    const dismissed: FlowDoc = { ...SALES, completion_criteria: { ...SALES.completion_criteria, dismissed_suggestions: [all[1].key] } }
    expect(suggestCriteria(dismissed).map((x) => x.key)).not.toContain(all[1].key)
    // デモの作業手順（既に照合・合計の基準がある）では、その分は提案しない
    expect(suggestCriteria(load('demo_monthly_sales.json')).map((x) => x.key)).not.toContain('all_matched:sales_p:')
  })

  it('追加した基準は「提案から追加」。仮の値を入れたものは要確認、それ以外は設定済み', () => {
    const { items } = suggestionsToCriteria(SALES, suggestCriteria(SALES))
    expect(items.every((c) => c.origin === 'suggested')).toBe(true)
    expect(items.filter((c) => c.kind === 'all_matched').every((c) => c.confirmation_status === 'pending')).toBe(true)
    // 空欄がない（0件）は意味から決まるので設定済み
    expect(items.filter((c) => c.kind === 'no_blank').every((c) => c.confirmation_status === 'confirmed')).toBe(true)
    // 「売上金額」は小数の列で、集計で0桁に丸めている：合計がずれうるので、許容差（仮に0）は要確認
    expect(items.filter((c) => c.kind === 'total_match').every((c) => c.confirmation_status === 'pending')).toBe(true)
    expect(new Set(items.map((c) => c.criterion_id)).size).toBe(items.length)
  })

  it('処理手順を変えて対象のステップがなくなった基準は、設定の不足として検出する（設定済みのままにしない）', () => {
    const { items } = suggestionsToCriteria(SALES, suggestCriteria(SALES).filter((x) => x.kind === 'total_match'))
    const changed: FlowDoc = { ...SALES, nodes: SALES.nodes.filter((n) => n.output_reference !== 'by_dept'), completion_criteria: { ...SALES.completion_criteria, items } }
    expect(criterionProblems(items[0], changed)).toContain('確かめる結果（ステップ）を選んでください')
    expect(criterionProblems(items[1], changed)).toEqual([])
  })
})
