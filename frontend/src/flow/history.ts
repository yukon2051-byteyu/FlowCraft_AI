/*
 * 実行の履歴（品質MVP QM-3・分析 Phase C）。画面から切り離した純粋な関数（単体テストで確かめる）。
 *
 * 手動の実行の記録は、このブラウザの IndexedDB に保存する（参考の記録。D-1）：
 *   - 正式な監査証跡・無人実行の判定には使わない（ブラウザのデータは消したり書き換えたりできるため）
 *   - 作業手順ごとに最新200件まで（古いものから消す）
 *   - デモの記録は別の置き場に入れ、デモを始めるたびに入れ替える（通常の履歴と混ぜない。D-5）
 *   - 書き出し・取り込みは JSON（記録の版つき）。取り込むときは形を確かめ、同じ実行IDは取り込まない
 * 保存するのは実行の記録（集計済みの値・判定・根拠の例）だけ。元のExcelの中身は保存しない。
 */

export const RECORD_VERSION = 1
export const MAX_PER_FLOW = 200
/** 実行のときにサーバーへ送る過去の記録の数（サーバーの上限と同じ） */
export const MAX_SENT = 24

/** 実行の記録（backend/app/quality/models.py の RunRecord）。画面で使う項目だけ型を付ける */
export type RunRecord = {
  record_version: number
  run_id: string
  source: string
  executed_at: string
  duration_ms: number
  flow_id: string
  flow_name: string
  flow_version: number
  period: string | null
  inputs: { input_id: string; label: string; filename: string | null; sheet: string | null; sha256: string | null; rows: number | null }[]
  outputs: { reference: string; sheet_name: string; rows: number | null }[]
  processing_status: 'completed' | 'failed'
  verdict: string | null
  verdict_headline: string | null
  rules: { criterion_id: string; rule_id: string; rule_version: number; name: string; kind: string; on_fail: string; status: string; summary: string; anomaly_count: number | null }[]
  official_output: { mode: string; performed: boolean; performed_at: string | null; stop_reason: string | null }
  metrics: { metric_id: string; label: string; category: string; value: string; fingerprint: string }[]
  analysis?: Record<string, unknown> | null
  /** 画面で付ける：取り込んだ記録か */
  imported?: boolean
}

/** 実行のときにサーバーへ送る記録：同じ作業手順の、新しいものから（前回の選び方はサーバーで行う） */
export function historyToSend(records: RunRecord[], flowId: string): RunRecord[] {
  return records
    .filter((r) => r.flow_id === flowId && r.record_version === RECORD_VERSION)
    .sort((a, b) => b.executed_at.localeCompare(a.executed_at))
    .slice(0, MAX_SENT)
}

/** 作業手順ごとに最新 max 件を残す。消す記録の実行IDを返す */
export function overflow(records: RunRecord[], max = MAX_PER_FLOW): string[] {
  const byFlow = new Map<string, RunRecord[]>()
  for (const r of records) byFlow.set(r.flow_id, [...(byFlow.get(r.flow_id) ?? []), r])
  const out: string[] = []
  for (const list of byFlow.values()) {
    const sorted = [...list].sort((a, b) => b.executed_at.localeCompare(a.executed_at))
    out.push(...sorted.slice(max).map((r) => r.run_id))
  }
  return out
}

/** 異常の件数（満たしていない基準の数。記録の指標から） */
export function anomalyCount(r: RunRecord): number {
  return r.rules.filter((x) => x.status === 'failed' && x.on_fail !== 'record').length
}

export type HistoryFilter = { flowId?: string; period?: string; verdict?: string }

export function filterHistory(records: RunRecord[], f: HistoryFilter): RunRecord[] {
  return records
    .filter((r) => (!f.flowId || r.flow_id === f.flowId) && (!f.period || r.period === f.period) && (!f.verdict || r.verdict === f.verdict))
    .sort((a, b) => b.executed_at.localeCompare(a.executed_at))
}

/** 書き出す内容（JSON） */
export function exportPayload(records: RunRecord[], now: Date = new Date()): string {
  return JSON.stringify({ kind: 'flowcraft-run-history', record_version: RECORD_VERSION, exported_at: now.toISOString(), records }, null, 2)
}

/**
 * 取り込む内容を確かめる。形の合わないもの・版の違うもの・すでにある実行IDは取り込まない。
 * 取り込んだ記録には imported を付ける（画面で「取り込んだ記録」と表示する）
 */
export function parseImport(text: string, existingIds: Set<string>): { records: RunRecord[]; skipped: number; error: string | null } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { records: [], skipped: 0, error: 'JSON として読み込めませんでした。書き出した履歴のファイルを選んでください。' }
  }
  const d = data as { kind?: string; records?: unknown }
  if (d?.kind !== 'flowcraft-run-history' || !Array.isArray(d.records)) {
    return { records: [], skipped: 0, error: '実行の履歴のファイルではありません。' }
  }
  const ok: RunRecord[] = []
  let skipped = 0
  for (const raw of d.records) {
    const r = raw as Partial<RunRecord>
    const valid =
      r && r.record_version === RECORD_VERSION && typeof r.run_id === 'string' && typeof r.flow_id === 'string' && typeof r.executed_at === 'string' && Array.isArray(r.rules)
    if (!valid || existingIds.has(r.run_id!)) {
      skipped++
      continue
    }
    ok.push({ ...(r as RunRecord), imported: true })
  }
  return { records: ok, skipped, error: null }
}
