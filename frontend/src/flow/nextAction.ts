import type { RunSummary } from '../api/flows'

/*
 * STEP 4「実行・品質確認」の画面下部に出す、今の状態（1行）と次に押すボタン（1つ）。
 * 異常があるときは「次へ」を押せなくするだけにせず、その異常を確かめる操作を示す。
 *
 * 判定の区別は、サーバーが返す出力の扱い（verdict.export）にそのまま従う（新しい基準を足さない）。
 *   allowed            … 正式に出力できる（正常・確認不要の注意）
 *   needs_confirmation … 確認したうえで出力できる（確認必須の注意・必須でない基準の未検証）
 *   report_only        … 正式な出力を止める（重大・必須の基準の未検証）
 * 優先順：作業手順を変えた後の古い結果 → 処理の失敗 → 重大 → 必須の検証が未完了 → 確認が必要 → 次へ
 * 正式に出力してよいかの最終判断はサーバーが行う（GET /api/runs/{id}/export）。ここは画面の案内だけ。
 */
export type NextKind = 'next' | 'confirm' | 'critical' | 'unverified' | 'failed' | 'stale'
export type NextAction = {
  kind: NextKind
  /** 画面下部の中央に出す今の状態（1行） */
  status: string
  /** 主要ボタンの文言（矢印は画面で付ける） */
  button: string
  /** ボタンの色：ミント（進む）／アンバー（注意・未検証）／コーラル（重大・失敗） */
  tone: 'mint' | 'amber' | 'coral'
  /** 移動先（画面内の欄）。stale は作業手順へ戻る */
  target: 'output' | 'run-confirm' | 'run-criteria' | 'run-steps' | 'procedure'
}

export function nextAction(run: RunSummary, confirmed: boolean, stale: boolean): NextAction {
  if (stale) {
    return { kind: 'stale', status: '実行後に作業手順を変更しました。この結果は出力に使えません', button: '作業手順に戻って再実行する', tone: 'amber', target: 'procedure' }
  }
  if (run.status === 'failed') {
    return { kind: 'failed', status: '処理が途中で止まりました。正式な出力はできません', button: 'エラーの詳細を確認する', tone: 'coral', target: 'run-steps' }
  }
  const v = run.verdict
  if (v?.export === 'report_only') {
    if (v.verdict === 'unverified') {
      return { kind: 'unverified', status: '必須の検証が完了していません。正式な出力を停止しています', button: '未完了の検証を確認する', tone: 'amber', target: 'run-criteria' }
    }
    const fromCriteria = run.criteria.some((c) => c.status === 'failed' && c.on_fail === 'critical')
    return { kind: 'critical', status: '重大な異常：正式な出力を停止しています', button: '異常の詳細を確認する', tone: 'coral', target: fromCriteria ? 'run-criteria' : 'run-steps' }
  }
  if (v?.export === 'needs_confirmation' && !confirmed) {
    const status = v.verdict === 'unverified' ? '確かめられなかった基準があります。確認してから出力できます' : '注意：確認してから出力できます'
    return { kind: 'confirm', status, button: '注意事項を確認する', tone: 'amber', target: 'run-confirm' }
  }
  const status =
    !v || v.verdict === 'normal'
      ? '正常：正式な出力ができます'
      : v.export === 'needs_confirmation'
        ? '確認済み：出力できます'
        : '注意：お知らせがあります（出力できます）'
  return { kind: 'next', status, button: '次へ：出力・保存', tone: 'mint', target: 'output' }
}
