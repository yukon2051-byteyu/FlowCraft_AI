import { describe, expect, it } from 'vitest'
import { fieldOf, stepIndexOf } from './flows'

describe('形の誤りの場所', () => {
  it('サーバーが返す形（nodes[1].…）からステップの番号を取り出す', () => {
    expect(stepIndexOf('nodes[1].parameters.conditions')).toBe(1)
    expect(stepIndexOf('nodes[12]')).toBe(12)
    expect(stepIndexOf('nodes.3.parameters.keys')).toBe(3) // 古い形
    expect(stepIndexOf('flow_name')).toBeNull()
    expect(stepIndexOf('(全体)')).toBeNull()
  })

  it('ステップの中の項目の部分だけを取り出す', () => {
    expect(fieldOf('nodes[1].parameters.conditions')).toBe('parameters.conditions')
    expect(fieldOf('nodes[2]')).toBe('')
  })
})
