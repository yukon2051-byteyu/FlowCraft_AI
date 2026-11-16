import { describe, expect, it } from 'vitest'
import { countStatus, deriveStatus, nextToFix, sectionState } from './stepStatus'

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

describe('切り替えカードの設定の状態', () => {
  it('いちばん重い状態を件数つきで示し、不完全なら「設定済み」と出さない', () => {
    expect(sectionState('steps', ['ready', 'ready'])).toEqual({ tone: 'ok', label: '設定済み', detail: null })
    expect(sectionState('steps', ['ready', 'needs_review', 'needs_setting', 'error'])).toEqual({ tone: 'error', label: '設定エラー 1件', detail: '設定済み 1／4件' })
    expect(sectionState('steps', ['ready', 'needs_setting', 'needs_setting'])).toMatchObject({ tone: 'warn', label: '設定が必要 2件' })
    expect(sectionState('criteria', ['ready', 'needs_setting'])).toMatchObject({ tone: 'warn', label: '未設定 1件' })
    expect(sectionState('criteria', ['ready', 'needs_review', 'needs_review', 'ready'])).toEqual({ tone: 'warn', label: '確認が必要 2件', detail: '設定済み 2／4件' })
  })

  it('0件：処理ステップは設定が必要、完了基準は任意（中立）', () => {
    expect(sectionState('steps', [])).toMatchObject({ tone: 'warn', label: '設定が必要' })
    expect(sectionState('criteria', [])).toMatchObject({ tone: 'neutral', label: '未設定（任意）' })
  })
})
