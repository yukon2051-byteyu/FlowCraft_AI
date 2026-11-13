/*
 * M1-3：2回の実行結果（直す前・直した後）を並べて比べる。
 * 比べるのは、総合判定・正式な出力・完了基準ごとの判定と要の値。値はすべて実際の実行結果から取る。
 */

import type { CriterionResult, RunSummary } from '../api/flows'

export type CompareRow = {
  label: string
  before: string
  after: string
  /** 良くなった／悪くなった／変わらない */
  trend: 'better' | 'worse' | 'same'
}

const VERDICT_LABEL: Record<string, string> = { normal: '正常', caution: '注意', unverified: '未検証', critical: '重大' }
const VERDICT_RANK: Record<string, number> = { normal: 0, caution: 1, unverified: 2, critical: 3 }
const STATUS_LABEL: Record<string, string> = { passed: '満たしている', failed: '満たしていない', unverified: '未検証', recorded: '記録', not_applicable: '対象外' }
const STATUS_RANK: Record<string, number> = { passed: 0, recorded: 0, not_applicable: 0, unverified: 1, failed: 2 }

/** 種類ごとの「要の値」（Excel の一覧の「結果」と同じ考え方。backend/app/export/report.py） */
const KEY_EVIDENCE: Record<string, [string, (v: string) => string]> = {
  period: ['期間外の件数', (v) => `期間外 ${v}件`],
  all_matched: ['照合できない行', (v) => `未照合 ${v}行`],
  no_blank: ['空欄の件数', (v) => `空欄 ${v}件`],
  unique: ['重複している行', (v) => `重複 ${v}`],
  value_range: ['範囲外の件数', (v) => `範囲外 ${v}件`],
  row_count: ['件数', (v) => `${v}件`],
  total_match: ['差額', (v) => `差額 ${v}`],
  expected_value: ['差', (v) => `差 ${v}`],
  required_columns: ['足りない列', (v) => `足りない列：${v}`],
  data_type: ['変換できない件数', (v) => `形式に合わない値 ${v}件`],
  list_rows: ['該当件数', (v) => `該当 ${v}件`],
}

export function keyValue(c: CriterionResult | undefined): string {
  if (!c) return '（なし）'
  if (c.status === 'unverified') return '未検証'
  const entry = KEY_EVIDENCE[c.kind]
  const v = entry ? c.evidence[entry[0]] : undefined
  const status = STATUS_LABEL[c.status] ?? c.status
  return v !== undefined ? `${status}（${entry[1](v)}）` : status
}

function officialOutput(r: RunSummary): string {
  if (r.status === 'failed' || r.verdict?.export === 'report_only') return '停止'
  if (r.verdict?.export === 'needs_confirmation') return '確認したうえで出力できる'
  return '出力できる'
}
const OUTPUT_RANK: Record<string, number> = { 出力できる: 0, 確認したうえで出力できる: 1, 停止: 2 }

const trendOf = (b: number, a: number): CompareRow['trend'] => (a < b ? 'better' : a > b ? 'worse' : 'same')

export function compareRuns(before: RunSummary, after: RunSummary): CompareRow[] {
  const rows: CompareRow[] = []
  const vb = before.verdict?.verdict ?? 'critical'
  const va = after.verdict?.verdict ?? 'critical'
  rows.push({ label: '総合判定', before: VERDICT_LABEL[vb] ?? vb, after: VERDICT_LABEL[va] ?? va, trend: trendOf(VERDICT_RANK[vb] ?? 3, VERDICT_RANK[va] ?? 3) })
  const ob = officialOutput(before)
  const oa = officialOutput(after)
  rows.push({ label: '正式な出力', before: ob, after: oa, trend: trendOf(OUTPUT_RANK[ob], OUTPUT_RANK[oa]) })
  const afterById = new Map(after.criteria.map((c) => [c.criterion_id, c]))
  for (const b of before.criteria) {
    const a = afterById.get(b.criterion_id)
    // 判定が変わったときだけ、良くなった／悪くなったを示す（記録の件数が変わっただけなら「変わらない」）
    const trend = !a || b.status === a.status ? 'same' : trendOf(STATUS_RANK[b.status] ?? 1, STATUS_RANK[a.status] ?? 1)
    rows.push({ label: b.name, before: keyValue(b), after: keyValue(a), trend })
  }
  return rows
}
