/*
 * 処理ステップの種類の一覧（画面の名前・使うデータの数・追加メニューの分類）。
 * 名前は docs/ui-terminology.md §2、使うデータの数は docs/flow-schema.md §4.2 と同じ。
 */

import type { NodeType } from './types'

export type StepGroup = 'rows' | 'columns' | 'combine' | 'calc' | 'quality' | 'output'

export type StepTypeInfo = {
  /** 画面の名前 */
  name: string
  /** 詳細設定での正式名 */
  technical: string
  /** 何をするかの例（追加メニューに表示） */
  example: string
  /** 使うデータの数（最小・最大） */
  inputs: [number, number]
  group: StepGroup
}

export const STEP_TYPES: Record<NodeType, StepTypeInfo> = {
  load: { name: 'ファイルを読み込む', technical: '読込', example: '「売上実績」を読み込む', inputs: [0, 0], group: 'rows' },
  filter: { name: '条件に合う行だけ残す', technical: '行の抽出', example: '金額が1,000円以上の行だけ残す', inputs: [1, 1], group: 'rows' },
  sort: { name: '並べ替える', technical: '並べ替え', example: '金額の大きい順に並べ替える', inputs: [1, 1], group: 'rows' },
  select_columns: { name: '必要な列を取り出す', technical: '列の抽出', example: '売上日・商品コード・金額の3列を取り出す', inputs: [1, 1], group: 'columns' },
  rename_columns: { name: '列の名前を変える', technical: '列名の変更', example: '「売上金額」を「金額」に変える', inputs: [1, 1], group: 'columns' },
  drop_columns: { name: '不要な列を消す', technical: '列の削除', example: '「備考」「担当者」を消す', inputs: [1, 1], group: 'columns' },
  add_constant: { name: '同じ値の列を追加する', technical: '固定値列の追加', example: '「対象月」列を追加（全行 2026/10）', inputs: [1, 1], group: 'columns' },
  cast: { name: 'データの形式をそろえる', technical: '型変換', example: '「金額」を数値にそろえる', inputs: [1, 1], group: 'quality' },
  duplicates: { name: '重複を調べる・取り除く', technical: '重複処理', example: '伝票番号の重複を調べる', inputs: [1, 1], group: 'quality' },
  missing: { name: '空欄を調べる・埋める', technical: '欠損値処理', example: '「数量」の空欄を0で埋める', inputs: [1, 1], group: 'quality' },
  join: { name: '別の表から情報を付け加える', technical: 'データ結合', example: '商品コードを使って、商品マスタの商品名を付け加える', inputs: [2, 2], group: 'combine' },
  concat: { name: '複数の表を縦にまとめる', technical: 'データ連結', example: '東京・大阪・名古屋の表を1つにまとめる', inputs: [2, 10], group: 'combine' },
  aggregate: { name: '項目ごとに合計・集計する', technical: 'グループ別集計', example: '部署ごとに金額を合計する', inputs: [1, 1], group: 'calc' },
  calculate: { name: '計算した列を追加する', technical: '計算列', example: '「数量 × 単価」で「金額」を計算する', inputs: [1, 1], group: 'calc' },
  output: { name: 'Excelに出力する', technical: 'Excel出力', example: '「部署別売上」など3シートを出力する', inputs: [1, 10], group: 'output' },
}

/** 追加メニューの並び（ファイルの読み込みは「使う列と形式を決める」画面で追加する） */
export const STEP_GROUPS: { group: StepGroup; label: string }[] = [
  { group: 'rows', label: '行を絞る・並べる' },
  { group: 'columns', label: '列を整える' },
  { group: 'combine', label: '表を組み合わせる' },
  { group: 'calc', label: '集計・計算する' },
  { group: 'quality', label: 'データを確かめる・整える' },
  { group: 'output', label: '出力する' },
]

/** 使うデータの欄の名前（例：結合なら「元の表」「付け加える表」） */
export function inputSlotLabel(type: NodeType, slot: number): string {
  if (type === 'join') return slot === 0 ? '元の表' : '付け加える表'
  if (type === 'concat') return `まとめる表${slot + 1}`
  if (type === 'output') return `出力する表${slot + 1}`
  return '使うデータ'
}
