import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkOrder, computeDependencies, contentSnapshot, createFlow, describeInputs, moveNode, nextId, normalizeFlow, prepareForSave, removeNode, snapshot } from './ops'
import type { FlowDoc } from './types'

// デモの作業手順（結合2回・1つのデータから2つの集計を作る枝分かれを含む）
// ファイルの内容そのまま（省略された項目がある）
const RAW = JSON.parse(readFileSync(fileURLToPath(new URL('../../../backend/app/demos/flows/monthly_sales.json', import.meta.url)), 'utf-8'))
const DEMO: FlowDoc = normalizeFlow(RAW)
const LABELS = { sales: '売上実績', products: '商品マスタ', depts: '部署マスタ' }
const ids = (f: { nodes: { node_id: string }[] }) => f.nodes.map((n) => n.node_id)

describe('ファイルから読んだ作業手順の補完', () => {
  it('1.0 のファイルは 1.1 として読み、完了基準・実行時に指定する値は空にする（2-1）', () => {
    expect(RAW.schema_version).toBe('1.0')
    expect(DEMO.schema_version).toBe('1.1')
    expect(DEMO.run_parameters).toEqual([])
    expect(DEMO.completion_criteria).toEqual({ version: 1, items: [], changelog: [] })
  })

  it('1.0 なのに 1.1 の項目がある不正なファイルは、版を変えずにサーバーの検証に任せる', () => {
    expect(normalizeFlow({ ...RAW, completion_criteria: { items: [] } }).schema_version).toBe('1.0')
  })

  it('1.1 のファイルの完了基準は、そのまま残る', () => {
    const c = { criterion_id: 'c1', name: '部署は4つ', kind: 'row_count' as const, target: { ref: 'by_dept' }, params: { min: 4, max: 4 }, on_fail: 'caution' as const }
    const f = normalizeFlow({ ...RAW, schema_version: '1.1', run_parameters: [{ param_id: 'm', label: '対象月', type: 'month' }], completion_criteria: { version: 3, items: [c], changelog: [] } })
    expect(f.completion_criteria.items).toEqual([c])
    expect(f.completion_criteria.version).toBe(3)
    expect(f.run_parameters[0].label).toBe('対象月')
  })

  it('完了基準を変えると、処理の中身の比較でも「変わった」と判定する（実行結果が古くなるため）', () => {
    const c = { criterion_id: 'c1', name: '部署は4つ', kind: 'row_count' as const, target: { ref: 'by_dept' }, params: { min: 4 }, on_fail: 'caution' as const }
    expect(contentSnapshot({ ...DEMO, completion_criteria: { ...DEMO.completion_criteria, items: [c] } })).not.toBe(contentSnapshot(DEMO))
  })

  it('列の「必須」が省略されていれば必須とする（サーバーと同じ初期値）', () => {
    const sales = DEMO.input_definitions.find((d) => d.input_id === 'sales')!
    expect(sales.columns.find((c) => c.name === '売上金額')?.required).toBe(true)
    expect(sales.columns.find((c) => c.name === '備考')?.required).toBe(false) // 明示した false はそのまま
  })

  it('省略された項目を初期値で補う（読み込みステップの使うデータ、出力ステップの作るデータなど）', () => {
    expect(RAW.nodes[0].input_references).toBeUndefined() // ファイルでは省略されている
    expect(DEMO.nodes[0].input_references).toEqual([])
    expect(DEMO.nodes[8].output_reference).toBeNull()
    expect(DEMO.nodes[0].open_questions).toEqual([])
    expect(DEMO.input_definitions[0].header_row).toBe(1)
    expect(DEMO.dependencies).toEqual([])
  })

  it('書かれている値は変えない', () => {
    expect(DEMO.nodes[3].input_references).toEqual(['sales_selected', 'products'])
    expect(DEMO.flow_name).toBe('月次売上集計（デモ）')
  })
})

