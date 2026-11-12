/*
 * 作業手順（フローJSON）の型。サーバー側の正本 backend/app/flow/schema.py（docs/flow-schema.md）と同じ形。
 * 処理ステップごとの設定（parameters）の細かい型は、設定フォームを作るタスク（1-4・1-5）で追加する。
 * 画面に出す言葉は docs/ui-terminology.md に従う（内部の命名は node / flow のまま）。
 */

export const SCHEMA_VERSION = '1.0'

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
}

/** 入力の割当（実行データ）。作業手順のファイルには保存しない（設計書 §5.2）。 */
export type Binding = {
  input_id: string
  file_id: string
  sheet: string | null
  header_row: number
  column_mapping: Record<string, string>
}
