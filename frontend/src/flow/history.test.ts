import { describe, expect, it } from 'vitest'
import { anomalyCount, exportPayload, filterHistory, historyToSend, overflow, parseImport } from './history'
import type { RunRecord } from './history'

const rec = (over: Partial<RunRecord>): RunRecord => ({
  record_version: 1,
  run_id: 'r1',
  source: 'manual',
  executed_at: '2026-11-01T00:00:00Z',
  duration_ms: 1,
  flow_id: 'F',
  flow_name: '月次売上集計',
  flow_version: 1,
  period: '2026-10',
  inputs: [],
  outputs: [],
  processing_status: 'completed',
  verdict: 'normal',
  verdict_headline: null,
  rules: [],
  official_output: { mode: 'allowed', performed: false, performed_at: null, stop_reason: null },
  metrics: [],
  ...over,
})

describe('実行の履歴（このブラウザ）', () => {
  it('サーバーへ送るのは、同じ作業手順の新しいものから最大24件', () => {
    const many = Array.from({ length: 30 }, (_, i) => rec({ run_id: `r${i}`, executed_at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
    const sent = historyToSend([...many, rec({ run_id: 'other', flow_id: 'G' }), rec({ run_id: 'old', record_version: 0 })], 'F')
    expect(sent).toHaveLength(24)
    expect(sent[0].run_id).toBe('r29')
    expect(sent.some((r) => r.flow_id !== 'F' || r.run_id === 'old')).toBe(false)
  })

  it('作業手順ごとに最新200件を超えた分を、古いものから消す', () => {
    const list = Array.from({ length: 5 }, (_, i) => rec({ run_id: `a${i}`, executed_at: `2026-11-0${i + 1}T00:00:00Z` }))
    expect(overflow(list, 3).sort()).toEqual(['a0', 'a1'])
    expect(overflow([...list, rec({ run_id: 'b', flow_id: 'G' })], 5)).toEqual([])
  })

  it('絞り込み（作業手順・対象期間・判定）と、異常の件数', () => {
    const list = [rec({ run_id: 'x', verdict: 'critical', rules: [{ criterion_id: 'c', rule_id: 'r', rule_version: 1, name: 'n', kind: 'period', on_fail: 'critical', status: 'failed', summary: '', anomaly_count: 3 }] }), rec({ run_id: 'y', period: '2026-11' })]
    expect(filterHistory(list, { verdict: 'critical' }).map((r) => r.run_id)).toEqual(['x'])
    expect(filterHistory(list, { period: '2026-11' }).map((r) => r.run_id)).toEqual(['y'])
    expect(anomalyCount(list[0])).toBe(1)
  })

  it('書き出し → 取り込み：形を確かめ、同じ実行IDは取り込まず、取り込んだ印を付ける', () => {
    const text = exportPayload([rec({ run_id: 'a' }), rec({ run_id: 'b' })])
    const got = parseImport(text, new Set(['a']))
    expect(got.error).toBeNull()
    expect(got.records.map((r) => r.run_id)).toEqual(['b'])
    expect(got.records[0].imported).toBe(true)
    expect(got.skipped).toBe(1)
    expect(parseImport('{', new Set()).error).toContain('JSON')
    expect(parseImport('{"kind":"other"}', new Set()).error).toContain('履歴のファイルではありません')
    const broken = JSON.stringify({ kind: 'flowcraft-run-history', records: [{ run_id: 'z' }] })
    expect(parseImport(broken, new Set())).toMatchObject({ records: [], skipped: 1 })
  })
})
