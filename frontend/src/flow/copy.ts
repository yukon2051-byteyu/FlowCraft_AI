/*
 * 作業手順の写しを作る（新ワークフロー Phase 2）。画面から切り離した純粋な関数（単体テストで確かめる）。
 *
 *   ひな形から作る：用意した作業手順（デモの手順）をもとに、作業起点の「仮の手順」を作る
 *   別名で保存（複製）：保存した手順をもとに、別の業務用の手順を作る（W-5）
 *
 * どちらも：
 *   - 新しい手順ID（flow_id）を発行し、版は1から。作成日時・更新日時は今
 *   - 品質ルール（完了基準）は写すが、ルールごとに新しい識別を作り、複製元（copied_from）を記録する
 *     （複製元を変えても、写しは変わらない）
 *   - 写したルールは「未確認」（pending）にする。対象の列・期間・基準値を利用者が確かめて「確認済み」にするまで、
 *     評価では「未検証」として扱う（重大のルールなら正式な出力を止める。U-1）
 *   - 完了基準の変更の記録は引き継がない（新しい手順の記録として始める）
 *   - 実行の記録・前回比較の基準は、作業手順のファイルに入っていないため、引き継がれない
 */

import { createFlow, normalizeFlow, newRuleId } from './ops'
import type { FlowDoc } from './types'

export function copyFlow(raw: unknown, meta: { name: string; description?: string }, now: Date = new Date()): FlowDoc {
  const src = normalizeFlow(raw)
  const fresh = createFlow(meta.name, now)
  return {
    ...src,
    flow_id: fresh.flow_id,
    flow_version: 1,
    flow_name: meta.name,
    description: meta.description ?? src.description,
    created_at: fresh.created_at,
    updated_at: fresh.updated_at,
    completion_criteria: {
      version: 1,
      changelog: [],
      items: src.completion_criteria.items.map((c) => ({
        ...c,
        rule_id: newRuleId(),
        rule_version: 1,
        copied_from: { rule_id: c.rule_id, rule_version: c.rule_version },
        confirmation_status: 'pending',
      })),
    },
  }
}
