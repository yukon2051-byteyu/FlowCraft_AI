import { apiRequest } from './client'

/*
 * ファイルAPIの型。backend/app/files/service.py の応答モデルと同じ形。
 * （今後、バックエンドのOpenAPI定義から自動生成に切り替える予定）
 */

export type ColumnType = 'string' | 'integer' | 'decimal' | 'date' | 'boolean'

export type ColumnInfo = {
  name: string
  inferred_type: ColumnType
  non_null_count: number
  null_count: number
  unique_count: number
  samples: string[]
  note: string | null
}

export type FileWarning = { code: string; message: string }

export type SheetDetail = {
  sheet: string
  header_row: number
  row_count: number
  column_count: number
  columns: ColumnInfo[]
  preview: { columns: string[]; rows: (string | null)[][]; shown: number; total: number }
  warnings: FileWarning[]
}

export type SheetSummary = { name: string; hidden: boolean; is_empty: boolean }

export type FileSummary = {
  file_id: string
  filename: string
  kind: 'xlsx' | 'csv'
  encoding: string | null
  size_bytes: number
  uploaded_at: string
  sheets: SheetSummary[]
}

export type UploadResult = FileSummary & { detail: SheetDetail }

export function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<UploadResult>('/api/files', { method: 'POST', body: form })
}

export function listFiles(): Promise<FileSummary[]> {
  return apiRequest<FileSummary[]>('/api/files')
}

/** sheet を省略すると、サーバーが選ぶ既定のシート（表示中でデータのある最初のシート） */
export function fetchSheet(fileId: string, sheet: string | null, headerRow: number): Promise<SheetDetail> {
  const q = new URLSearchParams({ header_row: String(headerRow) })
  if (sheet !== null) q.set('sheet', sheet)
  return apiRequest<SheetDetail>(`/api/files/${encodeURIComponent(fileId)}?${q}`)
}

export function deleteFile(fileId: string): Promise<void> {
  return apiRequest<void>(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
}

/* ---------- 形式の確認（選んだデータの形式で、全件を変換できるか） ---------- */

export type TypeCheckColumn = { name: string; type: ColumnType }

export type TypeCheckResult = {
  name: string
  type: ColumnType
  found: boolean
  converted: number
  failed: number
  blank: number
  examples: { row: number; value: string | null }[]
}

export function typeCheck(fileId: string, sheet: string, headerRow: number, columns: TypeCheckColumn[]): Promise<TypeCheckResult[]> {
  return apiRequest<TypeCheckResult[]>(`/api/files/${encodeURIComponent(fileId)}/type-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet, header_row: headerRow, columns }),
  })
}

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  string: '文字',
  integer: '整数',
  decimal: '小数',
  date: '日付',
  boolean: 'はい／いいえ',
}
