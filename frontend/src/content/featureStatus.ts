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
  processing: 'in_development',
  /** 比較分析・ランキング・グラフ */
  analysis: 'in_development',
  /** 作業手順の保存・再実行 */
  saveReuse: 'in_development',
  /** 既存の手順をもとに新しく作る */
  derive: 'in_development',
  /** 品質検証の結果表示 */
  quality: 'in_development',
  /** デモ */
  demo: 'in_development',
  /** 業務の完了基準の設定・評価 */
  criteria: 'in_development',
  /** AI業務改善支援（AI業務改善診断・改善提案・効果の測定）。キー名 kaizen は互換性のため変えない */
  kaizen: 'in_development',
} as const satisfies Record<string, FeatureStatus>

export type FeatureKey = keyof typeof FEATURE_STATUS

export function isAvailable(key: FeatureKey): boolean {
  return FEATURE_STATUS[key] === 'available'
}
