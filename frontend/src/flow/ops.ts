/*
 * 作業手順を操作する純粋な関数（入力を書き換えず、新しい値を返す）。
 * 画面の操作（追加・削除・移動）の可否を、サーバーへ問い合わせる前にすぐ判定するために使う。
 * 決まりはサーバー側の app/flow/validate.py と同じ。最終的な判定は常にサーバー側の検証で行う。
 */

import { SCHEMA_VERSION } from './types'
import { defaultParams, syncParams } from './params'
import type { Dependency, FlowDoc, FlowNode, NodeType } from './types'

export const ENGINE_VERSION = '0.1.0'

/**
 * ファイルから読み込んだ作業手順の、省略された項目を初期値で補う。
 * 作業手順のファイルは省略できる項目（読み込みステップの input_references、出力ステップの output_reference など）を
 * 書かなくてもよい決まりのため、画面で扱う前に必ずこの関数を通す（サーバー側の初期値と同じ）。
 * 形の正しさの検証はサーバー側（/api/flows/validate）で行う。
 */
export function normalizeFlow(raw: unknown): FlowDoc {
  const f = (raw ?? {}) as Partial<FlowDoc> & { nodes?: Partial<FlowNode>[] }
  return {
    schema_version: f.schema_version ?? SCHEMA_VERSION,
    engine_version: f.engine_version ?? ENGINE_VERSION,
    flow_id: f.flow_id ?? '',
    flow_version: f.flow_version ?? 1,
    flow_name: f.flow_name ?? '',
    description: f.description ?? '',
    created_at: f.created_at ?? '',
    updated_at: f.updated_at ?? '',
    input_definitions: (f.input_definitions ?? []).map((d) => ({ header_row: 1, sheet_hint: null, ...d, columns: d.columns ?? [] })),
    nodes: (f.nodes ?? []).map((n) => ({
      node_id: n.node_id ?? '',
      node_type: n.node_type as FlowNode['node_type'],
      node_name: n.node_name ?? '',
      parameters: n.parameters ?? {},
      input_references: n.input_references ?? [],
      output_reference: n.output_reference ?? null,
      confirmation_status: n.confirmation_status ?? 'unset',
      open_questions: n.open_questions ?? [],
    })),
    dependencies: f.dependencies ?? [],
    ...(f.validation_rules ? { validation_rules: f.validation_rules } : {}),
  }
}

/** 新しい作業手順（空）。flow_id は推測できない乱数（UUID）。 */
export function createFlow(name: string, now: Date = new Date()): FlowDoc {
  const iso = now.toISOString()
  return {
    schema_version: SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    flow_id: crypto.randomUUID(),
    flow_version: 1,
    flow_name: name,
    description: '',
    created_at: iso,
    updated_at: iso,
    input_definitions: [],
    nodes: [],
    dependencies: [],
  }
}

/** 既存のIDと重ならない、英数字だけの新しいID（例：n7）。 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing)
  let i = 1
  while (used.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

/** 各ステップが、どのステップの結果に依存しているか（参照名から計算する）。 */
export function computeDependencies(nodes: FlowNode[]): Dependency[] {
  const producer = new Map<string, string>()
  for (const n of nodes) if (n.output_reference) producer.set(n.output_reference, n.node_id)
  return nodes.map((n) => ({
    node_id: n.node_id,
    depends_on: n.input_references.flatMap((r) => (producer.has(r) ? [producer.get(r)!] : [])),
  }))
}

/** ステップが使うデータの説明（例：「ステップ2の結果」「入力：商品マスタ」）。縦の一覧で依存関係を示すため。 */
export function describeInputs(nodes: FlowNode[], index: number, inputLabels: Record<string, string>): string[] {
  const node = nodes[index]
  if (node.node_type === 'load') {
    const id = String(node.parameters.input_id ?? '')
    return [`読み込むファイル：${inputLabels[id] ?? id}`]
  }
  return node.input_references.map((ref) => {
    if (ref === UNSELECTED) return '（まだ選んでいません）'
    const at = nodes.findIndex((n) => n.output_reference === ref)
    return at >= 0 ? `ステップ${at + 1}の結果` : `（見つからないデータ：${ref}）`
  })
}

