/*
 * 作る画面の状態管理（Zustand）。編集中の作業手順を、画面の中で1か所にまとめて持つ。
 * 一覧・設定フォーム・プレビュー・保存ボタンがすべてここを見るため、表示の食い違いが起きない（設計書 §12）。
 *
 *   flow          ：編集中の作業手順（正本は画面側。サーバーは毎回まるごと受け取って検証・実行する）
 *   bindings      ：入力の割当（作業手順のファイルには保存しない）
 *   savedSnapshot ：最後に保存したときの内容。これと違えば「未保存の変更あり」
 *   exportedSnapshot：最後にExcelへ出力したときの作業手順の内容（今回だけの作業：出力して終われば、離れるときに確認しない）
 */

import { create } from 'zustand'
import { STEP_TYPES } from './catalog'
import {
  contentSnapshot,
  createFlow,
  insertIndex,
  moveNode as moveNodeOp,
  newStep,
  nextId,
  normalizeFlow,
  prepareForSave,
  removeNode as removeNodeOp,
  setInputs,
  snapshot,
} from './ops'
import type { Binding, FlowDoc, FlowNode, InputDefinition, NodeType } from './types'

type Result = { ok: true } | { ok: false; error: string }

type FlowState = {
  flow: FlowDoc
  bindings: Record<string, Binding>
  selectedNodeId: string | null
  savedSnapshot: string | null
  exportedSnapshot: string | null
  /** Excelに出力したことを記録する（snap：出力した結果を実行したときの作業手順の処理の中身＝contentSnapshot） */
  markExported: (snap: string) => void

  newFlow: (name: string) => void
  /** 作業手順を開く。ファイルから読んだ内容をそのまま渡してよい（省略された項目を補う） */
  openFlow: (flow: unknown) => void
  renameFlow: (name: string) => void
  setInputDefinitions: (defs: InputDefinition[]) => void
  /** 「新しく作る」：入力の定義・割当・読み込みステップで、作業手順の最初の形を作る（既存のステップは置き換える） */
  startFromInputs: (defs: InputDefinition[], bindings: Binding[], loadNodes: Omit<FlowNode, 'node_id'>[]) => void
  addNode: (node: Omit<FlowNode, 'node_id'>, index?: number) => string
  /** 処理ステップを追加する（after のステップの下。null なら最後。出力ステップより下には置かない）。追加したIDを返す */
  addStep: (type: NodeType, after: string | null) => string
  /** 処理の設定を変える。確認済みだったステップは「設定が必要」に戻す（変えた内容を確かめ直すため） */
  setParams: (nodeId: string, params: Record<string, unknown>) => void
  /** ステップの名前を変える */
  renameNode: (nodeId: string, name: string) => void
  /** 設定を確認済みにする */
  confirmNode: (nodeId: string) => void
  /** 使うデータを変える（上にあるステップの結果だけ選べる） */
  setNodeInputs: (nodeId: string, refs: string[]) => Result
  updateNode: (nodeId: string, patch: Partial<Omit<FlowNode, 'node_id'>>) => void
  removeNode: (nodeId: string) => Result
  moveNode: (nodeId: string, toIndex: number) => Result
  selectNode: (nodeId: string | null) => void
  setBinding: (binding: Binding) => void
  clearBindings: () => void
  /**
   * 保存用の内容を作り、保存済みとして記録する。戻り値をファイルなどに書き出す。
   * 版数：初めての保存は版1のまま。2回目以降は、変更があるときだけ1つ上げる（変更がなければ同じ版をもう一度保存する）
   * meta：保存の画面で入力した名前・説明
   */
  commitSave: (meta?: { flow_name?: string; description?: string }) => FlowDoc
}

/** 未保存の変更があるか */
export const selectIsDirty = (s: FlowState): boolean => s.savedSnapshot === null || snapshot(s.flow) !== s.savedSnapshot

/**
 * 上部に出す保存の状態（タスク1-11：今回だけの作業では、保存を促し続けない）
 *   none    ：表示しない（作業手順がまだない／保存済みで変更なし）
 *   never   ：一度も保存していない（保存は任意。控えめに表示）
 *   changed ：保存した作業手順を変更した（注意として表示）
 */
