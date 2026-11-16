import { describe, expect, it } from 'vitest'
import { countStatus, deriveStatus, nextToFix } from './stepStatus'

describe('処理ステップ・完了基準の状態（設定と検証の結果から決める）', () => {
  it('確認済みでも、設定が足りなければ「要設定」（矛盾を出さない）', () => {
    expect(deriveStatus(['列を選んでください'], [], true)).toBe('needs_setting')
  })
  it('設定がそろっていても、作業手順の検証で問題があれば「エラー」', () => {
    expect(deriveStatus([], ['参照先がありません'], true)).toBe('error')
  })
  it('問題がなく、確認がまだなら「要確認」。すべてそろえば「設定完了」', () => {
    expect(deriveStatus([], [], false)).toBe('needs_review')
    expect(deriveStatus([], [], true)).toBe('ready')
  })
  it('件数のまとめと、次に直す項目（後ろから探し、なければ先頭から）', () => {
    const list = ['ready', 'needs_setting', 'ready', 'error'] as const
    expect(countStatus([...list])).toEqual({ needs_setting: 1, error: 1, needs_review: 0, ready: 2 })
    expect(nextToFix([...list])).toBe(1)
    expect(nextToFix([...list], 1)).toBe(3)
    expect(nextToFix([...list], 3)).toBe(1)
    expect(nextToFix(['ready', 'ready'])).toBe(-1)
  })
})
