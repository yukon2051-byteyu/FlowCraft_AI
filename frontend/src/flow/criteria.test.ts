import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { advanceCriteriaVersion, applyTemplate, criterionProblems, describeCriterion, diffCriteria, KIND_ORDER, newCriterion, pruneRunParameters, refChoices, usedParamIds } from './criteria'
import { normalizeFlow } from './ops'
import type { Criterion, FlowDoc } from './types'

const DEMO: FlowDoc = normalizeFlow(JSON.parse(readFileSync(fileURLToPath(new URL('../../../backend/app/demos/flows/monthly_sales.json', import.meta.url)), 'utf-8')))
const withItems = (items: Criterion[], run_parameters = DEMO.run_parameters): FlowDoc => ({ ...DEMO, run_parameters, completion_criteria: { ...DEMO.completion_criteria, items } })

describe('対象の選択肢', () => {
  it('入力が対象の基準は入力だけ、照合の基準は結合のステップだけ', () => {
    expect(refChoices(DEMO, 'required_columns').map((r) => r.ref)).toEqual(['sales', 'products', 'depts'])
    expect(refChoices(DEMO, 'all_matched').map((r) => r.label)).toEqual(['ステップ4の結果：商品マスタの商品名・カテゴリを付け加える', 'ステップ6の結果：部署マスタの部署名を付け加える'])
    expect(refChoices(DEMO, 'row_count')).toHaveLength(8) // 出力以外の8ステップ
  })
})

describe('新しく作る', () => {
  it('11種類それぞれに、決まった初期値で作れる。IDは重ならない', () => {
    const items: Criterion[] = []
    for (const k of KIND_ORDER) items.push(newCriterion(withItems(items), k))
    expect(new Set(items.map((c) => c.criterion_id)).size).toBe(11)
    expect(items.find((c) => c.kind === 'list_rows')?.on_fail).toBe('record')
    expect(items.every((c) => c.origin === 'manual' && c.confirmation_status === 'confirmed')).toBe(true)
  })

  it('作ったばかりで設定が足りないものは、理由を示す', () => {
    const period = newCriterion(DEMO, 'period')
    expect(criterionProblems(period, DEMO)).toEqual(['確かめる列を選んでください', '対象の月を入れるか、「実行するたびに指定する」を選んでください'])
    const tm = newCriterion(DEMO, 'total_match')
    expect(criterionProblems(tm, DEMO)).toContain('比べる相手の結果を選んでください')
    expect(criterionProblems(newCriterion(DEMO, 'all_matched'), DEMO)).toEqual([]) // 許容0件で、そのまま使える
  })
})

