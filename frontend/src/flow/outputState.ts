import type { CriterionResult, EngineIssue, RunSummary } from '../api/flows'
import type { FlowDoc } from './types'

/*
 * 結果画面の「正式な出力ができるか」と「異常の原因と対応」（レビュー指摘 1・2。2026-11-17）。画面から切り離した関数。
 * - 出力可否は、サーバーの判定（verdict.export・処理の失敗）だけから決める。ヘッダー・本文・画面下部・出力の画面で同じものを使う
 * - 原因の名前・行数・例・直し方は、実行結果（完了基準の根拠・処理ステップのお知らせ）から取る。画面で推測しない
 */

export const REPORT_EXPORT_LABEL = '調査用レポートをExcelに出力'
export const OFFICIAL_EXPORT_LABEL = 'Excelに出力'

export type OutputState = {
  /** allowed：そのまま出力／confirm：確認したうえで出力／stopped：正式な出力を止める（調査用レポートだけ） */
  mode: 'allowed' | 'confirm' | 'stopped'
  /** 出力ボタンの名前（どの入口でも同じ） */
  exportLabel: string
  /** 止めたときの先頭の見出し（例：照合漏れ6行・正式出力停止）。止めていなければ null */
  headline: string | null
  /** 見出しの直下に並べる理由（重大な基準が複数のとき・処理が止まったとき） */
  reasons: string[]
  /** 実行と品質検証が最後まで終わったか（止めたときの補足に使う） */
  completed: boolean
}

export function outputState(run: RunSummary): OutputState {
  const failed = run.status === 'failed'
  const v = run.verdict
  const stopped = failed || v?.export === 'report_only'
  if (!stopped) {
    return { mode: v?.export === 'needs_confirmation' ? 'confirm' : 'allowed', exportLabel: OFFICIAL_EXPORT_LABEL, headline: null, reasons: [], completed: true }
  }
  const base = { mode: 'stopped' as const, exportLabel: REPORT_EXPORT_LABEL, completed: !failed }
  if (failed) {
    const at = run.nodes.findIndex((n) => n.status === 'error')
    const reasons = at >= 0 ? [`ステップ${at + 1}「${run.nodes[at].node_name}」で止まりました`] : (v?.reasons ?? [])
    return { ...base, headline: '処理が途中で止まりました・正式出力停止', reasons }
  }
  const critical = run.criteria.filter((c) => c.on_fail === 'critical' && c.status === 'failed')
  if (critical.length === 1) {
    const short = shortReason(critical[0])
    return { ...base, headline: `${short}・正式出力停止`, reasons: [critical[0].summary] }
  }
  if (critical.length > 1) {
    return { ...base, headline: '重大な品質異常を検出・正式出力停止', reasons: critical.map((c) => `${c.name}：${c.summary}`) }
  }
  // 重大な基準を確かめられなかった／標準の確認で重大な問題があった
  const unverified = v?.verdict === 'unverified'
  return { ...base, headline: unverified ? '必要な確認ができず・正式出力停止' : '重大な品質異常を検出・正式出力停止', reasons: v?.reasons ?? [] }
}

/** 重大な基準1つのときの、短い見出し（実際の判定結果の数を使う。分からなければ基準の名前） */
function shortReason(c: CriterionResult): string {
  const ev = c.evidence
  if (c.kind === 'all_matched' && ev['照合できない行']) return `照合漏れ${ev['照合できない行']}行`
  if (c.kind === 'unique' && ev['重複している行']) return `重複${ev['重複している行']}`
  if (c.kind === 'period' && ev['期間外の件数']) return `対象期間外${ev['期間外の件数']}件`
  return `「${c.name}」を満たしていない`
}

/* ---------- 原因と対応 ---------- */

export type CauseItem = {
  /** 原因の名前（例：前後の空白） */
  label: string
  /** 行数（分からなければ null） */
  rows: number | null
  /** 直し方 */
  fix: string | null
  /** 該当する例（照合できないキーなど） */
  examples: string[]
}

export type CauseGroup = {
  id: string
  /** 何が問題か（基準の名前・止まったステップ） */
  title: string
  /** 判定の要約（実際の値） */
  summary: string
  /** 重大か注意か（表示の色） */
  severity: 'critical' | 'caution'
  /** 原因ごとの内訳（照合できない行など、内訳が分かるときだけ） */
  items: CauseItem[]
  /** 全体の直し方（内訳がないとき） */
  fix: string | null
  /** 該当する例と、その全件数（例の数に上限があるため、全件数と表示件数を分けて示す） */
  examples: Record<string, unknown>[]
  total: number | null
  /** 全件数の単位（行で数える確認は「行」） */
  unit: '行' | '件'
  /** 判定の根拠（判定に使った実際の値） */
  evidence: Record<string, string>
}

