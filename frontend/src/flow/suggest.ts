/*
 * 処理手順から品質チェック（完了基準）の候補を作る（生成AIは使わない。決まったルールで作る）。
 * 完了基準設定画面のUX刷新・品質ルール自動提案 指示書 §5。
 *
 * 守ること：
 * - 実際にある処理ステップと、その列を根拠にする（存在しない列・結果を推測で入れない）
 * - 検証エンジンが扱える種類（CRITERION_KINDS）だけを使う
 * - 意味から決まる値（「空欄がない」の0件、「0件でない」の最小1件など）だけを自動で入れる。
 *   業務の判断が必要な値（照合できない行の許容件数など）は仮の値を入れて「要確認」にし、利用者が確かめるまで未検証として扱う
 * - 特定できない列は空のまま残し、設定の不足（未設定）として利用者に選んでもらう
 * - 既にある基準と同じ内容・「提案しない」とした候補は出さない
 * - 標準の確認（結合で行が増えていないか等。設定不要で常に行う）と同じ内容は出さない
 * 候補は利用者が選んで追加するまで、完了基準として有効にならない。
 */

import { CRITERION_KINDS, columnsOf } from './criteria'
import { newRuleId, nextId } from './ops'
import type { Criterion, CriterionKind, FlowDoc, FlowNode, RunParameter } from './types'

export type Suggestion = {
  /** 候補の識別（種類:対象:列）。「提案しない」の記録に使う。処理手順が変わると変わる */
  key: string
  kind: CriterionKind
  name: string
  target: Criterion['target']
  params: Record<string, unknown>
  on_fail: Criterion['on_fail']
  /** 提案する理由（どの処理ステップを根拠にしたか） */
  reason: string
  /** 自動で設定する内容 */
  autoSet: string[]
  /** 利用者の確認・入力が必要な内容 */
  needsUser: string[]
  /** 仮の値を入れたので、利用者が確かめるまで「要確認」にする */
  pending: boolean
  /** この候補で使う「実行時に指定する値」 */
  parameters: RunParameter[]
}

type Agg = { function: string; column: string | null; output_column: string; scale?: number | null }
type Cond = { kind?: string; column?: string; conditions?: Cond[] }

const keyOf = (kind: CriterionKind, ref: string, column: string | null | undefined) => `${kind}:${ref}:${column ?? ''}`

/** 条件（入れ子のグループを含む）で使っている列 */
function conditionColumns(c: Cond | undefined): string[] {
  if (!c) return []
  if (c.kind === 'group') return (c.conditions ?? []).flatMap(conditionColumns)
  return c.column ? [c.column] : []
}

