/*
 * 作る画面の状態管理（Zustand）。編集中の作業手順を、画面の中で1か所にまとめて持つ。
 * 一覧・設定フォーム・プレビュー・保存ボタンがすべてここを見るため、表示の食い違いが起きない（設計書 §12）。
 *
 *   flow          ：編集中の作業手順（正本は画面側。サーバーは毎回まるごと受け取って検証・実行する）
 *   bindings      ：入力の割当（作業手順のファイルには保存しない）
 *   savedSnapshot ：最後に保存したときの内容。これと違えば「未保存の変更あり」
 */

import { create } from 'zustand'
import { createFlow, moveNode as moveNodeOp, nextId, normalizeFlow, prepareForSave, removeNode as removeNodeOp, snapshot } from './ops'
import type { Binding, FlowDoc, FlowNode, InputDefinition } from './types'

type Result = { ok: true } | { ok: false; error: string }

type FlowState = {
  flow: FlowDoc
  bindings: Record<string, Binding>
  selectedNodeId: string | null
  savedSnapshot: string | null

  newFlow: (name: string) => void
  /** 作業手順を開く。ファイルから読んだ内容をそのまま渡してよい（省略された項目を補う） */
  openFlow: (flow: unknown) => void
  renameFlow: (name: string) => void
  setInputDefinitions: (defs: InputDefinition[]) => void
  /** 「新しく作る」：入力の定義・割当・読み込みステップで、作業手順の最初の形を作る（既存のステップは置き換える） */
  startFromInputs: (defs: InputDefinition[], bindings: Binding[], loadNodes: Omit<FlowNode, 'node_id'>[]) => void
  addNode: (node: Omit<FlowNode, 'node_id'>, index?: number) => string
  updateNode: (nodeId: string, patch: Partial<Omit<FlowNode, 'node_id'>>) => void
  removeNode: (nodeId: string) => Result
  moveNode: (nodeId: string, toIndex: number) => Result
  selectNode: (nodeId: string | null) => void
  setBinding: (binding: Binding) => void
  clearBindings: () => void
  /** 保存用の内容を作り（版数を上げる）、保存済みとして記録する。戻り値をファイルなどに書き出す */
  commitSave: () => FlowDoc
}

/** 未保存の変更があるか */
export const selectIsDirty = (s: FlowState): boolean => s.savedSnapshot === null || snapshot(s.flow) !== s.savedSnapshot

export const useFlowStore = create<FlowState>((set, get) => ({
  flow: createFlow('無題の作業手順'),
  bindings: {},
  selectedNodeId: null,
  savedSnapshot: null,

  newFlow: (name) => set({ flow: createFlow(name), bindings: {}, selectedNodeId: null, savedSnapshot: null }),

  // 開いた直後は「保存済み」の状態（変更していないので、未保存の警告を出さない）
  openFlow: (raw) => {
    const flow = normalizeFlow(raw)
    set({ flow, bindings: {}, selectedNodeId: flow.nodes[0]?.node_id ?? null, savedSnapshot: snapshot(flow) })
  },

  renameFlow: (name) => set((s) => ({ flow: { ...s.flow, flow_name: name } })),

  setInputDefinitions: (defs) => set((s) => ({ flow: { ...s.flow, input_definitions: defs } })),

  startFromInputs: (defs, bindings, loadNodes) =>
    set((s) => {
      const nodes = loadNodes.map((n, i) => ({ ...n, node_id: `n${i + 1}` }))
      return {
        flow: { ...s.flow, input_definitions: defs, nodes },
        bindings: Object.fromEntries(bindings.map((b) => [b.input_id, b])),
        selectedNodeId: nodes[0]?.node_id ?? null,
      }
    }),

  addNode: (node, index) => {
    const id = nextId('n', get().flow.nodes.map((n) => n.node_id))
    set((s) => {
      const nodes = [...s.flow.nodes]
      nodes.splice(index ?? nodes.length, 0, { ...node, node_id: id })
      return { flow: { ...s.flow, nodes }, selectedNodeId: id }
    })
    return id
  },

  updateNode: (nodeId, patch) =>
    set((s) => ({ flow: { ...s.flow, nodes: s.flow.nodes.map((n) => (n.node_id === nodeId ? { ...n, ...patch } : n)) } })),

  removeNode: (nodeId) => {
    const r = removeNodeOp(get().flow.nodes, nodeId)
    if ('error' in r) return { ok: false, error: r.error }
    set((s) => ({ flow: { ...s.flow, nodes: r.nodes }, selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId }))
    return { ok: true }
  },

  moveNode: (nodeId, toIndex) => {
    const r = moveNodeOp(get().flow.nodes, nodeId, toIndex)
    if ('error' in r) return { ok: false, error: r.error }
    set((s) => ({ flow: { ...s.flow, nodes: r.nodes } }))
    return { ok: true }
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setBinding: (binding) => set((s) => ({ bindings: { ...s.bindings, [binding.input_id]: binding } })),

  clearBindings: () => set({ bindings: {} }),

  commitSave: () => {
    const saved = prepareForSave(get().flow)
    set({ flow: saved, savedSnapshot: snapshot(saved) })
    return saved
  },
}))
