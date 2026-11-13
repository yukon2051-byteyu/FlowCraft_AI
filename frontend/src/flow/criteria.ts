/*
 * タスク2-4：完了基準（何を満たせば完了？）の設定に使う、画面から切り離した関数。
 *
 * - 11種類の基準の一覧（画面の名前・説明・対象の決まり・初期値）
 * - 対象（入力・ステップの結果）と列の選択肢
 * - テンプレート（売上集計・在庫照合・移行データの整備）：作業手順の中身から対象を推し当てて基準を作る
 * - 設定の不足（押せないボタンの理由として日本語で示す。サーバーの検証 validate.py と同じ決まり）
 * - 実行時に指定する値（run_parameters）を、基準から使われているものだけに整える
 *
 * 種類（kind）は決まった一覧から選ぶ。自由な式は書かせない（docs/completion-criteria.md §3）。
 */

import { inferColumns } from './params'
import type { Col } from './params'
import { newRuleId, nextId, snapshot } from './ops'
import type { Criterion, CriterionKind, FlowDoc, ParamRef, RunParameter } from './types'

type TargetKind = 'input' | 'result' | 'join'

export type KindInfo = {
  label: string
  help: string
  target: TargetKind
  /** 列が必要か（expected_value は合計のときだけ必要） */
  column: 'required' | 'none' | 'sum_only'
  defaultParams: () => Record<string, unknown>
  defaultOnFail: Criterion['on_fail']
}

export const CRITERION_KINDS: Record<CriterionKind, KindInfo> = {
  required_columns: {
    label: '必要な列がそろっている',
    help: '読み込むファイルに、決めた列がすべてあるか',
    target: 'input',
    column: 'none',
    defaultParams: () => ({ columns: [] }),
    defaultOnFail: 'critical',
  },
  data_type: {
    label: 'データの形式に合っている',
    help: '列の値が、決めた形式（数値・日付など）として読めるか',
    target: 'input',
    column: 'required',
    defaultParams: () => ({}),
    defaultOnFail: 'critical',
  },
  no_blank: {
    label: '空欄がない',
    help: '列に空欄がない（または許容件数以内）か',
    target: 'result',
    column: 'required',
    defaultParams: () => ({ max_count: 0 }),
    defaultOnFail: 'caution',
  },
  unique: {
    label: '重複がない',
    help: '決めた列（の組み合わせ）が重複していないか',
    target: 'result',
    column: 'none',
    defaultParams: () => ({ columns: [] }),
    defaultOnFail: 'caution',
  },
  value_range: {
    label: '値が範囲内にある',
    help: '数値・日付の列の値が、最小〜最大の中にあるか',
    target: 'result',
    column: 'required',
    defaultParams: () => ({ min: '', max: '' }),
    defaultOnFail: 'caution',
  },
  period: {
    label: '対象期間内の日付だけ',
    help: '日付の列が、対象の月（または期間）の中だけか。別の月のデータの混入に気づく',
    target: 'result',
    column: 'required',
    defaultParams: () => ({ month: '' }),
    defaultOnFail: 'critical',
  },
  total_match: {
    label: '2つの結果で合計が一致する',
    help: '集計の前と後などで、金額の合計が一致するか',
    target: 'result',
    column: 'required',
    defaultParams: () => ({
      compare_ref: '',
      compare_column: '',
      tolerance: '0',
    }),
    defaultOnFail: 'critical',
  },
  row_count: {
    label: '件数が範囲内にある',
    help: '結果の件数が、最小〜最大の中にあるか',
    target: 'result',
    column: 'none',
    defaultParams: () => ({ min: null, max: null }),
    defaultOnFail: 'caution',
  },
  all_matched: {
    label: '照合できない行が上限以下',
    help: '「別の表から情報を付け加える」で、マスタと照合できない行が許容件数以内か',
    target: 'join',
    column: 'none',
    defaultParams: () => ({ max_count: 0 }),
    defaultOnFail: 'critical',
  },
  expected_value: {
    label: '確認用の値と一致する',
    help: '合計または件数が、別の資料の値（確認用の値）と一致するか',
    target: 'result',
    column: 'sum_only',
    defaultParams: () => ({ measure: 'sum', value: '', tolerance: '0' }),
    defaultOnFail: 'critical',
  },
  list_rows: {
    label: '条件に合う行を一覧にする',
    help: '条件に合う行を記録するだけ（判定には使わない）',
    target: 'result',
    column: 'none',
    defaultParams: () => ({
      condition: { kind: 'condition', column: '', operator: 'eq', value: '' },
    }),
    defaultOnFail: 'record',
  },
}