const CAUSE_SHORT: Record<string, string> = { TRIM: '前後の空白', WIDTH: '全角・半角の違い', CASE: '大文字・小文字の違い', LEADING_ZERO: '先頭の0の有無' }

type CauseCandidate = { code: string; label: string; rows?: number; count: number; examples: string[]; how_to_fix: string }

/** 異常の原因と対応。重大 → 注意の順。処理が止まったときは、止まったステップを先に */
export function causeGroups(run: RunSummary, flow: FlowDoc): CauseGroup[] {
  const groups: CauseGroup[] = []
  if (run.status === 'failed') {
    run.nodes.forEach((n, i) => {
      if (n.status !== 'error') return
      const issue = n.issues.find((x) => x.severity === 'error') ?? n.issues[0]
      if (!issue) return
      groups.push({
        id: `node-${n.node_id}`,
        title: `ステップ${i + 1}「${n.node_name}」で止まりました`,
        summary: issue.message,
        severity: 'critical',
        items: unmatchedItems(issue),
        fix: issue.how_to_fix,
        examples: [],
        total: null,
        unit: '件',
        evidence: {},
      })
    })
  }
  const order = (c: CriterionResult) => (c.on_fail === 'critical' ? 0 : 1)
  const targets = run.criteria.filter((c) => (c.status === 'failed' && (c.on_fail === 'critical' || c.on_fail === 'caution')) || (c.status === 'unverified' && c.on_fail === 'critical'))
  for (const c of [...targets].sort((a, b) => order(a) - order(b))) {
    const issue = c.kind === 'all_matched' ? unmatchedIssueFor(c, run, flow) : null
    const items = issue ? unmatchedItems(issue) : []
    groups.push({
      id: `criterion-${c.criterion_id}`,
      title: c.status === 'unverified' ? `「${c.name}」を確かめられませんでした` : c.name,
      summary: c.summary,
      severity: c.on_fail === 'critical' ? 'critical' : 'caution',
      items,
      fix: c.how_to_fix,
      examples: c.examples,
      total: totalOf(c),
      unit: c.evidence['照合できない行'] || c.evidence['重複している行'] ? '行' : '件',
      evidence: c.evidence,
    })
  }
  return groups
}

/** 完了基準の対象（別の表から情報を付け加えるステップ）の「照合できない行」のお知らせ */
function unmatchedIssueFor(c: CriterionResult, run: RunSummary, flow: FlowDoc): EngineIssue | null {
  const ref = flow.completion_criteria.items.find((x) => x.criterion_id === c.criterion_id)?.target.ref
  const nodeId = flow.nodes.find((n) => n.output_reference === ref)?.node_id
  const nodes = nodeId ? run.nodes.filter((n) => n.node_id === nodeId) : run.nodes
  for (const n of nodes) {
    const issue = n.issues.find((x) => x.code === 'UNMATCHED_RECORDS')
    if (issue) return issue
  }
  return null
}

/** 照合できない行の内訳：表記の違い（直し方あり）／相手の表にない値／照合キーが空欄。行数の合計は全体と一致させる */
function unmatchedItems(issue: EngineIssue): CauseItem[] {
  if (issue.code !== 'UNMATCHED_RECORDS') return []
  const d = issue.details as { unmatched_rows?: number; blank_key_rows?: number; unmatched_keys?: string[]; cause_candidates?: CauseCandidate[] }
  const causes = d.cause_candidates ?? []
  const items: CauseItem[] = causes.map((c) => ({ label: CAUSE_SHORT[c.code] ?? c.label, rows: c.rows ?? null, fix: c.how_to_fix, examples: c.examples }))
  const explained = causes.reduce((s, c) => s + (c.rows ?? 0), 0)
  const missing = (d.unmatched_rows ?? 0) - explained
  if (missing > 0) {
    const shown = new Set(causes.flatMap((c) => c.examples))
    items.push({
      label: 'マスタ未登録（相手の表にない値）',
      rows: missing,
      fix: 'マスタへの登録漏れか、コードの誤りを確認してください。',
      examples: (d.unmatched_keys ?? []).filter((k) => !shown.has(k)),
    })
  }
  if (d.blank_key_rows) items.push({ label: '照合に使う値が空欄', rows: d.blank_key_rows, fix: '元データに値を入力してください。', examples: [] })
  return items
}

/** 該当する例の全件数（根拠の値から。分からなければ null） */
function totalOf(c: CriterionResult): number | null {
  const raw = c.evidence['照合できない行'] ?? c.evidence['期間外の件数'] ?? c.evidence['重複している行'] ?? c.evidence['該当件数']
  if (!raw) return null
  const n = Number(String(raw).replace(/[,行件]/g, ''))
  return Number.isFinite(n) ? n : null
}