export function suggestCriteria(flow: FlowDoc): Suggestion[] {
  const out: Suggestion[] = []
  const stepLabel = (n: FlowNode, i: number) => `ステップ${i + 1}「${n.node_name}」`
  const hasColumn = (ref: string, col: string) => columnsOf(flow, ref).some((c) => c.name === col)
  const typeOf = (ref: string, col: string) => columnsOf(flow, ref).find((c) => c.name === col)?.type

  flow.nodes.forEach((n, i) => {
    const ref = n.output_reference
    if (!ref) return
    const p = n.parameters as Record<string, unknown>
    const at = stepLabel(n, i)

    if (n.node_type === 'join') {
      // 照合できない行（許容件数は業務で決めることなので、仮に0件を入れて「要確認」にする）
      out.push({
        key: keyOf('all_matched', ref, null),
        kind: 'all_matched',
        name: `照合できない行が0件（ステップ${i + 1}）`,
        target: { ref, column: null },
        params: { max_count: 0 },
        on_fail: 'critical',
        reason: `${at}で別の表と照合しているため、照合できない行がないかの確認をおすすめします。`,
        autoSet: [`対象：${at}`],
        needsUser: ['許容する件数（仮に0件。業務で何件まで許すか確かめてください）'],
        pending: true,
        parameters: [],
      })
      // 元の表の照合キーに空欄がない（空欄のキーは照合できないため）
      const left = n.input_references[0]
      const key = (p.keys as { left?: string }[] | undefined)?.[0]?.left
      if (left && key && hasColumn(left, key)) {
        out.push({
          key: keyOf('no_blank', left, key),
          kind: 'no_blank',
          name: `照合に使う「${key}」に空欄がない`,
          target: { ref: left, column: key },
          params: { max_count: 0 },
          on_fail: 'caution',
          reason: `${at}は「${key}」で照合します。空欄の行は照合できず、付け加える情報が空になるためです。`,
          autoSet: [`対象の列：「${key}」`, '許容する空欄：0件'],
          needsUser: [],
          pending: false,
          parameters: [],
        })
      }
    }

    if (n.node_type === 'aggregate') {
      // 集計の前後で合計が一致する（合計した列ごと）。端数処理があるときは許容差を利用者に確かめてもらう
      const src = n.input_references[0]
      for (const a of ((p.aggregations as Agg[] | undefined) ?? []).filter((x) => x.function === 'sum' && x.column && x.output_column)) {
        if (!src || !hasColumn(src, a.column!)) continue
        // 端数処理があっても、集計前の列が整数なら値は変わらない（許容差0に根拠がある）。小数の列を丸めるときだけ確かめてもらう
        const rounded = a.scale !== null && a.scale !== undefined && typeOf(src, a.column!) !== 'integer'
        out.push({
          key: keyOf('total_match', ref, a.output_column),
          kind: 'total_match',
          name: `集計前後の「${a.column}」の合計が一致`,
          target: { ref, column: a.output_column },
          params: { compare_ref: src, compare_column: a.column, tolerance: '0' },
          on_fail: 'critical',
          reason: `${at}で「${a.column}」を合計しているため、集計の前後で合計がずれていないかの確認をおすすめします。`,
          autoSet: [`集計の結果：「${a.output_column}」`, `比べる相手：集計前の「${a.column}」`, '許容差：0'],
          needsUser: rounded ? ['端数処理をしているため、許容差（仮に0）を確かめてください'] : [],
          pending: rounded,
          parameters: [],
        })
      }
    }

    if (n.node_type === 'filter') {
      // 絞り込んだ結果が0件でない（「0件でない」は意味から決まるので最小1件を自動で入れる）
      out.push({
        key: keyOf('row_count', ref, null),
        kind: 'row_count',
        name: `絞り込んだ結果が0件でない（ステップ${i + 1}）`,
        target: { ref, column: null },
        params: { min: 1, max: null },
        on_fail: 'caution',
        reason: `${at}で行を絞り込んでいるため、条件の誤りで対象が0件になっていないかの確認をおすすめします。`,
        autoSet: ['最小の件数：1件'],
        needsUser: [],
        pending: false,
        parameters: [],
      })
      // 日付の列で絞り込んでいるなら、対象期間外の日付が残っていないか（対象の月は実行のたびに指定する）
      const dateCol = conditionColumns(p.condition as Cond | undefined).find((c) => typeOf(ref, c) === 'date')
      if (dateCol) {
        out.push({
          key: keyOf('period', ref, dateCol),
          kind: 'period',
          name: `対象月の「${dateCol}」だけ`,
          target: { ref, column: dateCol },
          params: { month: { $param: 'target_month' } },
          on_fail: 'critical',
          reason: `${at}で「${dateCol}」の期間を絞り込んでいるため、別の月のデータが混ざっていないかの確認をおすすめします。`,
          autoSet: [`対象の列：「${dateCol}」`],
          needsUser: ['対象の月（実行するたびに指定します）'],
          pending: false,
          parameters: [{ param_id: 'target_month', label: '対象月', type: 'month', required: true }],
        })
      }
    }

    if (n.node_type === 'calculate') {
      const col = String(p.output_column ?? '').trim()
      if (col && hasColumn(ref, col)) {
        out.push({
          key: keyOf('no_blank', ref, col),
          kind: 'no_blank',
          name: `計算結果「${col}」に空欄がない`,
          target: { ref, column: col },
          params: { max_count: 0 },
          on_fail: 'caution',
          reason: `${at}で「${col}」を計算しています。計算に使う列が空欄のときや0で割ったときは空欄になるため、確認をおすすめします。`,
          autoSet: [`対象の列：「${col}」`, '許容する空欄：0件'],
          needsUser: [],
          pending: false,
          parameters: [],
        })
      }
    }
  })

  // 既にある基準と同じもの・「提案しない」とした候補・同じ候補の重なりは出さない
  const existing = new Set(flow.completion_criteria.items.map((c) => keyOf(c.kind, c.target.ref, c.target.column ?? null)))
  const dismissed = new Set(flow.completion_criteria.dismissed_suggestions ?? [])
  const seen = new Set<string>()
  return out.filter((s) => {
    if (existing.has(s.key) || dismissed.has(s.key) || seen.has(s.key)) return false
    seen.add(s.key)
    return true
  })
}

/** 選んだ候補を完了基準にする（作られ方は suggested。仮の値を入れた候補は「要確認」） */
export function suggestionsToCriteria(flow: FlowDoc, picked: Suggestion[]): { items: Criterion[]; parameters: RunParameter[] } {
  const ids = flow.completion_criteria.items.map((c) => c.criterion_id)
  const items: Criterion[] = []
  const parameters: RunParameter[] = []
  for (const s of picked) {
    const id = nextId('c', [...ids, ...items.map((c) => c.criterion_id)])
    items.push({
      criterion_id: id,
      rule_id: newRuleId(),
      rule_version: 1,
      name: s.name,
      kind: s.kind,
      target: s.target,
      params: s.params,
      on_fail: s.on_fail ?? CRITERION_KINDS[s.kind].defaultOnFail,
      origin: 'suggested',
      confirmation_status: s.pending ? 'pending' : 'confirmed',
      note: '',
    })
    for (const rp of s.parameters) if (!parameters.some((x) => x.param_id === rp.param_id)) parameters.push(rp)
  }
  return { items, parameters }
}