export const KIND_ORDER = Object.keys(CRITERION_KINDS) as CriterionKind[]

export const ON_FAIL_LABEL: Record<Criterion['on_fail'], string> = {
  critical: '重大（止める）',
  caution: '注意（確認してから出力）',
  record: '記録のみ（判定に使わない）',
}

/** 処理の中で自動で行う確認（標準の確認）。設定は不要で、すべての作業で行う */
export const STANDARD_CHECKS = [
  '必要な列がファイルにあるか（「必ずある列」）',
  'データの形式に変換できない値がないか',
  '結合で行が想定外に増えていないか（マスタの重複など）',
  '結合の前後で金額の合計が変わっていないか',
  '集計の前後で合計と件数が一致しているか',
  '照合できない行・空欄のキーの件数',
]

/* ---------- 対象と列の選択肢 ---------- */

export type RefChoice = { ref: string; label: string }

export function refChoices(flow: FlowDoc, kind: CriterionKind): RefChoice[] {
  const target = CRITERION_KINDS[kind].target
  if (target === 'input')
    return flow.input_definitions.map((d) => ({
      ref: d.input_id,
      label: `入力：${d.label}`,
    }))
  return flow.nodes.flatMap((n, i) => {
    if (!n.output_reference) return []
    if (target === 'join' && n.node_type !== 'join') return []
    return [
      {
        ref: n.output_reference,
        label: `ステップ${i + 1}の結果：${n.node_name}`,
      },
    ]
  })
}

/** 参照名（入力・ステップの結果）の列。分からないとき（設定の途中）は空 */
export function columnsOf(flow: FlowDoc, ref: string): Col[] {
  const def = flow.input_definitions.find((d) => d.input_id === ref)
  if (def) return def.columns.map((c) => ({ name: c.name, type: c.type }))
  return inferColumns(flow)[ref] ?? []
}

/* ---------- 新しく作る ---------- */

export function newCriterion(flow: FlowDoc, kind: CriterionKind): Criterion {
  const info = CRITERION_KINDS[kind]
  const ref = refChoices(flow, kind)[0]?.ref ?? ''
  return {
    criterion_id: nextId(
      'c',
      flow.completion_criteria.items.map((c) => c.criterion_id),
    ),
    rule_id: newRuleId(),
    rule_version: 1,
    name: info.label,
    kind,
    target: { ref, column: null },
    params: info.defaultParams(),
    on_fail: info.defaultOnFail,
    origin: 'manual',
    confirmation_status: 'confirmed',
    note: '',
  }
}

/* ---------- テンプレート ---------- */

export type TemplateId = 'sales' | 'inventory' | 'migration'

export const TEMPLATES: {
  id: TemplateId
  name: string
  description: string
}[] = [
  {
    id: 'sales',
    name: '売上集計',
    description: '必要な列・対象月の伝票だけ・照合できない商品コード・集計前後の合計の一致',
  },
  {
    id: 'inventory',
    name: '在庫照合',
    description: 'コードの照合・キーの重複なし・差異のある行の一覧（差異は記録のみ）',
  },
  {
    id: 'migration',
    name: '移行データの整備',
    description: '必要な列・必須項目の空欄なし・データの形式・主キーの重複なし・件数',
  },
]

const firstColumnOfType = (cols: Col[], types: Col['type'][]) => cols.find((c) => types.includes(c.type))?.name ?? null

/**
 * テンプレートの基準を、今の作業手順に当てはめて作る。推し当てられない対象・列・値は空のまま残し、
 * 設定の不足（criterionProblems）として利用者に埋めてもらう（勝手に決め打ちしない）。
 */
