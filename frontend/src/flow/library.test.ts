import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { flowFileName, flowFileText, getSaved, LIBRARY_KEY, listSaved, removeFromLibrary, saveToLibrary } from './library'
import { normalizeFlow } from './ops'
import type { FlowDoc } from './types'

const DEMO: FlowDoc = normalizeFlow(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../backend/app/demos/flows/monthly_sales.json', import.meta.url)), 'utf-8')),
)

/** ブラウザの localStorage の代わり（テスト用） */
function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('ブラウザの中の「保存した作業手順」', () => {
  it('保存すると一覧に出て、中身をそのまま取り出せる', () => {
    const st = memoryStore()
    expect(saveToLibrary(DEMO, st)).toEqual({ ok: true })
    expect(listSaved(st)).toEqual([
      { flow_id: DEMO.flow_id, flow_name: DEMO.flow_name, flow_version: DEMO.flow_version, updated_at: DEMO.updated_at, step_count: DEMO.nodes.length, input_count: 3 },
    ])
    expect(getSaved(DEMO.flow_id, st)).toEqual(DEMO)
  })

  it('同じ作業手順を新しい版で保存すると、置き換わる（2件にならない）', () => {
    const st = memoryStore()
    saveToLibrary(DEMO, st)
    saveToLibrary({ ...DEMO, flow_version: 2, updated_at: '2026-12-01T00:00:00.000Z' }, st)
    expect(listSaved(st)).toHaveLength(1)
    expect(listSaved(st)[0].flow_version).toBe(2)
  })

  it('一覧は更新日時の新しい順。削除できる', () => {
    const st = memoryStore()
    saveToLibrary({ ...DEMO, flow_id: 'a', updated_at: '2026-11-01T00:00:00.000Z' }, st)
    saveToLibrary({ ...DEMO, flow_id: 'b', updated_at: '2026-12-01T00:00:00.000Z' }, st)
    expect(listSaved(st).map((s) => s.flow_id)).toEqual(['b', 'a'])
    removeFromLibrary('b', st)
    expect(listSaved(st).map((s) => s.flow_id)).toEqual(['a'])
  })

  it('保存領域が壊れていても止まらず、空の一覧として扱う', () => {
    expect(listSaved(memoryStore({ [LIBRARY_KEY]: '{壊れた' }))).toEqual([])
    expect(listSaved(memoryStore({ [LIBRARY_KEY]: '{"a":1}' }))).toEqual([])
    expect(listSaved(memoryStore({ [LIBRARY_KEY]: '[1, null, {"x":1}]' }))).toEqual([])
  })

  it('容量不足で書けないときは、例外を出さずに理由を返す', () => {
    const full = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError') } }
    const r = saveToLibrary(DEMO, full)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('いっぱい')
  })

  it('業務データ（ファイルの割当など）は保存しない', () => {
    const st = memoryStore()
    saveToLibrary(DEMO, st)
    expect(st.data[LIBRARY_KEY]).not.toContain('file_id')
  })
})

describe('保存するファイル', () => {
  it('ファイル名は「名前_v版.json」。使えない文字は「_」に置き換える', () => {
    expect(flowFileName({ ...DEMO, flow_name: '月次売上集計', flow_version: 3 })).toBe('月次売上集計_v3.json')
    expect(flowFileName({ ...DEMO, flow_name: '売上/部署別:集計?\n', flow_version: 1 })).toBe('売上_部署別_集計___v1.json')
    expect(flowFileName({ ...DEMO, flow_name: '   ', flow_version: 1 })).toBe('作業手順_v1.json')
  })

  it('ファイルの中身を読み直すと、元の作業手順と同じになる', () => {
    expect(normalizeFlow(JSON.parse(flowFileText(DEMO)))).toEqual(DEMO)
  })
})
