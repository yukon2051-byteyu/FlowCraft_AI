import type { NodeStatus } from '../ui/nodeStatus'

/*
 * ワークスペースの「サンプル表示」用の架空フロー。
 * 処理エンジン（Phase 1 後半）とフローJSON（タスク1-6）が完成したら、
 * 実データ・実フローに置き換える。項目名は設計書 §5 のフローJSONに合わせている。
 */

export type NodeType = 'load' | 'select_columns' | 'join' | 'aggregate' | 'output'

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  load: 'ファイル読込',
  select_columns: '列の抽出',
  join: 'データ結合',
  aggregate: 'グループ別集計',
  output: 'Excel出力',
}

export type SampleNode = {
  node_id: string
  node_type: NodeType
  node_name: string
  summary: string
  status: NodeStatus
  /** 設定パネルに表示する項目（ラベル, 値, AI提案かどうか） */
  params: { label: string; value: string; ai?: boolean }[]
  /** AIからの確認（未回答なら確認待ち） */
  question?: { text: string; yes: string; no: string }
  counts?: { before: string; after: string; note?: string }
}

export const SAMPLE_INPUTS = [
  { label: '売上実績', file: '売上実績_2026-10.xlsx', sheet: '売上', rows: '1,250行 × 8列' },
  { label: '商品マスタ', file: '商品マスタ.xlsx', sheet: 'マスタ', rows: '320行 × 6列' },
  { label: '部署マスタ', file: '部署マスタ.csv', sheet: '—', rows: '18行 × 3列' },
]

export const SAMPLE_NODES: SampleNode[] = [
  {
    node_id: 'n1',
    node_type: 'load',
    node_name: '売上実績を読み込む',
    summary: '1,250行 × 8列',
    status: 'confirmed',
    params: [
      { label: '入力', value: '売上実績（売上実績_2026-10.xlsx／シート「売上」）' },
      { label: 'ヘッダー行', value: '1行目' },
    ],
  },
  {
    node_id: 'n2',
    node_type: 'select_columns',
    node_name: '必要な列を抽出',
    summary: '8列 → 5列',
    status: 'confirmed',
    params: [
      { label: '残す列', value: '売上日、部署コード、商品コード、数量、金額' },
      { label: '除外する列', value: '担当者、備考、入力日時' },
    ],
    counts: { before: '8列', after: '5列' },
  },
  {
    node_id: 'n3',
    node_type: 'join',
    node_name: '商品マスタと結合',
    summary: '商品コードで左結合',
    status: 'pending',
    params: [
      { label: '左のデータ', value: '「必要な列を抽出」の結果' },
      { label: '右のデータ', value: '商品マスタ' },
      { label: '結合キー', value: '商品コード ＝ 商品コード', ai: true },
      { label: '結合方式', value: '左結合（売上の行をすべて残す）', ai: true },
      { label: '期待する関係', value: '多対1（売上 複数 : 商品 1）', ai: true },
      { label: '未照合の扱い', value: '警告して続行し、一覧を出力' },
    ],
    question: {
      text: '商品マスタの「商品コード」は重複しない前提でよいですか？（重複がある場合、結合後に売上の行数が増えます）',
      yes: 'はい、重複しない',
      no: 'いいえ、重複がある',
    },
    counts: { before: '1,250件', after: '1,250件（予測）', note: '未照合 3件' },
  },
  {
    node_id: 'n4',
    node_type: 'join',
    node_name: '部署マスタと結合',
    summary: '部署コードで左結合',
    status: 'ai_proposed',
    params: [
      { label: '右のデータ', value: '部署マスタ' },
      { label: '結合キー', value: '部署コード ＝ 部署コード', ai: true },
      { label: '期待する関係', value: '多対1', ai: true },
    ],
  },
  {
    node_id: 'n5',
    node_type: 'aggregate',
    node_name: '部署別に売上を集計',
    summary: '部署名ごとに金額を合計',
    status: 'ai_proposed',
    params: [
      { label: 'グループ化する列', value: '部署名', ai: true },
      { label: '集計', value: '金額の合計、件数', ai: true },
      { label: '丸め', value: '四捨五入（円単位）' },
    ],
  },
  {
    node_id: 'n6',
    node_type: 'output',
    node_name: 'Excelに出力',
    summary: '出力するシートが未設定',
    status: 'unset',
    params: [{ label: '出力シート', value: '未設定' }],
  },
]

export const SAMPLE_PREVIEW = {
  columns: [
    { name: '売上日' },
    { name: '商品コード' },
    { name: '金額', numeric: true },
    { name: '商品名', added: true },
    { name: 'カテゴリ', added: true },
  ],
  rows: [
    ['2026/10/01', 'A-1001', '128,000', 'ノートPC 14型', 'PC本体'],
    ['2026/10/01', 'B-2040', '54,600', 'ワイヤレスマウス', '周辺機器'],
    ['2026/10/02', 'A-1001', '96,000', 'ノートPC 14型', 'PC本体'],
    ['2026/10/02', 'C-3300 ', '18,900', null, null],
    ['2026/10/03', 'B-2051', '32,400', 'USBハブ 7ポート', '周辺機器'],
  ] as (string | null)[][],
  shown: 5,
  total: '1,250',
}
