import { describe, expect, it } from 'vitest'
import type { Improvement, Scenario } from '../api/kaizen'
import fixture from './outcome.fixture.json'
import { buildOutcome } from './outcome'

// サーバー（backend/app/kaizen/build.py）が実際に作った改善の結果
const sc = fixture.scenario as unknown as Scenario
const imp = (k: 'all' | 'noAuto' | 'nothing') => fixture[k] as unknown as Improvement

describe('改善後の作業の進め方（実際の改善の結果から作る）', () => {
  it('自動化を採用しないとき：整理した成果と、人が続ける確認を伝える（失敗のように見せない）', () => {
    const o = buildOutcome(sc, imp('noAuto'))
    expect(o.headline).toBe('必要な作業を残し、手順を整理しました')
    expect(o.summary).toBe('7工程から6工程に整理し、重複していた転記作業をなくしました。元データとの合計照合など、必要な確認作業は引き続き人が実施します。')
    expect(o).toMatchObject({ stepsBefore: 7, stepsAfter: 6, automated: false, minutesBefore: 90, minutesAfter: 49 })
    expect(o.removed).toEqual(['同じ集計結果を会議用資料に転記する'])
    expect(o.keptChecks).toEqual(['元データとの合計照合'])
  })

  it('すべて採用したとき：確認は自動の検証として残す', () => {
    const o = buildOutcome(sc, imp('all'))
    expect(o).toMatchObject({ stepsBefore: 7, stepsAfter: 5, automated: true, minutesAfter: 20 })
    expect(o.summary).toContain('7工程から5工程に整理し')
    expect(o.summary).toContain('必要な確認は自動の検証として残しました。')
  })

  it('何も採用しないとき：整理したとは言わない', () => {
    const o = buildOutcome(sc, imp('nothing'))
    expect(o.headline).toBe('今の手順のまま進めます')
    expect(o.removed).toEqual([])
    expect(o.stepsAfter).toBe(7)
  })

  it('比較表（サーバーの comparison）と工程数・時間が食い違わない', () => {
    for (const k of ['all', 'noAuto', 'nothing'] as const) {
      const o = buildOutcome(sc, imp(k))
      const rows = Object.fromEntries(imp(k).comparison.map((r) => [r.item, r]))
      expect(rows['工程数'].after).toBe(`${o.stepsAfter}工程`)
      expect(rows['作業時間'].after).toBe(`毎月${o.minutesAfter}分`)
    }
  })
})