export type CheckResult = { ok: true } | { ok: false; reason: string }

/**
 * 並べ替えた結果が「上にあるデータしか使えない」決まりを守っているか（サーバー側 R1・出力は最後）。
 */
export function checkOrder(nodes: FlowNode[]): CheckResult {
  const produced = new Set<string>()
  const allOutputs = new Map<string, number>()
  nodes.forEach((n, i) => n.output_reference && allOutputs.set(n.output_reference, i))
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    for (const ref of n.input_references) {
      if (produced.has(ref)) continue
      const at = allOutputs.get(ref)
      if (at !== undefined) {
        return { ok: false, reason: `ステップ${i + 1}は、より下にあるステップ${at + 1}の結果を使っています。使うデータを作るステップより下に置いてください。` }
      }
    }
    if (n.output_reference) produced.add(n.output_reference)
  }
  const outIdx = nodes.findIndex((n) => n.node_type === 'output')
  if (outIdx >= 0 && outIdx !== nodes.length - 1) {
    return { ok: false, reason: '「Excelに出力する」ステップは、作業手順の最後に置いてください。' }
  }
  return { ok: true }
}

/** ステップを移動する。決まりを守れない移動は行わず、理由を返す（設計書 §4.2 R5）。 */
export function moveNode(nodes: FlowNode[], nodeId: string, toIndex: number): { nodes: FlowNode[] } | { error: string } {
  const from = nodes.findIndex((n) => n.node_id === nodeId)
  if (from < 0) return { error: 'ステップが見つかりません。' }
  if (toIndex < 0 || toIndex >= nodes.length) return { error: 'これ以上は移動できません。' }
  const next = [...nodes]
  const [node] = next.splice(from, 1)
  next.splice(toIndex, 0, node)
  const check = checkOrder(next)
  if (check.ok) return { nodes: next }

  // 理由は、いま画面に表示している番号で伝える（移動後の番号だと、画面と食い違って分かりにくい）
  const label = (i: number) => `ステップ${i + 1}「${nodes[i].node_name}」`
  const outIdx = nodes.findIndex((n) => n.node_type === 'output')
  if (node.node_type === 'output' || (outIdx >= 0 && toIndex >= outIdx)) {
    return { error: '「Excelに出力する」ステップは、作業手順の最後に置いてください。' }
  }
  if (toIndex < from) {
    const producer = nodes.findIndex((n, i) => i >= toIndex && i < from && n.output_reference && node.input_references.includes(n.output_reference))
    if (producer >= 0) return { error: `このステップは${label(producer)}の結果を使うため、それより上には動かせません。` }
  } else {
    const ref = node.output_reference
    const user = nodes.findIndex((n, i) => i > from && i <= toIndex && ref !== null && n.input_references.includes(ref))
    if (user >= 0) return { error: `このステップの結果を${label(user)}が使っているため、それより下には動かせません。` }
  }
  return { error: check.reason }
}

/** ステップを削除する。そのステップの結果を使っているステップがあれば削除しない。 */
export function removeNode(nodes: FlowNode[], nodeId: string): { nodes: FlowNode[] } | { error: string } {
  const target = nodes.find((n) => n.node_id === nodeId)
  if (!target) return { error: 'ステップが見つかりません。' }
  const ref = target.output_reference
  const users = ref ? nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.input_references.includes(ref)) : []
  if (users.length) {
    return { error: `この結果をステップ${users.map((u) => u.i + 1).join('・')}が使っているため、削除できません。先にそちらを変更してください。` }
  }
  return { nodes: nodes.filter((n) => n.node_id !== nodeId) }
}

/* ---------- タスク1-3：処理ステップの追加・使うデータの変更 ---------- */

/** まだ選んでいない「使うデータ」の欄。参照名の形式を満たさないので、サーバーの検証で必ず止まる */
export const UNSELECTED = ''

