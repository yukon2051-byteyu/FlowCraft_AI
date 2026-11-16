import type { Improvement, Scenario } from '../api/kaizen'

/*
 * 業務改善デモ STEP 5「改善後の作業の進め方」の内容を、実際の改善の結果から作る（固定の文を書かない）。
 * 比較表（サーバーが作った comparison）と同じデータから作るので、数値が食い違わない。
 * 自動化を採用しないことも、業務改善の有効な選択肢として伝える（「実行できない」「失敗」と見せない）。
 */

export type Outcome = {
  headline: string
  summary: string
  stepsBefore: number
  stepsAfter: number
  removed: string[] // なくした工程の名前
  keptChecks: string[] // 続ける確認
  automated: boolean
  minutesBefore: number
  minutesAfter: number
}

export function buildOutcome(sc: Scenario, imp: Improvement): Outcome {
  const used = new Set(imp.after_steps.flatMap((a) => a.from_steps))
  const removed = sc.steps.filter((s) => !used.has(s.step_id)).map((s) => s.name)
  const automated = imp.flow !== null
  const keptChecks = sc.context.must_keep
  const stepsBefore = sc.steps.length
  const stepsAfter = imp.after_steps.length

  const parts: string[] = []
  parts.push(stepsAfter < stepsBefore ? `${stepsBefore}工程から${stepsAfter}工程に整理し` : `${stepsBefore}工程の流れを見直し`)
  const dupRemoved = sc.steps.some((s) => s.action === 'transcribe' && removed.includes(s.name))
  parts.push(dupRemoved ? '重複していた転記作業をなくしました。' : removed.length ? `${removed.length}つの工程をなくしました。` : '工程の中身を整理しました。')
  const keep = keptChecks.join('・')
  const tail = keep
    ? automated
      ? `${keep}など、必要な確認は自動の検証として残しました。`
      : `${keep}など、必要な確認作業は引き続き人が実施します。`
    : ''
  return {
    headline: removed.length || stepsAfter < stepsBefore || automated ? '必要な作業を残し、手順を整理しました' : '今の手順のまま進めます',
    summary: parts.join('、') + tail,
    stepsBefore,
    stepsAfter,
    removed,
    keptChecks,
    automated,
    minutesBefore: imp.minutes_before,
    minutesAfter: imp.minutes_after,
  }
}