export function applyTemplate(flow: FlowDoc, id: TemplateId): { items: Criterion[]; parameters: RunParameter[] } {
  const items: Criterion[] = []
  const parameters: RunParameter[] = []
  const used = flow.completion_criteria.items.map((c) => c.criterion_id)
  const add = (kind: CriterionKind, name: string, target: Criterion['target'], params: Record<string, unknown>, onFail?: Criterion['on_fail']) => {
    const id_ = nextId('c', [...used, ...items.map((c) => c.criterion_id)])
    items.push({
      criterion_id: id_,
      rule_id: newRuleId(),
      rule_version: 1,
      name,
      kind,
      target,
      params,
      on_fail: onFail ?? CRITERION_KINDS[kind].defaultOnFail,
      origin: 'template',
      confirmation_status: 'confirmed',
      note: '',
    })
  }
  const firstInput = flow.input_definitions[0]
  const inputCols = firstInput ? columnsOf(flow, firstInput.input_id) : []
  // 結合のステップ（既定の名前が同じになりやすいので、ステップの番号で呼ぶ）
  const joins = flow.nodes.flatMap((n, i) => (n.node_type === 'join' && n.output_reference ? [{ ...n, step: i + 1 }] : []))
  const aggregate = flow.nodes.find((n) => n.node_type === 'aggregate' && n.output_reference)

  if (id === 'sales') {
    if (firstInput) add('required_columns', '必要な列がそろっている', { ref: firstInput.input_id, column: null }, { columns: [] })
    if (firstInput) {
      parameters.push({
        param_id: 'target_month',
        label: '対象月',
        type: 'month',
        required: true,
      })
      add(
        'period',
        '対象月の伝票だけ',
        {
          ref: firstInput.input_id,
          column: firstColumnOfType(inputCols, ['date']),
        },
        { month: { $param: 'target_month' } },
      )
    }
    for (const j of joins) add('all_matched', `照合できない行が0件（ステップ${j.step}）`, { ref: j.output_reference!, column: null }, { max_count: 0 })
    if (aggregate) {
      const agg = (aggregate.parameters.aggregations as { function: string; column: string | null; output_column: string }[] | undefined)?.find((a) => a.function === 'sum')
      add(
        'total_match',
        '集計前後の合計が一致する',
        {
          ref: aggregate.output_reference!,
          column: agg?.output_column ?? null,
        },
        {
          compare_ref: aggregate.input_references[0] ?? '',
          compare_column: agg?.column ?? '',
          tolerance: '0',
        },
      )
    }
  } else if (id === 'inventory') {
    for (const j of joins) add('all_matched', `コードがすべて照合できる（ステップ${j.step}）`, { ref: j.output_reference!, column: null }, { max_count: 0 })
    const master = flow.input_definitions[1] ?? firstInput
    if (master) add('unique', 'キーが重複しない', { ref: master.input_id, column: null }, { columns: master.columns[0] ? [master.columns[0].name] : [] })
    const last = [...flow.nodes].reverse().find((n) => n.output_reference)
    if (last) {
      const num = firstColumnOfType(columnsOf(flow, last.output_reference!), ['integer', 'decimal'])
      add(
        'list_rows',
        '差異のある行の一覧',
        { ref: last.output_reference!, column: null },
        {
          condition: {
            kind: 'condition',
            column: num ?? '',
            operator: 'ne',
            value: '0',
          },
        },
        'record',
      )
    }
  } else {
    if (firstInput) {
      add('required_columns', '必要な列がそろっている', { ref: firstInput.input_id, column: null }, { columns: [] })
      const requiredCols = firstInput.columns.filter((c) => c.required !== false)
      if (requiredCols[0]) add('no_blank', `「${requiredCols[0].name}」に空欄がない`, { ref: firstInput.input_id, column: requiredCols[0].name }, { max_count: 0 }, 'critical')
      const typed = firstInput.columns.find((c) => c.type !== 'string')
      if (typed) add('data_type', `「${typed.name}」の形式`, { ref: firstInput.input_id, column: typed.name }, {})
      if (firstInput.columns[0]) add('unique', '主キーが重複しない', { ref: firstInput.input_id, column: null }, { columns: [firstInput.columns[0].name] }, 'critical')
      add('row_count', '件数が想定の範囲', { ref: firstInput.input_id, column: null }, { min: null, max: null })
    }
  }
  return { items, parameters }
}

