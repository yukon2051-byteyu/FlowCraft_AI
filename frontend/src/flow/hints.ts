/*
 * 作業手順の画面の「次の操作」の案内。状況に応じて、次にすべきことを1つだけ示す。
 */

import { STEP_TYPES } from './catalog'
import { UNSELECTED } from './ops'
import type { FlowNode } from './types'

export function editHint(nodes: FlowNode[]): string {
  const work = nodes.filter((n) => n.node_type !== 'load')
  if (work.length === 0) return '「処理ステップを追加する」から、行いたい処理を追加してください'
  const noInput = nodes.findIndex((n) => n.input_references.includes(UNSELECTED))
  if (noInput >= 0) return `ステップ${noInput + 1}「${nodes[noInput].node_name}」で使うデータを選んでください`
  if (!nodes.some((n) => n.node_type === 'output')) return `最後に「${STEP_TYPES.output.name}」を追加してください`
  const unset = nodes.findIndex((n) => n.confirmation_status !== 'confirmed')
  if (unset >= 0) return `ステップ${unset + 1}「${nodes[unset].node_name}」の設定が必要です。ステップを選び、右側で設定してください`
  return '作業手順ができました。「作業手順全体を実行する」で結果を確かめてください'
}
