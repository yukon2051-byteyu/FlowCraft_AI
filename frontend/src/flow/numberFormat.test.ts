import { describe, expect, it } from 'vitest'
import { groupDigits, isAmountColumn } from './numberFormat'

describe('数値の3桁区切り（表示だけ）', () => {
  it('整数・負の数・小数（小数部分は区切らず、桁も変えない）', () => {
    expect(groupDigits('12228000')).toBe('12,228,000')
    expect(groupDigits('-1234')).toBe('-1,234')
    expect(groupDigits('1234567.125')).toBe('1,234,567.125')
    expect(groupDigits('999')).toBe('999')
    expect(groupDigits('0.000123')).toBe('0.000123')
  })
  it('数でない文字は、そのまま', () => {
    expect(groupDigits('P-1001')).toBe('P-1001')
    expect(groupDigits('1,234')).toBe('1,234')
    expect(groupDigits('')).toBe('')
  })
  it('金額らしい列（数値の列だけ）', () => {
    expect(isAmountColumn('売上合計', 'integer')).toBe(true)
    expect(isAmountColumn('件数', 'integer')).toBe(false)
    expect(isAmountColumn('売上日', 'date')).toBe(false)
  })
})
