/*
 * 画面に出す数値の3桁区切り（表示だけ。値そのもの・Excelに出力する値は変えない）。
 * 数として計算し直すと小数の誤差が出るため、文字のまま整数部分だけを区切る。数でない文字はそのまま返す。
 */
const NUMBER = /^(-?)(\d+)(\.\d+)?$/

export function groupDigits(v: string): string {
  const m = NUMBER.exec(v.trim())
  if (!m) return v
  const [, sign, int, frac = ''] = m
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`
}

/** 金額らしい列か（デモの表で、単位「円」を見出しに添えるために使う。数値の列で、名前に金額・売上・単価・合計を含む） */
export function isAmountColumn(name: string, type: string): boolean {
  return (type === 'integer' || type === 'decimal') && /金額|売上|単価|合計/.test(name)
}
