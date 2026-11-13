/*
 * 「新しく作る」：読み込んだファイルから、作業手順の入力の定義（使う列とデータの形式）を作る。
 * 画面の部品から切り離した純粋な関数にしておき、単体テストで確かめる。
 */

import { DEFAULT_BLANK_RULES } from './types'
import type { BlankAction, BlankRules, Binding, ColumnType, FlowNode, InputDefinition } from './types'

/** 1つの列について、利用者が決めた内容 */
export type ColumnChoice = {
  name: string
  use: boolean
  type: ColumnType
  /** 今後のファイルにも必ずある列か（ない場合は実行前に止める） */
  required: boolean
  /** 値が空欄のときの扱い（Phase Q）。null＝決めていない（任意の列は許可とみなす。必須の列は実行すると未検証） */
  blank?: BlankAction | null
}

/** 1つのファイルについて、利用者が決めた内容 */
export type InputChoice = {
  fileId: string
  fileName: string
  kind: 'xlsx' | 'csv'
  sheet: string
  headerRow: number
  label: string
  columns: ColumnChoice[]
  /** 表の途中の空白行・最後の行（合計・メモの可能性）・空白文字の扱い（Phase Q） */
  blankRules?: BlankRules
}

/**
 * 空白データの扱いで、まだ決めていないこと（Phase Q-4・案A）。決めずに作ることもできるが、実行すると「未検証」になる。
 * blanks：読み込んだファイルの検出結果（列名 → 空欄の件数）、中間の空白行の数、合計の行の可能性の有無
 */
export function undecidedBlanks(i: InputChoice, blanks: { columns: Record<string, number>; middleRows: number; lastRow: boolean }): string[] {
  const out: string[] = []
  const rules = i.blankRules ?? DEFAULT_BLANK_RULES
  for (const c of i.columns) {
    if (c.use && c.required && !c.blank && (blanks.columns[c.name] ?? 0) > 0) out.push(`「${i.fileName}」の「${c.name}」の空欄の扱い`)
  }
  if (blanks.middleRows > 0 && rules.blank_rows === 'unset') out.push(`「${i.fileName}」の表の途中の空白行の扱い`)
  if (blanks.lastRow && rules.last_row === 'unset') out.push(`「${i.fileName}」の最後の行（合計・メモの可能性）の扱い`)
  return out
}

// 年月・日付を表す部分（例：2026-10、202610、2026年10月、10月分、R8年10月）
const DATE_PART = String.raw`(\d{4}[-_./年]?\d{1,2}(月分?|[-_./]\d{1,2}日?)?|\d{6,8}|\d{1,2}月分?|(令和|R)\d{1,2}年?\d{0,2}月?)`
const TRAILING_DATE = new RegExp(String.raw`[\s_\-（(]*` + DATE_PART + String.raw`[）)]*$`)
const LEADING_DATE = new RegExp('^' + DATE_PART + String.raw`[\s_\-]*`)

/**
 * 入力の名前の候補。作業手順は毎月使うので、ファイル名に含まれる年月や日付を取り除く。
 * 例：「売上実績_2026-10.xlsx」→「売上実績」、「202610_在庫台帳.csv」→「在庫台帳」
 */
export function suggestLabel(fileName: string): string {
  const base = fileName.replace(/\.(xlsx|csv)$/i, '')
  const s = base.replace(TRAILING_DATE, '').replace(LEADING_DATE, '').replace(/[\s_-]+$/g, '').trim()
  return s || base
}

/** 作る前に直す必要があること（なければ空）。押せないボタンの理由として表示する */
export function choiceProblems(inputs: InputChoice[], failedColumns: Record<string, string[]>): string[] {
  const problems: string[] = []
  const labels = inputs.map((i) => i.label.trim())
  inputs.forEach((i, n) => {
    if (!labels[n]) problems.push(`「${i.fileName}」の入力の名前を入れてください`)
    if (!i.columns.some((c) => c.use)) problems.push(`「${i.fileName}」で使う列を1つ以上選んでください`)
    const failed = failedColumns[i.fileId] ?? []
    if (failed.length) {
      problems.push(`「${i.fileName}」の${failed.map((c) => `「${c}」`).join('')}に、選んだ形式にできない値があります。形式を変えるか、使わない列にしてください`)
    }
  })
  const dup = labels.filter((l, i) => l && labels.indexOf(l) !== i)
  if (dup.length) problems.push(`入力の名前「${[...new Set(dup)].join('」「')}」が重なっています。区別できる名前にしてください`)
  return problems
}

/**
 * 決めた内容から、入力の定義・入力の割当・読み込みステップを作る。
 * 入力のID（in1, in2 …）は内部用。画面には入力の名前（label）を表示する。
 */
export function buildFromChoices(inputs: InputChoice[]): {
  definitions: InputDefinition[]
  bindings: Binding[]
  loadNodes: Omit<FlowNode, 'node_id'>[]
} {
  const definitions: InputDefinition[] = []
  const bindings: Binding[] = []
  const loadNodes: Omit<FlowNode, 'node_id'>[] = []
  inputs.forEach((i, n) => {
    const id = `in${n + 1}`
    const label = i.label.trim()
    definitions.push({
      input_id: id,
      label,
      file_kind: i.kind,
      sheet_hint: i.kind === 'xlsx' ? i.sheet : null,
      header_row: i.headerRow,
      columns: i.columns.filter((c) => c.use).map((c) => ({ name: c.name, type: c.type, required: c.required, ...(c.blank ? { blank: { action: c.blank } } : {}) })),
      blank_rules: { ...DEFAULT_BLANK_RULES, ...(i.blankRules ?? {}) },
    })
    bindings.push({ input_id: id, file_id: i.fileId, sheet: i.kind === 'xlsx' ? i.sheet : null, header_row: i.headerRow, column_mapping: {} })
    loadNodes.push({
      node_type: 'load',
      node_name: `${label}を読み込む`,
      parameters: { input_id: id },
      input_references: [],
      output_reference: id,
      // 利用者が列と形式を確認して作ったステップなので、確認済みとする
      confirmation_status: 'confirmed',
      open_questions: [],
    })
  })
  return { definitions, bindings, loadNodes }
}
