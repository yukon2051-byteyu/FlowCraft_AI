import type { SheetDetail } from '../../../api/files'
import type { InputDefinition } from '../../../flow/types'

/** 説明の対応先（処理ステップ n…・完了基準 c…）を、作業手順の画面と同じ呼び方にする */
export function refLabel(ref: string, nodes: { node_id: string; node_name: string }[], criteria: { criterion_id: string; name: string }[]): string {
  const i = nodes.findIndex((n) => n.node_id === ref)
  if (i >= 0) return `ステップ${i + 1}「${nodes[i].node_name}」`
  const c = criteria.find((x) => x.criterion_id === ref)
  return c ? `品質ルール「${c.name}」` : ref
}

/** 対応先がすべて品質ルール（完了基準）か */
export function isRuleStep(refs: string[], criteria: { criterion_id: string }[]): boolean {
  return refs.length > 0 && refs.every((r) => criteria.some((c) => c.criterion_id === r))
}

/** 作業手順が必ず使う列のうち、ファイルにない列（STEP 2 の手順と、実際のデータの列の一致を確かめる） */
export function missingColumns(def: InputDefinition, detail: SheetDetail): string[] {
  const have = new Set(detail.columns.map((c) => c.name))
  return def.columns.filter((c) => c.required !== false && !have.has(c.name)).map((c) => c.name)
}
