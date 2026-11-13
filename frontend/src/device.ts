/*
 * 利用する端末の判定（PC専用化。docs/pc-only.md）。
 * FlowCraft AI は Windows PC の Chrome・Edge 向け。スマートフォンには、アプリ本体の代わりに PC専用の案内だけを出す。
 * 判定はブラウザの識別文字列（User-Agent）だけで行う（画面幅では判定しない：PCの狭いウィンドウを誤って止めないため）。
 * タブレットは対象外だが、案内も出さない（指示書 §5 はスマートフォンのみ）。
 */

const SMARTPHONE = /iPhone|iPod|Android.+Mobile|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile|Mobile.+Firefox/i

export function isSmartphone(userAgent: string): boolean {
  return SMARTPHONE.test(userAgent)
}
