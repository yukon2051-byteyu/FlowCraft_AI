import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeFlow } from './ops'
import { selectIsDirty, useFlowStore } from './store'
import type { FlowDoc } from './types'

// ファイルの内容そのまま（省略された項目がある）
const RAW = JSON.parse(readFileSync(fileURLToPath(new URL('../../../backend/app/demos/flows/monthly_sales.json', import.meta.url)), 'utf-8'))
const DEMO: FlowDoc = normalizeFlow(RAW)
const store = () => useFlowStore.getState()

beforeEach(() => store().newFlow('テスト'))

describe('作る画面の状態管理', () => {
  it('新しく作った直後は未保存（まだ一度も保存していない）', () => {
    expect(selectIsDirty(store())).toBe(true)
    expect(store().flow.flow_name).toBe('テスト')
  })

  it('省略された項目があるファイルの内容をそのまま開ける', () => {
    store().openFlow(RAW)
    expect(store().flow.nodes[0].input_references).toEqual([])
    expect(selectIsDirty(store())).toBe(false)
  })

  it('開いた直後は保存済み。変更すると未保存になり、保存すると保存済みに戻る', () => {
    store().openFlow(DEMO)
    expect(selectIsDirty(store())).toBe(false)
    expect(store().selectedNodeId).toBe('n1')

    store().renameFlow('月次売上集計（営業部）')
    expect(selectIsDirty(store())).toBe(true)

    const saved = store().commitSave()
    expect(saved.flow_version).toBe(2)
    expect(saved.flow_name).toBe('月次売上集計（営業部）')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('変更を元に戻すと未保存の印も消える', () => {
    store().openFlow(DEMO)
    store().renameFlow('一時的な名前')
    store().renameFlow(DEMO.flow_name)
    expect(selectIsDirty(store())).toBe(false)
  })

  it('ステップの追加・設定の変更・選択', () => {
    const id = store().addNode({
      node_type: 'load',
      node_name: '売上を読み込む',
      parameters: { input_id: 'sales' },
      input_references: [],
      output_reference: 'sales',
      confirmation_status: 'unset',
    })
    expect(id).toBe('n1')
    expect(store().selectedNodeId).toBe('n1')
    store().updateNode('n1', { confirmation_status: 'confirmed' })
    expect(store().flow.nodes[0].confirmation_status).toBe('confirmed')
  })

  it('移動・削除が決まりに反するときは、状態を変えずに理由を返す', () => {
    store().openFlow(DEMO)
    const before = store().flow.nodes.map((n) => n.node_id)
    expect(store().moveNode('n4', 1)).toEqual({ ok: false, error: expect.stringContaining('の結果を使うため、それより上には動かせません') })
    expect(store().removeNode('n6')).toEqual({ ok: false, error: expect.any(String) })
    expect(store().flow.nodes.map((n) => n.node_id)).toEqual(before)
    expect(selectIsDirty(store())).toBe(false)

    expect(store().moveNode('n3', 0)).toEqual({ ok: true })
    expect(selectIsDirty(store())).toBe(true)
  })

  it('入力の割当は作業手順の内容に含まれない（保存しても割当は入らない）', () => {
    store().openFlow(DEMO)
    store().setBinding({ input_id: 'sales', file_id: 'f_x', sheet: '売上', header_row: 1, column_mapping: { 金額: '売上金額' } })
    expect(selectIsDirty(store())).toBe(false) // 割当の変更は作業手順の変更ではない
    const saved = store().commitSave()
    expect(JSON.stringify(saved)).not.toContain('f_x')
    expect(store().bindings.sales.column_mapping).toEqual({ 金額: '売上金額' })
  })

  it('別の作業手順を開くと、前の割当は消える', () => {
    store().openFlow(DEMO)
    store().setBinding({ input_id: 'sales', file_id: 'f_x', sheet: null, header_row: 1, column_mapping: {} })
    store().openFlow({ ...DEMO, flow_id: 'other' })
    expect(store().bindings).toEqual({})
  })
})
