import { beforeEach, describe, expect, it } from 'vitest'
import { checkOrder, dataChoices, describeInputs, insertIndex, moveNode, newStep, setInputs, UNSELECTED, usedBy } from './ops'
import { useFlowStore } from './store'
import type { FlowNode, InputDefinition } from './types'

/*
 * タスク1-3：処理ステップの追加・使うデータ・移動の決まり。
 * デモの作業手順と同じ形（結合2回・集計で枝分かれ・最後に出力）で確かめる。
 */

const step = (id: string, type: FlowNode['node_type'], inputs: string[], out: string | null, extra: Partial<FlowNode> = {}): FlowNode => ({
  node_id: id,
  node_type: type,
  node_name: id,
  parameters: {},
  input_references: inputs,
  output_reference: out,
  confirmation_status: 'confirmed',
  open_questions: [],
  ...extra,
})

// 1 売上を読む → 2 商品マスタを読む → 3 結合 → 4 部署マスタを読む → 5 結合 → 6・7 集計（枝分かれ）→ 8 出力
const FLOW: FlowNode[] = [
  step('n1', 'load', [], 'in1', { parameters: { input_id: 'in1' } }),
  step('n2', 'load', [], 'in2', { parameters: { input_id: 'in2' } }),
  step('n3', 'join', ['in1', 'in2'], 'r1'),
  step('n4', 'load', [], 'in3', { parameters: { input_id: 'in3' } }),
  step('n5', 'join', ['r1', 'in3'], 'r2'),
  step('n6', 'aggregate', ['r2'], 'r3'),
  step('n7', 'aggregate', ['r2'], 'r4'),
  step('n8', 'output', ['r3', 'r4', 'r2'], null),
]

describe('結合・枝分かれを含む作業手順の表示', () => {
  const labels = { in1: '売上実績', in2: '商品マスタ', in3: '部署マスタ' }

  it('各ステップの「使うデータ」', () => {
    expect(describeInputs(FLOW, 2, labels)).toEqual(['ステップ1の結果', 'ステップ2の結果'])
    expect(describeInputs(FLOW, 4, labels)).toEqual(['ステップ3の結果', 'ステップ4の結果'])
    expect(describeInputs(FLOW, 7, labels)).toEqual(['ステップ6の結果', 'ステップ7の結果', 'ステップ5の結果'])
  })

  it('結果を使うステップ（枝分かれ）', () => {
    expect(usedBy(FLOW, 4)).toEqual([6, 7, 8]) // 結合の結果を、集計2つと出力が使う
    expect(usedBy(FLOW, 0)).toEqual([3])
    expect(usedBy(FLOW, 7)).toEqual([]) // 出力は結果を作らない
  })

  it('選べるデータは、上にあるステップの結果だけ', () => {
    expect(dataChoices(FLOW, 2).map((c) => c.step)).toEqual([1, 2])
    expect(dataChoices(FLOW, 0)).toEqual([])
  })
})

describe('つながりを壊す移動は、理由を示して止める', () => {
  it('使うデータより上へは動かせない', () => {
    const r = moveNode(FLOW, 'n6', 3) // 集計を、結合（ステップ5）より上へ
    // 番号と名前は、移動する前（＝画面に表示中）のもの
    expect(r).toEqual({ error: 'このステップはステップ5「n5」の結果を使うため、それより上には動かせません。' })
  })

  it('結果を使われているステップを、使う側より下へは動かせない', () => {
    // 商品マスタの読み込みを、それを使う結合より下へ
    expect(moveNode(FLOW, 'n2', 3)).toEqual({ error: 'このステップの結果をステップ3「n3」が使っているため、それより下には動かせません。' })
  })

  it('出力は最後から動かせない／出力より下へも動かせない', () => {
    expect(moveNode(FLOW, 'n8', 6)).toEqual({ error: expect.stringContaining('最後に置いて') })
    expect(moveNode(FLOW, 'n7', 7)).toEqual({ error: expect.stringContaining('最後に置いて') })
  })

  it('つながりを壊さない移動はできる', () => {
    const r = moveNode(FLOW, 'n4', 0) // 部署マスタの読み込みを先頭へ
    expect('nodes' in r && r.nodes.map((n) => n.node_id)).toEqual(['n4', 'n1', 'n2', 'n3', 'n5', 'n6', 'n7', 'n8'])
    const swap = moveNode(FLOW, 'n7', 5) // 枝分かれした集計どうしの入れ替え
    expect('nodes' in swap && checkOrder(swap.nodes)).toEqual({ ok: true })
  })
})