describe('作業手順の作成', () => {
  it('新しい作業手順は空で、版数1、推測できないIDを持つ', () => {
    const f = createFlow('月次売上集計', new Date('2026-11-12T00:00:00Z'))
    expect(f.nodes).toEqual([])
    expect(f.flow_version).toBe(1)
    expect(f.schema_version).toBe('1.1') // 新しく作る作業手順は最新の形（2-1）
    expect(f.flow_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(createFlow('x').flow_id).not.toBe(f.flow_id)
  })

  it('新しいIDは既存のIDと重ならない', () => {
    expect(nextId('n', ['n1', 'n2', 'n4'])).toBe('n3')
    expect(nextId('n', [])).toBe('n1')
  })
})

describe('縦の一覧での依存関係の表示', () => {
  it('結合は2つの入力、集計は同じ結果から枝分かれしていることを表示できる', () => {
    expect(describeInputs(DEMO.nodes, 0, LABELS)).toEqual(['読み込むファイル：売上実績'])
    expect(describeInputs(DEMO.nodes, 3, LABELS)).toEqual(['ステップ2の結果', 'ステップ3の結果']) // 商品マスタと結合
    expect(describeInputs(DEMO.nodes, 6, LABELS)).toEqual(['ステップ6の結果']) // 部署別に集計
    expect(describeInputs(DEMO.nodes, 7, LABELS)).toEqual(['ステップ6の結果']) // カテゴリ別に集計（同じ結果から枝分かれ）
    expect(describeInputs(DEMO.nodes, 8, LABELS)).toEqual(['ステップ7の結果', 'ステップ8の結果', 'ステップ6の結果'])
  })

  it('依存関係の計算はサーバー側と同じ結果になる', () => {
    const deps = Object.fromEntries(computeDependencies(DEMO.nodes).map((d) => [d.node_id, d.depends_on]))
    expect(deps.n1).toEqual([])
    expect(deps.n4).toEqual(['n2', 'n3'])
    expect(deps.n9).toEqual(['n7', 'n8', 'n6'])
  })
})

describe('並べ替え（上にあるデータしか使えない）', () => {
  it('つながりを壊さない移動はできる', () => {
    const r = moveNode(DEMO.nodes, 'n3', 0) // 商品マスタの読み込みを先頭へ
    expect('nodes' in r && ids(r)).toEqual(['n3', 'n1', 'n2', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
    const r2 = moveNode(DEMO.nodes, 'n8', 6) // 2つの集計の入れ替え
    expect('nodes' in r2).toBe(true)
  })

  it('使うデータより上へは移動できず、理由を示す', () => {
    const r = moveNode(DEMO.nodes, 'n4', 1)
    expect(r).toEqual({ error: expect.stringContaining('の結果を使うため、それより上には動かせません') })
  })

  it('「Excelに出力する」より下には置けない', () => {
    // 出力より上へ動かすと、使うデータの順序が崩れるため止まる
    expect(moveNode(DEMO.nodes, 'n9', 3)).toHaveProperty('error')
    expect(moveNode(DEMO.nodes, 'n1', 8)).toHaveProperty('error')
    // 参照の順序は正しいが、出力が最後にない場合（出力の下に、別のファイルの読み込みを置く）
    const small = normalizeFlow({
      nodes: [
        { node_id: 'a', node_type: 'load', parameters: { input_id: 'x' }, output_reference: 'x' },
        { node_id: 'o', node_type: 'output', parameters: {}, input_references: ['x'] },
        { node_id: 'b', node_type: 'load', parameters: { input_id: 'y' }, output_reference: 'y' },
      ],
    }).nodes
    expect(checkOrder(small)).toEqual({ ok: false, reason: expect.stringContaining('最後に置いて') })
  })

  it('範囲外・存在しないステップ', () => {
    expect(moveNode(DEMO.nodes, 'n1', -1)).toHaveProperty('error')
    expect(moveNode(DEMO.nodes, 'zzz', 0)).toHaveProperty('error')
  })

  it('元の配列は書き換えない', () => {
    const before = ids(DEMO)
    moveNode(DEMO.nodes, 'n3', 0)
    expect(ids(DEMO)).toEqual(before)
  })

  it('正しい順序はOK', () => {
    expect(checkOrder(DEMO.nodes)).toEqual({ ok: true })
  })
})

describe('削除', () => {
  it('結果を使われているステップは削除できない（理由を示す）', () => {
    expect(removeNode(DEMO.nodes, 'n6')).toEqual({ error: expect.stringContaining('ステップ7・8・9') })
  })

  it('使われていないステップは削除できる', () => {
    const r = removeNode(DEMO.nodes, 'n9')
    expect('nodes' in r && r.nodes).toHaveLength(8)
  })
})

describe('保存の準備・未保存の判定', () => {
  it('保存のたびに版数が上がり、つながりの記録が計算される（初めての保存では上げない）', () => {
    const saved = prepareForSave(DEMO, new Date('2026-12-01T00:00:00Z'))
    expect(saved.flow_version).toBe(DEMO.flow_version + 1)
    expect(saved.updated_at).toBe('2026-12-01T00:00:00.000Z')
    expect(saved.dependencies).toEqual(computeDependencies(DEMO.nodes))
    expect(DEMO.flow_version).toBe(1) // 元は変えない
    expect(prepareForSave(DEMO, new Date(), false).flow_version).toBe(DEMO.flow_version)
  })

  it('比較用の文字列は、項目の順序が違っても同じになる', () => {
    const a = { ...DEMO }
    const b = Object.fromEntries(Object.entries(DEMO).reverse()) as FlowDoc
    expect(snapshot(a)).toBe(snapshot(b))
    expect(snapshot({ ...DEMO, flow_name: '別名' })).not.toBe(snapshot(DEMO))
  })
})
