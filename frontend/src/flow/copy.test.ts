import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { copyFlow } from './copy'
import { normalizeFlow } from './ops'

const RAW = JSON.parse(readFileSync(fileURLToPath(new URL('../../../backend/app/demos/flows/demo_monthly_sales.json', import.meta.url)), 'utf-8'))
const SRC = normalizeFlow(RAW)
const at = new Date('2026-12-01T00:00:00Z')

describe('ひな形・別名で保存（複製）', () => {
  it('新しい手順IDを発行し、版1から始める。名前と目的は利用者が入れたもの', () => {
    const c = copyFlow(RAW, { name: '部署別売上', description: '営業会議で使う' }, at)
    expect(c.flow_id).not.toBe(SRC.flow_id)
    expect(c.flow_id).toMatch(/^[0-9a-f-]{36}$/)
    expect([c.flow_version, c.flow_name, c.description, c.created_at]).toEqual([1, '部署別売上', '営業会議で使う', '2026-12-01T00:00:00.000Z'])
    // 処理の手順と入力の定義はそのまま写す
    expect(c.nodes).toEqual(SRC.nodes)
    expect(c.input_definitions).toEqual(SRC.input_definitions)
  })

  it('品質ルールは写すが、新しい識別を作り、複製元を記録し、確認するまで「未確認」にする', () => {
    const c = copyFlow(RAW, { name: 'x' }, at)
    expect(c.completion_criteria.items).toHaveLength(SRC.completion_criteria.items.length)
    c.completion_criteria.items.forEach((item, i) => {
      const from = SRC.completion_criteria.items[i]
      expect(item.rule_id).not.toBe(from.rule_id)
      expect(item.copied_from).toEqual({ rule_id: from.rule_id, rule_version: from.rule_version })
      expect(item.rule_version).toBe(1)
      expect(item.confirmation_status).toBe('pending')
      expect({ ...item.target, kind: item.kind, params: item.params }).toEqual({ ...from.target, kind: from.kind, params: from.params })
    })
    // 変更の記録は引き継がない
    expect(c.completion_criteria.version).toBe(1)
    expect(c.completion_criteria.changelog).toEqual([])
  })

  it('複製元は変わらない（写しを変えても、もとの手順に影響しない）', () => {
    const before = JSON.stringify(RAW)
    const c = copyFlow(RAW, { name: 'x' }, at)
    c.completion_criteria.items[0].on_fail = 'record'
    c.nodes[0].node_name = '変更'
    expect(JSON.stringify(RAW)).toBe(before)
    // 説明を指定しなければ、もとの説明を残す
    expect(copyFlow(RAW, { name: 'y' }, at).description).toBe(SRC.description)
  })
})
