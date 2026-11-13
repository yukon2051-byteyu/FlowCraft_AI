/**
 * 機能ごとの提供状況（TOP・開始画面の「開発中」表示の元データ）。
 *
 * 未実装の機能を、使えるかのように見せないための一覧。
 * 機能が画面から使えるようになったら、ここを 'available' に変えるだけで表示が切り替わる。
 * 判断の基準は「一般の利用者が画面から操作して使えるか」（内部の処理が完成していても、画面がなければ開発中）。
 */
export type FeatureStatus = 'available' | 'in_development'

export const FEATURE_STATUS = {
  /** Excel・CSVの読み込みと内容確認 */
  upload: 'available',
  /** AIによる作業手順の提案 */
  aiFlow: 'in_development',
  /** 加工・結合・集計を画面から実行 */
  processing: 'available',
  /** 比較分析・ランキング・グラフ */
  analysis: 'in_development',
  /** 作業手順の保存・再実行 */
  saveReuse: 'available',
  /** 既存の手順をもとに新しく作る */
  derive: 'in_development',
  /**
   * 作業の部品化と再利用（処理ステップを部品として保存・複製・組み合わせ・変更し、別の業務へ使う）。
   * 作業手順全体の保存・読み込み・再実行（saveReuse）とは別の機能。部品単位の保存・複製・組み合わせは未実装
   */
  stepReuse: 'in_development',
  /** 品質検証の結果表示 */
  quality: 'available',
  /** デモ */
  demo: 'available',
  /** デモの案件（M1-2：データと作業手順を作成済み） */
  demoProductMatch: 'available',
  demoInventory: 'available',
  /** 業務の完了基準の設定・評価 */
  criteria: 'available',
  /** AI業務改善支援（AI業務改善診断・改善提案・効果の測定）。キー名 kaizen は互換性のため変えない */
  kaizen: 'in_development',
  /** 無人定期実行（共通Workerが、有効化された案件だけを決まった日時に実行する） */
  schedule: 'in_development',
  /** クラウドで3分後に自動実行を試す（サンプルデータ）。公開・実測ができたら available にし、表示を「今すぐ試せる」にする */
  scheduleCloud: 'in_development',
  /** Windows Worker（自分のPCのフォルダで無人実行）。Windows 11 での確認ができたら available にする */
  scheduleWindows: 'in_development',
} as const satisfies Record<string, FeatureStatus>

export type FeatureKey = keyof typeof FEATURE_STATUS

export function isAvailable(key: FeatureKey): boolean {
  return FEATURE_STATUS[key] === 'available'
}