describe('ステップの追加', () => {
  it('置く位置：出力より下には置かない', () => {
    expect(insertIndex(FLOW, null)).toBe(7) // 最後＝出力の直前
    expect(insertIndex(FLOW, 'n8')).toBe(7)
    expect(insertIndex(FLOW, 'n3')).toBe(3)
    expect(insertIndex(FLOW.slice(0, 3), null)).toBe(3) // 出力がなければ本当の最後
  })

  it('使うデータは、すぐ上のステップの結果。組み合わせの2つ目は空欄', () => {
    const s = newStep(FLOW, 'filter', 3, '条件に合う行だけ残す')
    expect(s.input_references).toEqual(['r1'])
    expect(s.output_reference).toBe('r5') // 既存の結果名と重ならない
    expect(s.confirmation_status).toBe('unset')
    const j = newStep(FLOW, 'join', 7, '別の表から情報を付け加える')
    expect(j.input_references).toEqual(['r4', UNSELECTED])
    expect(describeInputs([...FLOW.slice(0, 7), { ...j, node_id: 'x' }], 7, {})).toEqual(['ステップ7の結果', '（まだ選んでいません）'])
    expect(newStep(FLOW, 'output', 8, '出力').output_reference).toBeNull()
  })

  it('使うデータの変更：下のステップや自分の結果は選べない', () => {
    expect('nodes' in setInputs(FLOW, 'n5', ['in1', 'in3'])).toBe(true)
    expect(setInputs(FLOW, 'n3', ['r2', 'in2'])).toEqual({ error: expect.stringContaining('上にあるステップの結果だけ') })
    expect('error' in setInputs(FLOW, 'n3', ['r1', 'in2'])).toBe(true) // 自分自身の結果
    expect('nodes' in setInputs(FLOW, 'n3', ['in1', UNSELECTED])).toBe(true) // 空欄に戻すのは可
  })
})

describe('状態管理での追加・削除', () => {
  const defs: InputDefinition[] = ['in1', 'in2', 'in3'].map((id) => ({ input_id: id, label: id, file_kind: 'xlsx', columns: [] }))

  beforeEach(() => {
    const s = useFlowStore.getState()
    s.newFlow('テスト')
    s.startFromInputs(
      defs,
      defs.map((d) => ({ input_id: d.input_id, file_id: `f-${d.input_id}`, sheet: null, header_row: 1, column_mapping: {} })),
      FLOW.filter((n) => n.node_type === 'load').map(({ node_id: _id, ...n }) => n),
    )
  })

  it('最後に追加すると、追加したステップが選ばれる。出力があればその上に入る', () => {
    const s = useFlowStore.getState()
    const out = s.addStep('output', null)
    const id = useFlowStore.getState().addStep('aggregate', null)
    const nodes = useFlowStore.getState().flow.nodes
    expect(nodes.map((n) => n.node_id).slice(-2)).toEqual([id, out])
    expect(useFlowStore.getState().selectedNodeId).toBe(id)
  })

  it('使われていない読み込みステップを消すと、入力の定義と割当も消える', () => {
    const r = useFlowStore.getState().removeNode('n3') // 部署マスタの読み込み（in3）
    expect(r).toEqual({ ok: true })
    const s = useFlowStore.getState()
    expect(s.flow.input_definitions.map((d) => d.input_id)).toEqual(['in1', 'in2'])
    expect(Object.keys(s.bindings)).toEqual(['in1', 'in2'])
  })

  it('使われているステップは消せない', () => {
    useFlowStore.getState().addStep('join', null) // 使うデータ：in3（すぐ上）
    expect(useFlowStore.getState().removeNode('n3')).toEqual({ ok: false, error: expect.stringContaining('ステップ4が使っている') })
  })
})
