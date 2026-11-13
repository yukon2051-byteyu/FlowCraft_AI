import { expect, test } from '@playwright/test'

/*
 * PC専用化（docs/pc-only.md）。
 * - 主要な確認解像度（1920×1080・1366×768）で、主な画面に不要な横スクロールが出ない
 * - スマートフォンから開くと、アプリ本体の代わりに PC専用の案内だけを出す
 */

const PAGES: [string, string][] = [
  ['/', 'TOP'],
  ['/build', '開始画面'],
  ['/build?start=file', 'ファイルから始める'],
  ['/build?demo=monthly_sales&pattern=ok', 'デモ（作業手順）'],
  ['/kaizen-demo', '業務改善デモ'],
]

for (const [w, h] of [
  [1920, 1080],
  [1366, 768],
]) {
  test(`${w}×${h}：主な画面に横スクロールが出ない`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: w, height: h })
    for (const [url, name] of PAGES) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over, `${name}（${url}）`).toBeLessThanOrEqual(0)
    }
  })
}

test.describe('スマートフォン', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  })

  test('どのURLを開いても、PC専用の案内だけを出す', async ({ page }) => {
    for (const url of ['/', '/build?start=file', '/kaizen-demo']) {
      await page.goto(url)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('FlowCraft AIはPC専用です')
      await expect(page.getByText('Windows PCのChromeまたはEdgeからアクセスしてください。')).toBeVisible()
      await expect(page.getByRole('button')).toHaveCount(0)
      await expect(page.getByRole('link')).toHaveCount(0)
    }
  })
})