/**
 * 新しいステップを置く位置。「Excelに出力する」は常に最後なので、その下には置かない。
 * after：このステップの下に置く（null なら最後）
 */
export function insertIndex(nodes: FlowNode[], after: string | null): number {
  const outIdx = nodes.findIndex((n) => n.node_type === 'output')
  const at = after === null ? nodes.length : nodes.findIndex((n) => n.node_id === after) + 1
  if (at <= 0) return outIdx >= 0 ? outIdx : nodes.length
  return outIdx >= 0 ? Math.min(at, outIdx) : at
}

/**
 * 追加するステップの初期値。使うデータは「すぐ上のステップの結果」を選んでおく
 * （「表を組み合わせる」の2つ目以降は、利用者が選ぶまで空欄）。
 */
export function newStep(nodes: FlowNode[], type: NodeType, index: number, name: string): Omit<FlowNode, 'node_id'> {
  const above = nodes.slice(0, index).filter((n) => n.output_reference)
  const last = above.at(-1)?.output_reference ?? UNSELECTED
  const count = type === 'join' || type === 'concat' ? 2 : 1
  const refs = Array.from({ length: count }, (_, i) => (i === 0 ? last : UNSELECTED))
  const step: Omit<FlowNode, 'node_id'> = {
    node_type: type,
    node_name: name,
    parameters: defaultParams(type),
    input_references: refs,
    output_reference: type === 'output' ? null : nextId('r', nodes.flatMap((n) => (n.output_reference ? [n.output_reference] : []))),
    confirmation_status: 'unset',
    open_questions: [],
  }
  return { ...step, parameters: syncParams({ ...step, node_id: '' }, nodes) }
}

/** index のステップが使えるデータ（自分より上のステップの結果）。 */
export function dataChoices(nodes: FlowNode[], index: number): { ref: string; step: number; name: string }[] {
  return nodes.slice(0, index).flatMap((n, i) => (n.output_reference ? [{ ref: n.output_reference, step: i + 1, name: n.node_name }] : []))
}

/** index のステップの結果を使っているステップの番号（1始まり）。枝分かれを一覧で示すため。 */
export function usedBy(nodes: FlowNode[], index: number): number[] {
  const ref = nodes[index].output_reference
  if (!ref) return []
  return nodes.flatMap((n, i) => (n.input_references.includes(ref) ? [i + 1] : []))
}

/** 使うデータを変える。自分より下のステップの結果や、自分自身の結果は選べない。 */
export function setInputs(nodes: FlowNode[], nodeId: string, refs: string[]): { nodes: FlowNode[] } | { error: string } {
  const index = nodes.findIndex((n) => n.node_id === nodeId)
  if (index < 0) return { error: 'ステップが見つかりません。' }
  const allowed = new Set(dataChoices(nodes, index).map((c) => c.ref))
  const bad = refs.find((r) => r !== UNSELECTED && !allowed.has(r))
  if (bad !== undefined) return { error: '使えるのは、このステップより上にあるステップの結果だけです。' }
  // 縦にまとめる・出力の設定（表ごとの設定）を、使うデータの並びにそろえる
  return {
    nodes: nodes.map((n) => {
      if (n.node_id !== nodeId) return n
      const changed = { ...n, input_references: refs }
      return { ...changed, parameters: syncParams(changed, nodes) }
    }),
  }
}

/**
 * 保存用に整える：ステップどうしのつながりの記録を計算し直し、更新日時を進める。
 * bump が true なら版数を1つ上げる（初めての保存では上げず、版1のまま保存する）。
 */
export function prepareForSave(flow: FlowDoc, now: Date = new Date(), bump = true): FlowDoc {
  return {
    ...flow,
    flow_version: bump ? flow.flow_version + 1 : flow.flow_version,
    updated_at: now.toISOString(),
    dependencies: computeDependencies(flow.nodes),
  }
}

/** 未保存の変更があるかを判定するための、内容の比較用の文字列（キーの順序に影響されない）。 */
export function snapshot(flow: FlowDoc): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  return JSON.stringify(sortKeys(flow))
}