describe('テンプレート「売上集計」', () => {
  const t = applyTemplate(DEMO, 'sales')
  const flow = withItems(t.items, t.parameters)

  it('作業手順の中身から、対象・列を推し当てる', () => {
    expect(t.items.map((c) => c.kind)).toEqual(['required_columns', 'period', 'all_matched', 'all_matched', 'total_match'])
    const period = t.items[1]
    expect(period.target).toEqual({ ref: 'sales', column: '売上日' }) // 最初の日付の列
    expect(period.params).toEqual({ month: { $param: 'target_month' } })
    expect(t.parameters).toEqual([{ param_id: 'target_month', label: '対象月', type: 'month', required: true }])
    const total = t.items[4]
    expect(total.target).toEqual({ ref: 'by_dept', column: '売上合計' })
    expect(total.params).toMatchObject({ compare_ref: 'sales_full', compare_column: '売上金額' })
    expect(t.items.every((c) => c.origin === 'template')).toBe(true)
  })

  it('推し当てられたものは、そのまま設定済みになる', () => {
    for (const c of t.items) expect(criterionProblems(c, flow)).toEqual([])
    expect(describeCriterion(t.items[1], flow, (id) => (id === 'target_month' ? '対象月' : id))).toBe('ステップ1の結果：売上実績を読み込む 「売上日」：実行時に指定（対象月）')
  })

  it('もう一度追加しても、IDは重ならない', () => {
    const again = applyTemplate(flow, 'sales')
    const ids = [...t.items, ...again.items].map((c) => c.criterion_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('値の形と、実行時に指定する値', () => {
  const ev = (value: unknown): Criterion => ({ criterion_id: 'c1', name: '確認用', kind: 'expected_value', target: { ref: 'by_dept', column: '売上合計' }, params: { measure: 'sum', value, tolerance: '0' }, on_fail: 'critical' })

  it('値の形が違えば理由を示す', () => {
    expect(criterionProblems(ev('二千万'), DEMO)).toEqual(['確認用の値は数値の形で入れてください'])
    expect(criterionProblems(ev('20,818,240'), DEMO)).toEqual([])
    const p = { criterion_id: 'c2', name: '期間', kind: 'period' as const, target: { ref: 'sales', column: '売上日' }, params: { month: '2026-13' }, on_fail: 'critical' as const }
    expect(criterionProblems(p, DEMO)).toEqual(['対象の月は「2026-10」の形で入れてください'])
  })

  it('実行時に指定する値がない・種類が違う', () => {
    expect(criterionProblems(ev({ $param: 'nothing' }), DEMO)).toEqual(['確認用の値に使う「実行時に指定する値」がありません'])
    const flow = withItems([], [{ param_id: 'm', label: '対象月', type: 'month' }])
    expect(criterionProblems(ev({ $param: 'm' }), flow)).toEqual(['確認用の値に、種類の違う「実行時に指定する値」（対象月）が選ばれています'])
  })

  it('使われなくなった「実行時に指定する値」は消す', () => {
    const params = [
      { param_id: 'm', label: '対象月', type: 'month' as const },
      { param_id: 'x', label: '使われていない', type: 'integer' as const },
    ]
    const items = [{ ...ev({ $param: 'm' }) }]
    expect([...usedParamIds(items)]).toEqual(['m'])
    expect(pruneRunParameters(params, items).map((p) => p.param_id)).toEqual(['m'])
  })

  it('列が対象の結果にない・列が必要なのに選んでいない', () => {
    expect(criterionProblems({ ...ev('1'), target: { ref: 'by_dept', column: '存在しない' } }, DEMO)).toEqual(['列「存在しない」は、選んだ結果にありません'])
    expect(criterionProblems({ ...ev('1'), target: { ref: 'by_dept', column: null } }, DEMO)).toEqual(['確かめる列を選んでください'])
    // 件数を確かめるときは列は不要
    expect(criterionProblems({ ...ev('4'), target: { ref: 'by_dept', column: null }, params: { measure: 'count', value: '4' } }, DEMO)).toEqual([])
  })
})

describe('完了基準の変更の記録（2-6）', () => {
  const base = applyTemplate(DEMO, 'sales').items
  const at = new Date('2026-12-01T00:00:00Z')

  it('追加・削除・変更（重さ・条件・対象・名前）を要約する。値の中身は書かない', () => {
    const changed = base.map((c, i) => (i === 0 ? { ...c, on_fail: 'caution' as const } : i === 1 ? { ...c, params: { month: '2026-10' } } : c)).slice(0, 4)
    const added = newCriterion(withItems(changed), 'row_count')
    expect(diffCriteria(base, [...changed, { ...added, name: '部署は4つ' }])).toEqual([
      '「必要な列がそろっている」：満たさないときを重大→注意に',
      '「対象月の伝票だけ」：条件を変更',
      '「部署は4つ」を追加',
      `「${base[4].name}」を削除`,
    ])
    expect(diffCriteria(base, base)).toEqual([])
  })

  it('初めての保存で基準があれば版1として記録し、変わったときだけ版を上げる', () => {
    const first = advanceCriteriaVersion(withItems(base), null, at)
    expect(first.completion_criteria.version).toBe(1)
    expect(first.completion_criteria.changelog).toEqual([{ version: 1, changed_at: '2026-12-01T00:00:00.000Z', summary: '完了基準を設定（5件）' }])
    // 変更なし → そのまま
    expect(advanceCriteriaVersion(first, base, at)).toBe(first)
    // 変更あり → 版2と要約
    const edited = { ...first, completion_criteria: { ...first.completion_criteria, items: base.slice(1) } }
    const second = advanceCriteriaVersion(edited, base, at)
    expect(second.completion_criteria.version).toBe(2)
    expect(second.completion_criteria.changelog.at(-1)).toEqual({ version: 2, changed_at: '2026-12-01T00:00:00.000Z', summary: '「必要な列がそろっている」を削除' })
    // 基準がない作業手順は記録しない
    expect(advanceCriteriaVersion(DEMO, null, at).completion_criteria.changelog).toEqual([])
  })

  it('品質ルールの版は、判定に関わる設定を変えたルールだけ上がる（名前・メモだけの変更では上げない。品質MVP）', () => {
    const saved = advanceCriteriaVersion(withItems(base), null, at)
    const [a, b, c] = saved.completion_criteria.items
    expect(new Set(saved.completion_criteria.items.map((x) => x.rule_id)).size).toBe(base.length) // ルールごとに別の識別
    const edited = withItems([{ ...a, on_fail: 'caution' }, { ...b, name: '名前だけ変更', note: 'メモ' }, c, ...saved.completion_criteria.items.slice(3)])
    const next = advanceCriteriaVersion(edited, saved.completion_criteria.items, at).completion_criteria.items
    expect(next.map((x) => [x.rule_id, x.rule_version])).toEqual(saved.completion_criteria.items.map((x, i) => [x.rule_id, i === 0 ? 2 : 1]))
    // 新しく追加したルールは版1で、新しい識別を持つ
    const added = newCriterion(saved, 'row_count')
    expect(added.rule_version).toBe(1)
    expect(saved.completion_criteria.items.some((x) => x.rule_id === added.rule_id)).toBe(false)
  })
})