/* ---------- 値・実行時に指定する値 ---------- */

export const isParamRef = (v: unknown): v is ParamRef => !!v && typeof v === 'object' && '$param' in (v as object)

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const isNumber = (v: string) => v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')))
function isDate(v: string) {
  if (!DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 基準から使われている「実行時に指定する値」だけを残す（使われなくなった値を消す） */
export function usedParamIds(items: Criterion[]): Set<string> {
  const ids = new Set<string>()
  const walk = (v: unknown) => {
    if (isParamRef(v)) ids.add(v.$param)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  items.forEach((c) => walk(c.params))
  return ids
}

export function pruneRunParameters(params: RunParameter[], items: Criterion[]): RunParameter[] {
  const used = usedParamIds(items)
  return params.filter((p) => used.has(p.param_id))
}

/* ---------- 設定の不足 ---------- */

/** 1つの基準の設定で足りないこと（日本語）。空なら設定は終わっている */
export function criterionProblems(c: Criterion, flow: FlowDoc): string[] {
  const info = CRITERION_KINDS[c.kind]
  const out: string[] = []
  const p = (c.params ?? {}) as Record<string, unknown>
  if (!c.name.trim()) out.push('基準の名前を入れてください')
  const refs = refChoices(flow, c.kind).map((r) => r.ref)
  if (!c.target.ref || !refs.includes(c.target.ref)) {
    out.push(
      info.target === 'input'
        ? '確かめるファイル（入力）を選んでください'
        : info.target === 'join'
          ? '確かめる「別の表から情報を付け加える」ステップを選んでください'
          : '確かめる結果（ステップ）を選んでください',
    )
  }
  const cols = c.target.ref ? columnsOf(flow, c.target.ref).map((x) => x.name) : []
  const needsColumn = info.column === 'required' || (info.column === 'sum_only' && p.measure === 'sum')
  if (needsColumn && !c.target.column) out.push('確かめる列を選んでください')
  else if (needsColumn && cols.length && !cols.includes(c.target.column!)) out.push(`列「${c.target.column}」は、選んだ結果にありません`)
  const param = (id: string) => flow.run_parameters.find((x) => x.param_id === id)
  const value = (v: unknown, what: string, ok: (s: string) => boolean, types: RunParameter['type'][], hint: string) => {
    if (isParamRef(v)) {
      const def = param(v.$param)
      if (!def) out.push(`${what}に使う「実行時に指定する値」がありません`)
      else if (!types.includes(def.type)) out.push(`${what}に、種類の違う「実行時に指定する値」（${def.label}）が選ばれています`)
    } else if (typeof v === 'string' && v.trim() !== '' && !ok(v.trim())) out.push(`${what}は${hint}の形で入れてください`)
  }
  switch (c.kind) {
    case 'unique':
      if (!(p.columns as string[] | undefined)?.length) out.push('重複を確かめる列を1つ以上選んでください')
      break
    case 'value_range':
      if (!isParamRef(p.min) && !isParamRef(p.max) && !String(p.min ?? '').trim() && !String(p.max ?? '').trim()) out.push('最小・最大のどちらかを入れてください')
      value(p.min, '最小', (s) => isNumber(s) || isDate(s), ['integer', 'decimal', 'date'], '数値または日付（2026-10-01）')
      value(p.max, '最大', (s) => isNumber(s) || isDate(s), ['integer', 'decimal', 'date'], '数値または日付（2026-10-01）')
      break
    case 'period':
      if ('month' in p) {
        if (!isParamRef(p.month) && !String(p.month ?? '').trim()) out.push('対象の月を入れるか、「実行するたびに指定する」を選んでください')
        value(p.month, '対象の月', (s) => MONTH.test(s), ['month'], '「2026-10」')
      } else {
        if (!isParamRef(p.start) && !isParamRef(p.end) && !String(p.start ?? '').trim() && !String(p.end ?? '').trim()) out.push('開始日・終了日のどちらかを入れてください')
        value(p.start, '開始日', isDate, ['date'], '「2026-10-01」')
        value(p.end, '終了日', isDate, ['date'], '「2026-10-31」')
      }
      break
    case 'total_match': {
      const compareRefs = refChoices(flow, 'total_match').map((r) => r.ref)
      if (!p.compare_ref || !compareRefs.includes(String(p.compare_ref))) out.push('比べる相手の結果を選んでください')
      else if (!p.compare_column) out.push('比べる相手の列を選んでください')
      if (!isNumber(String(p.tolerance ?? '0')) || Number(p.tolerance) < 0) out.push('許容差は0以上の数値で入れてください')
      break
    }
    case 'row_count':
      if (p.min == null && p.max == null) out.push('最小・最大のどちらかを入れてください')
      else if (p.min != null && p.max != null && Number(p.min) > Number(p.max)) out.push('最小が最大より大きくなっています')
      break
    case 'expected_value':
      if (!isParamRef(p.value) && !String(p.value ?? '').trim()) out.push('確認用の値を入れるか、「実行するたびに指定する」を選んでください')
      value(p.value, '確認用の値', isNumber, ['integer', 'decimal'], '数値')
      if (!isNumber(String(p.tolerance ?? '0')) || Number(p.tolerance) < 0) out.push('許容差は0以上の数値で入れてください')
      break
    case 'list_rows': {
      const cond = p.condition as { column?: string; operator?: string; value?: string | null } | undefined
      if (!cond?.column) out.push('一覧にする条件の列を選んでください')
      break
    }
  }
  return out
}

/* ---------- 一覧に出す要約 ---------- */

export function describeCriterion(c: Criterion, flow: FlowDoc, paramLabel: (id: string) => string = (id) => id): string {
  const p = (c.params ?? {}) as Record<string, unknown>
  const v = (x: unknown) => (isParamRef(x) ? `実行時に指定（${paramLabel(x.$param)}）` : String(x ?? ''))
  const ref = refChoices(flow, c.kind).find((r) => r.ref === c.target.ref)?.label ?? '（対象を選んでいません）'
  const col = c.target.column ? `「${c.target.column}」` : ''
  switch (c.kind) {
    case 'required_columns':
      return `${ref}：${(p.columns as string[] | undefined)?.length ? (p.columns as string[]).join('、') : '「必ずある列」すべて'}`
    case 'no_blank':
      return `${ref} ${col}：空欄 ${String(p.max_count ?? 0)}件まで`
    case 'unique':
      return `${ref}：${((p.columns as string[]) ?? []).join('・') || '（列を選んでいません）'} が重複しない`
    case 'value_range':
      return `${ref} ${col}：${v(p.min)}〜${v(p.max)}`
    case 'period':
      return 'month' in p ? `${ref} ${col}：${v(p.month)}` : `${ref} ${col}：${v(p.start)}〜${v(p.end)}`
    case 'total_match':
      return `${ref} ${col} ＝ ${refChoices(flow, 'total_match').find((r) => r.ref === p.compare_ref)?.label ?? '（相手を選んでいません）'}「${String(p.compare_column ?? '')}」（許容差 ${String(p.tolerance ?? '0')}）`
    case 'row_count':
      return `${ref}：${p.min ?? ''}〜${p.max ?? ''}件`
    case 'all_matched':
      return `${ref}：照合できない行 ${String(p.max_count ?? 0)}件まで`
    case 'expected_value':
      return `${ref} ${p.measure === 'count' ? '件数' : `${col}の合計`} ＝ ${v(p.value)}（許容差 ${String(p.tolerance ?? '0')}）`
    case 'list_rows': {
      const cond = p.condition as { column?: string; value?: string | null } | undefined
      return `${ref}：「${cond?.column ?? ''}」の条件に合う行`
    }
    default:
      return `${ref} ${col}`
  }
}

/* ---------- 変更の記録（タスク2-6） ---------- */

const MAX_CHANGELOG = 200

/** 2つの完了基準の一覧の違いを、人が読める要約にする（値の中身は残さず、何を変えたかだけ） */
export function diffCriteria(before: Criterion[], after: Criterion[]): string[] {
  const out: string[] = []
  const prev = new Map(before.map((c) => [c.criterion_id, c]))
  const next = new Map(after.map((c) => [c.criterion_id, c]))
  const removed: string[] = []
  // 比べるときは、項目の順序の違いを無視する（保存した内容は項目が並べ替えられているため）
  const same = (x: unknown, y: unknown) => snapshot(x as FlowDoc) === snapshot(y as FlowDoc)
  for (const c of after) {
    const b = prev.get(c.criterion_id)
    // 削除した後に同じIDで別の種類の基準を追加した場合は、変更ではなく「削除と追加」とする
    if (!b || b.kind !== c.kind) {
      if (b) removed.push(`「${b.name}」を削除`)
      out.push(`「${c.name}」を追加`)
      continue
    }
    const parts: string[] = []
    if (b.name !== c.name) parts.push(`名前を「${b.name}」から変更`)
    if (b.on_fail !== c.on_fail) parts.push(`満たさないときを${ON_FAIL_SHORT[b.on_fail]}→${ON_FAIL_SHORT[c.on_fail]}に`)
    if (!same({ ref: b.target.ref, column: b.target.column ?? null }, { ref: c.target.ref, column: c.target.column ?? null })) parts.push('確かめる対象を変更')
    if (!same(b.params ?? {}, c.params ?? {})) parts.push('条件を変更')
    if ((b.note ?? '') !== (c.note ?? '')) parts.push('メモを変更')
    if ((b.confirmation_status ?? 'confirmed') !== (c.confirmation_status ?? 'confirmed')) parts.push(c.confirmation_status === 'confirmed' ? '確認済みにした' : '確認の状態を変更')
    if (parts.length) out.push(`「${c.name}」：${parts.join('、')}`)
  }
  for (const b of before) if (!next.has(b.criterion_id)) removed.push(`「${b.name}」を削除`)
  return [...out, ...removed]
}

const ON_FAIL_SHORT: Record<Criterion['on_fail'], string> = { critical: '重大', caution: '注意', record: '記録のみ' }

/**
 * 品質ルールごとの版（品質MVP）：判定に関わる設定（確かめる対象・条件・満たさないとき・確認の状態）を変えたルールだけ、保存のときに +1 する。
 * 名前とメモは判定に関わらないため、版を上げない。新しく追加したルールは版1のまま。
 */
export function advanceRuleVersions(before: Criterion[], after: Criterion[]): Criterion[] {
  const prev = new Map(before.map((c) => [c.rule_id, c]))
  const same = (x: unknown, y: unknown) => snapshot(x as FlowDoc) === snapshot(y as FlowDoc)
  const setting = (c: Criterion) => ({
    kind: c.kind,
    target: { ref: c.target.ref, column: c.target.column ?? null },
    params: c.params ?? {},
    on_fail: c.on_fail,
    confirmation_status: c.confirmation_status ?? 'confirmed',
  })
  return after.map((c) => {
    const b = prev.get(c.rule_id)
    if (!b || same(setting(b), setting(c))) return c
    return { ...c, rule_version: Math.max(c.rule_version, b.rule_version + 1) }
  })
}

/**
 * 保存するときに、完了基準の版数と変更の記録を進める。
 * - 初めての保存で基準があれば、版1として「設定」を記録する
 * - 前に保存した内容から基準が変わっていれば、版を1つ上げて、変更の要約を記録する
 * - 変わっていなければ、そのまま（版を上げない）
 */
export function advanceCriteriaVersion(flow: FlowDoc, savedBefore: Criterion[] | null, now: Date = new Date()): FlowDoc {
  const cc = flow.completion_criteria
  const at = now.toISOString()
  if (savedBefore === null) {
    if (!cc.items.length || cc.changelog.length) return flow
    return { ...flow, completion_criteria: { ...cc, changelog: [{ version: cc.version, changed_at: at, summary: `完了基準を設定（${cc.items.length}件）` }] } }
  }
  const changes = diffCriteria(savedBefore, cc.items)
  if (!changes.length) return flow
  const version = cc.version + 1
  let summary = changes.join(' ／ ')
  if (summary.length > 500) summary = summary.slice(0, 495) + ' …ほか'
  const changelog = [...cc.changelog, { version, changed_at: at, summary }].slice(-MAX_CHANGELOG)
  return { ...flow, completion_criteria: { ...cc, version, changelog, items: advanceRuleVersions(savedBefore, cc.items) } }
}
