import { describe, expect, it } from 'vitest'
import type { CriterionResult, RunSummary, Verdict } from '../api/flows'
import { nextAction } from './nextAction'

const verdict = (v: Verdict['verdict'], exp: Verdict['export']): Verdict => ({ verdict: v, standard_only: false, headline: '', reasons: [], export: exp, counts: {} })
const crit = (status: string, on_fail: string): CriterionResult => ({ criterion_id: 'c', name: '基準', kind: 'row_count', on_fail, status, summary: '', evidence: {}, examples: [], how_to_fix: null })
const run = (over: Partial<RunSummary>): RunSummary => ({
  run_id: 'r1',
  status: 'success',
  can_export: true,
  engine_version: '1',
  flow_hash: 'h',
  executed_at: '2026-11-16T10:00:00+09:00',
  duration_ms: 10,
  nodes: [],
  flow_issues: [],
  outputs: [],
  fingerprints: {},
  criteria: [],
  run_parameters: {},
  verdict: verdict('normal', 'allowed'),
  ...over,
})

describe('STEP 4：判定ごとの「今の状態」と「次に押すボタン」', () => {
  it('正常：次へ（出力・保存）', () => {
    expect(nextAction(run({}), false, false)).toMatchObject({ kind: 'next', button: '次へ：出力・保存', tone: 'mint', status: '正常：正式な出力ができます' })
  })

  it('注意・確認不要：次へ進める', () => {
    expect(nextAction(run({ verdict: verdict('caution', 'allowed') }), false, false)).toMatchObject({ kind: 'next', status: '注意：お知らせがあります（出力できます）' })
  })

  it('注意・確認必須：確認するまでは「注意事項を確認する」、確認したら「次へ」に切り替わる', () => {
    const r = run({ verdict: verdict('caution', 'needs_confirmation') })
    expect(nextAction(r, false, false)).toMatchObject({ kind: 'confirm', button: '注意事項を確認する', tone: 'amber', target: 'run-confirm' })
    expect(nextAction(r, true, false)).toMatchObject({ kind: 'next', status: '確認済み：出力できます' })
  })

  it('重大：異常の詳細へ（基準の不合格なら完了基準の判定、それ以外はステップごとの結果）。確認しても解除されない', () => {
    const r = run({ verdict: verdict('critical', 'report_only'), criteria: [crit('failed', 'critical')] })
    expect(nextAction(r, true, false)).toMatchObject({ kind: 'critical', button: '異常の詳細を確認する', tone: 'coral', target: 'run-criteria' })
    expect(nextAction(run({ verdict: verdict('critical', 'report_only') }), false, false).target).toBe('run-steps')
  })

  it('未検証（必須の基準）：未完了の検証へ。確認しても解除されない', () => {
    const r = run({ verdict: verdict('unverified', 'report_only'), criteria: [crit('unverified', 'critical')] })
    expect(nextAction(r, true, false)).toMatchObject({ kind: 'unverified', button: '未完了の検証を確認する', tone: 'amber', target: 'run-criteria' })
  })

  it('未検証（必須でない基準だけ）：既存の決まりどおり、確認してから次へ', () => {
    const r = run({ verdict: verdict('unverified', 'needs_confirmation') })
    expect(nextAction(r, false, false)).toMatchObject({ kind: 'confirm', status: '確かめられなかった基準があります。確認してから出力できます' })
    expect(nextAction(r, true, false).kind).toBe('next')
  })

  it('処理の失敗：エラーの詳細へ（正常と誤解させない）', () => {
    expect(nextAction(run({ status: 'failed', verdict: verdict('critical', 'report_only') }), false, false)).toMatchObject({ kind: 'failed', button: 'エラーの詳細を確認する', tone: 'coral', target: 'run-steps' })
  })

  it('作業手順を変えた後の古い結果は、判定にかかわらず再実行へ（古い結果で出力させない）', () => {
    expect(nextAction(run({}), true, true)).toMatchObject({ kind: 'stale', target: 'procedure' })
  })
})
