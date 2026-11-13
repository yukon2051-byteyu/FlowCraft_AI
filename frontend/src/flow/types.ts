/*
 * 作業手順（フローJSON）の型。サーバー側の正本 backend/app/flow/schema.py（docs/flow-schema.md）と同じ形。
 * 処理ステップごとの設定（parameters）の細かい型は、設定フォームを作るタスク（1-4・1-5）で追加する。
 * 画面に出す言葉は docs/ui-terminology.md に従う（内部の命名は node / flow のまま）。
 */

/** 1.1（2026-11-13）：完了基準と、実行のたびに指定する値を追加。1.0 のファイルは 1.1 として読む */
export const SCHEMA_VERSION = '1.2'

export type ColumnType = 'string' | 'integer' | 'decimal' | 'date' | 'boolean'

export type ColumnSchema = {
  name: string
  type: ColumnType
  scale?: number | null
  date_format?: string | null
  required?: boolean
}

export type InputDefinition = {
  input_id: string
  label: string
  file_kind: 'xlsx' | 'csv'
  sheet_hint?: string | null
  header_row?: number
  columns: ColumnSchema[]
}

export type NodeType =
  | 'load'
  | 'filter'
  | 'sort'
  | 'select_columns'
  | 'rename_columns'
  | 'drop_columns'
  | 'add_constant'
  | 'cast'
  | 'duplicates'
  | 'missing'
  | 'join'
  | 'concat'
  | 'aggregate'
  | 'calculate'
  | 'output'

export type ConfirmationStatus = 'unset' | 'ai_proposed' | 'pending' | 'confirmed'

export type OpenQuestion = { param: string; question: string }

export type FlowNode = {
  node_id: string
  node_type: NodeType
  node_name: string
  parameters: Record<string, unknown>
  input_references: string[]
  output_reference: string | null
  confirmation_status: ConfirmationStatus
  open_questions?: OpenQuestion[]
}

export type Dependency = { node_id: string; depends_on: string[] }

/** 実行のたびに指定する値（例：対象月） */
export type RunParameter = {
  param_id: string
  label: string
  type: 'month' | 'date' | 'integer' | 'decimal' | 'string'
  required?: boolean
}

/** 完了基準の値の代わりに書く「実行時に指定する値」の参照 */
export type ParamRef = { $param: string }

export type CriterionKind =
  | 'required_columns'
  | 'data_type'
  | 'no_blank'
  | 'unique'
  | 'value_range'
  | 'period'
  | 'total_match'
  | 'row_count'
  | 'all_matched'
  | 'expected_value'
  | 'list_rows'
  /** 前回からの変化（品質MVP・12種類目）。閾値がなければ数値を示すだけ */
  | 'change_from_previous'

/** 完了基準（何を満たせば完了？）。種類ごとの設定（params）の細かい型は、設定画面のタスク（2-4）で追加する */
export type Criterion = {
  criterion_id: string
  /** 品質ルールの識別（1.2）。作業手順をまたいでルールを追える。1.1 以前のファイルは「<flow_id>:<criterion_id>」で補う */
  rule_id: string
  /** ルールの設定を変えて保存するたびに +1。履歴に「どの版で検証したか」を残す */
  rule_version: number
  /** 複製元のルール（複製したときに記録する。複製元を変えても複製先は変わらない） */
  copied_from?: { rule_id: string; rule_version: number } | null
  name: string
  kind: CriterionKind
  target: { ref: string; column?: string | null }
  params?: Record<string, unknown>
  /** 満たさないとき：critical（重大）／caution（注意）／record（記録のみ） */
  on_fail: 'critical' | 'caution' | 'record'
  origin?: 'template' | 'manual' | 'ai'
  confirmation_status?: ConfirmationStatus
  note?: string
}

export type CompletionCriteria = {
  /** 完了基準を変えるたびに +1（作業手順の版数とは別） */
  version: number
  items: Criterion[]
  changelog: { version: number; changed_at: string; summary: string }[]
}

export type FlowDoc = {
  schema_version: string
  engine_version: string
  flow_id: string
  flow_version: number
  flow_name: string
  description: string
  created_at: string
  updated_at: string
  input_definitions: InputDefinition[]
  nodes: FlowNode[]
  dependencies: Dependency[]
  validation_rules?: Record<string, unknown>
  run_parameters: RunParameter[]
  completion_criteria: CompletionCriteria
}

/** 入力の割当（実行データ）。作業手順のファイルには保存しない（設計書 §5.2）。 */
export type Binding = {
  input_id: string
  file_id: string
  sheet: string | null
  header_row: number
  column_mapping: Record<string, string>
}