export const selectSaveState = (s: FlowState): 'none' | 'never' | 'changed' =>
  s.flow.nodes.length === 0 || !selectIsDirty(s) ? 'none' : s.savedSnapshot === null ? 'never' : 'changed'

/**
 * 離れるときに確認するか：保存していない変更があり、かつ、その内容でExcelに出力していないとき。
 * 出力して終わった今回だけの作業では確認しない（作業は出力したファイルとして手元に残っているため）
 */
export const selectNeedsLeaveGuard = (s: FlowState): boolean =>
  selectSaveState(s) !== 'none' && contentSnapshot(s.flow) !== s.exportedSnapshot

export const useFlowStore = create<FlowState>((set, get) => ({
  flow: createFlow('無題の作業手順'),
  bindings: {},
  selectedNodeId: null,
  savedSnapshot: null,
  exportedSnapshot: null,

  newFlow: (name) => set({ flow: createFlow(name), bindings: {}, selectedNodeId: null, savedSnapshot: null, exportedSnapshot: null }),

  markExported: (snap) => set({ exportedSnapshot: snap }),

  // 開いた直後は「保存済み」の状態（変更していないので、未保存の警告を出さない）
  openFlow: (raw) => {
    const flow = normalizeFlow(raw)
    set({ flow, bindings: {}, selectedNodeId: flow.nodes[0]?.node_id ?? null, savedSnapshot: snapshot(flow), exportedSnapshot: null })
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

  addStep: (type, after) => {
    const nodes = get().flow.nodes
    const index = insertIndex(nodes, after)
    return get().addNode(newStep(nodes, type, index, STEP_TYPES[type].name), index)
  },

  setParams: (nodeId, params) =>
    set((s) => ({
      flow: {
        ...s.flow,
        nodes: s.flow.nodes.map((n) =>
          n.node_id === nodeId ? { ...n, parameters: params, confirmation_status: n.confirmation_status === 'confirmed' ? 'unset' : n.confirmation_status } : n,
        ),
      },
    })),

  renameNode: (nodeId, name) => set((s) => ({ flow: { ...s.flow, nodes: s.flow.nodes.map((n) => (n.node_id === nodeId ? { ...n, node_name: name } : n)) } })),

  confirmNode: (nodeId) =>
    set((s) => ({ flow: { ...s.flow, nodes: s.flow.nodes.map((n) => (n.node_id === nodeId ? { ...n, confirmation_status: 'confirmed', open_questions: [] } : n)) } })),

  setNodeInputs: (nodeId, refs) => {
    const r = setInputs(get().flow.nodes, nodeId, refs)
    if ('error' in r) return { ok: false, error: r.error }
    set((s) => ({ flow: { ...s.flow, nodes: r.nodes } }))
    return { ok: true }
  },

  updateNode: (nodeId, patch) =>
    set((s) => ({ flow: { ...s.flow, nodes: s.flow.nodes.map((n) => (n.node_id === nodeId ? { ...n, ...patch } : n)) } })),

  removeNode: (nodeId) => {
    const r = removeNodeOp(get().flow.nodes, nodeId)
    if ('error' in r) return { ok: false, error: r.error }
    set((s) => {
      // 読み込みステップを消したら、どこからも使われなくなった入力の定義と割当も消す
      const usedInputs = new Set(r.nodes.filter((n) => n.node_type === 'load').map((n) => String(n.parameters.input_id)))
      const defs = s.flow.input_definitions.filter((d) => usedInputs.has(d.input_id))
      const bindings = Object.fromEntries(Object.entries(s.bindings).filter(([id]) => usedInputs.has(id)))
      return {
        flow: { ...s.flow, nodes: r.nodes, input_definitions: defs },
        bindings,
        selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      }
    })
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

  commitSave: (meta) => {
    const s = get()
    const flow = { ...s.flow, ...meta }
    const neverSaved = s.savedSnapshot === null
    if (!neverSaved && snapshot(flow) === s.savedSnapshot) return s.flow
    const saved = prepareForSave(flow, new Date(), !neverSaved)
    set({ flow: saved, savedSnapshot: snapshot(saved) })
    return saved
  },
}))
