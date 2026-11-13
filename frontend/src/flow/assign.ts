/*
 * タスク1-9：保存した作業手順を開いたあと、今回のファイルを「入力」に割り当てる。
 * 画面から切り離した純粋な関数（単体テストで確かめる）。
 *
 * 列の確かめ方（Phase 1 の範囲）：
 *   - 必須の列がファイルにない → 実行前に止める（理由を示す）
 *   - 任意の列がない           → 注意（空欄の列として読み込む。エンジンと同じ扱い）
 *   - 定義にない列がある        → お知らせ（読み込まない）
 * 列名が変わった場合は、利用者が承認した対応付け（例：今回の「金額」→ 前回の「売上金額」）を当ててから確かめる（Phase 3-2）。
 */

import { suggestLabel } from './define'
import type { InputDefinition } from './types'

export type ColumnCheck = {
  missingRequired: string[]
  missingOptional: string[]
  extra: string[]
}

export function checkColumns(def: InputDefinition, fileColumns: string[]): ColumnCheck {
  const have = new Set(fileColumns)
  const defined = new Set(def.columns.map((c) => c.name))
  return {
    missingRequired: def.columns.filter((c) => c.required && !have.has(c.name)).map((c) => c.name),
    missingOptional: def.columns.filter((c) => !c.required && !have.has(c.name)).map((c) => c.name),
    extra: fileColumns.filter((c) => !defined.has(c)),
  }
}

/** 承認した対応付けを当てた列名（今回のファイルの列名を、前回の列名に置き換える。実行時の読み込みと同じ） */
export function mappedColumns(fileColumns: string[], mapping: Record<string, string>): string[] {
  return fileColumns.map((c) => mapping[c] ?? c)
}

type FileLike = { file_id: string; filename: string; kind: 'xlsx' | 'csv' }

/**
 * 入力ごとに、割り当てるファイルの候補を選ぶ。
 * ファイル名から年月を除いた名前が入力の名前と同じものを選ぶ（例：入力「売上実績」←「売上実績_2026-11.xlsx」）。
 * 候補が2つ以上ある・見つからないときは選ばない（曖昧なまま勝手に選ばない）。1つのファイルは1つの入力にだけ使う。
 */
export function suggestAssignments(defs: InputDefinition[], files: FileLike[]): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const d of defs) {
    const hits = files.filter((f) => f.kind === d.file_kind && !used.has(f.file_id) && suggestLabel(f.filename) === d.label)
    if (hits.length === 1) {
      out[d.input_id] = hits[0].file_id
      used.add(hits[0].file_id)
    }
  }
  return out
}

export type AssignState = {
  fileId: string | null
  /** 読み込んだシートの列名（未取得なら null） */
  columns: string[] | null
}

/** 割当を確定できない理由（なければ空）。押せないボタンの近くに表示する */
export function assignProblems(defs: InputDefinition[], state: Record<string, AssignState>, fileNames: Record<string, string>): string[] {
  const problems: string[] = []
  const chosen = defs.map((d) => state[d.input_id]?.fileId).filter((x): x is string => !!x)
  for (const d of defs) {
    const s = state[d.input_id]
    if (!s?.fileId) {
      problems.push(`「${d.label}」に使うファイルを選んでください`)
      continue
    }
    if (!s.columns) continue
    const { missingRequired } = checkColumns(d, s.columns)
    if (missingRequired.length) {
      problems.push(`「${d.label}」に選んだ「${fileNames[s.fileId] ?? ''}」に、必須の列${missingRequired.map((c) => `「${c}」`).join('')}がありません`)
    }
  }
  const dup = chosen.filter((f, i) => chosen.indexOf(f) !== i)
  for (const f of new Set(dup)) problems.push(`「${fileNames[f] ?? ''}」を2つの入力に選んでいます。入力ごとに別のファイルを選んでください`)
  return problems
}
