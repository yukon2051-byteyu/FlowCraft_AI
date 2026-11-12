import type { NodeStatus } from '../ui/nodeStatus'

/*
 * 作業画面の「サンプル表示」用の架空の作業手順。
 * 画面の文言は用語集（docs/ui-terminology.md）に合わせている。
 * 作業手順の読み込み・編集（Phase 3）ができたら、実際の作業手順に置き換える。
 */

export type NodeType = 'load' | 'select_columns' | 'join' | 'aggregate' | 'output'

/** 処理の名前（一般の利用者向け）。詳細設定では正式名（technical）も補足として表示する */
export const NODE_TYPE_LABEL: Record<NodeType, { name: string; technical: string }> = {
  load: { name: 'ファイルを読み込む', technical: '読込' },
  select_columns: { name: '必要な列を取り出す', technical: '列の抽出' },
  join: { name: '別の表から情報を付け加える', technical: 'データ結合' },
  aggregate: { name: '項目ごとに合計・集計する', technical: 'グループ別集計' },
  output: { name: 'Excelに出力する', technical: 'Excel出力' },
}

export type Param = {
  label: string
  value: string
  /** AIが提案した値（未確認の間は強調する） */
  ai?: boolean
  /** 項目の短い説明 */
  help?: string
}

export type QuestionOption = { label: string; effect: string; available: boolean }

export type Question = {
  /** 何を確認したいか */
  text: string
  /** なぜ確認するのか（確認しないと何が起きうるか） */
  reason: string
  /** 回答と、その回答で処理がどう変わるか */
  options: QuestionOption[]
  /** 画面上部の「次の操作」に出す短い話題 */
  topic: string
}

export type SampleNode = {
  node_id: string
  node_type: NodeType
  /** 業務の言葉での具体的な処理内容 */
  description: string
  status: NodeStatus
  params: Param[]
  question?: Question
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
    description: '「売上実績_2026-10.xlsx」の「売上」シートを読み込む',
    status: 'confirmed',
    params: [
      { label: '読み込むファイル', value: '売上実績_2026-10.xlsx（シート「売上」）' },
      { label: '列名が書かれた行', value: '1行目' },
    ],
  },
  {
    node_id: 'n2',
    node_type: 'select_columns',
    description: '売上日・部署コード・商品コード・数量・金額の5列を取り出す',
    status: 'confirmed',
    params: [
      { label: '残す列', value: '売上日、部署コード、商品コード、数量、金額' },
      { label: '使わない列', value: '担当者、備考、入力日時' },
    ],
    counts: { before: '8列', after: '5列' },
  },
  {
    node_id: 'n3',
    node_type: 'join',
    description: '商品コードを使って、商品マスタの商品名・カテゴリを付け加える',
    status: 'pending',
    params: [
      { label: '元になる表', value: '売上（ステップ2で列を取り出したもの）' },
      { label: '情報を付け加える表', value: '商品マスタ' },
      { label: '照合に使う列', value: '商品コード（売上）＝ 商品コード（商品マスタ）', ai: true, help: '2つの表で同じ値が入っている列。この値が一致する行どうしを結び付けます。' },
      { label: '残す行', value: '売上の行をすべて残す（商品マスタにない行も消さない）', ai: true, help: '正式名：左結合。元になる表の行は、相手が見つからなくても残します。' },
      { label: '行どうしの対応', value: '売上の複数の行 → 商品マスタの1行（商品コードは重複しない）', ai: true, help: '正式名：多対1。1つの商品に、売上の行がいくつも対応する関係です。' },
      { label: '商品マスタに見つからないとき', value: '警告を出して続ける（売上の行は消さない）' },
    ],
    question: {
      text: '商品コードは、商品マスタの中で1商品につき1つだけですか？',
      reason: '商品マスタに同じ商品コードが2行以上あると、売上の行が複製され、売上が重複して集計されるおそれがあります。',
      options: [
        { label: 'はい、1つだけ', effect: 'このまま商品名を付け加えます。実行時にも重複がないか自動で確認します。', available: true },
        { label: 'いいえ、重複がある', effect: '実行前に、重複している商品コードの一覧を表示して止めます。', available: false },
      ],
      topic: '商品コードの重複',
    },
    counts: { before: '1,250件', after: '1,250件（予測）', note: '商品マスタに見つからない 3件' },
  },
  {
    node_id: 'n4',
    node_type: 'join',
    description: '部署コードを使って、部署マスタの部署名を付け加える',
    status: 'ai_proposed',
    params: [
      { label: '情報を付け加える表', value: '部署マスタ' },
      { label: '照合に使う列', value: '部署コード（売上）＝ 部署コード（部署マスタ）', ai: true },
      { label: '行どうしの対応', value: '売上の複数の行 → 部署マスタの1行', ai: true },
    ],
  },
  {
    node_id: 'n5',
    node_type: 'aggregate',
    description: '部署名ごとに金額を合計し、件数を数える',
    status: 'ai_proposed',
    params: [
      { label: 'まとめる単位', value: '部署名', ai: true },
      { label: '計算する内容', value: '金額の合計、件数', ai: true },
      { label: '端数の処理', value: '四捨五入（円単位）' },
    ],
  },
  {
    node_id: 'n6',
    node_type: 'output',
    description: '出力するシートがまだ決まっていません',
    status: 'unset',
    params: [{ label: '出力するシート', value: '未設定' }],
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

/** 画面上部の「次の操作」に出す案内（用語集 §4） */
export function nextActionHint(nodes: SampleNode[]): string {
  const asking = nodes.findIndex((n) => n.status === 'pending' && n.question)
  if (asking >= 0) return `ステップ${asking + 1}の確認が必要です。${nodes[asking].question!.topic}について回答してください`
  const proposed = nodes.filter((n) => n.status === 'ai_proposed').length
  if (proposed) return `AIの提案を確認してください（残り${proposed}ステップ）`
  const unset = nodes.findIndex((n) => n.status === 'unset')
  if (unset >= 0) return `ステップ${unset + 1}「${NODE_TYPE_LABEL[nodes[unset].node_type].name}」の設定が必要です`
  return 'すべての処理内容を確認しました。作業を実行できます'
}
