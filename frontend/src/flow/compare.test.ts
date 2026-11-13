import { describe, expect, it } from 'vitest'
import type { CriterionResult, RunSummary } from '../api/flows'
import { compareRuns, keyValue } from './compare'

const crit = (id: string, kind: string, status: string, evidence: Record<string, string>, name = id): CriterionResult => ({
  criterion_id: id,
  name,
  kind,
  on_fail: 'critical',
  status,
  summary: '',
  evidence,
  examples: [],
  how_to_fix: null,
})

const run = (verdict: string, exportMode: string, criteria: CriterionResult[], status = 'success'): RunSummary =>
  ({
    run_id: 'r',
    status,
    can_export: exportMode !== 'report_only',
    criteria,
    verdict: { verdict, export: exportMode, standard_only: false, headline: '', reasons: [], counts: {} },
  }) as unknown as RunSummary

describe('直す前と後の比較（M1-3）', () => {
  it('総合判定・正式な出力・完了基準ごとの判定と要の値を並べ、良くなったものを示す', () => {
    const before = run('critical', 'report_only', [
      crit('c1', 'all_matched', 'failed', { 照合できない行: '6' }, '照合できない商品コードが0件'),
      crit('c2', 'total_match', 'passed', { 差額: '0' }, '集計前後の売上金額が一致'),
    ])
    const after = run('normal', 'allowed', [
      crit('c1', 'all_matched', 'passed', { 照合できない行: '0' }, '照合できない商品コードが0件'),
      crit('c2', 'total_match', 'passed', { 差額: '0' }, '集計前後の売上金額が一致'),
    ])
    expect(compareRuns(before, after)).toEqual([
      { label: '総合判定', before: '重大', after: '正常', trend: 'better' },
      { label: '正式な出力', before: '停止', after: '出力できる', trend: 'better' },
      { label: '照合できない商品コードが0件', before: '満たしていない（未照合 6行）', after: '満たしている（未照合 0行）', trend: 'better' },
      { label: '集計前後の売上金額が一致', before: '満たしている（差額 0）', after: '満たしている（差額 0）', trend: 'same' },
    ])
  })

  it('悪くなった場合も、そのまま示す', () => {
    const rows = compareRuns(run('normal', 'allowed', [crit('c1', 'period', 'passed', { 期間外の件数: '0' })]), run('critical', 'report_only', [crit('c1', 'period', 'failed', { 期間外の件数: '3' })]))
    expect(rows.map((r) => r.trend)).toEqual(['worse', 'worse', 'worse'])
  })

  it('要の値がない・未検証・相手にない基準', () => {
    expect(keyValue(undefined)).toBe('（なし）')
    expect(keyValue(crit('c', 'period', 'unverified', {}))).toBe('未検証')
    expect(keyValue(crit('c', 'unknown_kind', 'passed', {}))).toBe('満たしている')
  })
})
