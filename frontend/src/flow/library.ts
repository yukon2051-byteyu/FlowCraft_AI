/*
 * タスク1-8：ブラウザの中の「保存した作業手順」の一覧。
 *
 * - 保存先はこのブラウザの localStorage（他の人・他のPCとは共有されない）
 * - 作業手順（処理の手順と使う列の定義）だけを保存する。業務データ（Excelの中身）は保存しない
 * - 1つの作業手順（flow_id）につき、最新の版を1つ持つ。版の履歴は Phase 2（変更の記録）で扱う
 * - localStorage は使えない場合（プライベートブラウズ・容量不足など）があるため、
 *   読み書きの失敗は例外を外に出さず、理由を日本語で返す
 */

import type { FlowDoc } from './types'

export const LIBRARY_KEY = 'flowcraft.savedFlows.v1'

/** 一覧に表示する要約（中身を開かなくても分かる情報） */
export type SavedFlowSummary = {
  flow_id: string
  flow_name: string
  flow_version: number
  updated_at: string
  step_count: number
  input_count: number
}

type Entry = { summary: SavedFlowSummary; flow: FlowDoc }

export type LibraryResult = { ok: true } | { ok: false; error: string }

/** テストで差し替えられるよう、保存先を引数で受け取る（省略時はブラウザの localStorage） */
type Store = Pick<Storage, 'getItem' | 'setItem'>

function storage(store?: Store): Store | null {
  if (store) return store
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readAll(store?: Store): Entry[] {
  const s = storage(store)
  if (!s) return []
  try {
    const raw = s.getItem(LIBRARY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // 壊れた内容が入っていても画面を止めない（読めたものだけ使う）
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is Entry => !!e && typeof e === 'object' && 'summary' in e && 'flow' in e)
  } catch {
    return []
  }
}

function writeAll(entries: Entry[], store?: Store): LibraryResult {
  const s = storage(store)
  if (!s) return { ok: false, error: 'このブラウザでは、ブラウザの中への保存が使えません（プライベートブラウズなど）。ファイルに保存してください。' }
  try {
    s.setItem(LIBRARY_KEY, JSON.stringify(entries))
    return { ok: true }
  } catch {
    return { ok: false, error: 'ブラウザの保存領域がいっぱいで保存できませんでした。不要な作業手順を一覧から削除するか、ファイルに保存してください。' }
  }
}

export function summarize(flow: FlowDoc): SavedFlowSummary {
  return {
    flow_id: flow.flow_id,
    flow_name: flow.flow_name,
    flow_version: flow.flow_version,
    updated_at: flow.updated_at,
    step_count: flow.nodes.length,
    input_count: flow.input_definitions.length,
  }
}

/** 保存した作業手順の一覧（更新日時の新しい順） */
export function listSaved(store?: Store): SavedFlowSummary[] {
  return readAll(store)
    .map((e) => e.summary)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getSaved(flowId: string, store?: Store): FlowDoc | null {
  return readAll(store).find((e) => e.summary.flow_id === flowId)?.flow ?? null
}

/** 保存する。同じ作業手順（flow_id）がすでにあれば、新しい版で置き換える */
export function saveToLibrary(flow: FlowDoc, store?: Store): LibraryResult {
  const others = readAll(store).filter((e) => e.summary.flow_id !== flow.flow_id)
  return writeAll([...others, { summary: summarize(flow), flow }], store)
}

export function removeFromLibrary(flowId: string, store?: Store): LibraryResult {
  return writeAll(readAll(store).filter((e) => e.summary.flow_id !== flowId), store)
}

/** 保存するファイルの名前：「作業手順の名前_v版.json」。ファイル名に使えない文字は「_」に置き換える */
export function flowFileName(flow: FlowDoc): string {
  // Windowsでファイル名に使えない記号と、改行などの見えない文字
  const safe =
    [...flow.flow_name]
      .map((c) => (c.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(c) ? '_' : c))
      .join('')
      .trim() || '作業手順'
  return `${safe}_v${flow.flow_version}.json`
}

/** ファイルに書き出す内容（人が開いても読めるよう、字下げする） */
export function flowFileText(flow: FlowDoc): string {
  return JSON.stringify(flow, null, 2) + '\n'
}
