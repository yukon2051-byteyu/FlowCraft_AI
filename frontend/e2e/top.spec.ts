import { expect, test } from '@playwright/test'

/*
 * TOPページ：6つ目の価値（無人定期実行）と「ページの先頭に戻る」ボタン。
 */

test('無人定期実行のカードは「開発中」と、5つの確認を示す', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('article', { name: '決まった日時に無人で実行できる' })
  await expect(card.getByRole('heading', { name: '毎月の作業は、もう開かなくていい。' })).toBeVisible()
  await expect(card.getByText('開発中')).toBeVisible()
  await expect(card.getByRole('listitem')).toHaveText([/設定を保存/, /接続テスト/, /テスト実行/, /品質検証/, /利用者が有効化/])
  await expect(page.getByText('選ばれる6つの理由')).toBeVisible()
})

test('先頭に戻るボタン：先頭では隠れ、スクロールすると右下に出て、押すと滑らかに先頭へ戻る', async ({ page }) => {
  await page.goto('/')
  // 隠れている間は読み上げの対象からも外すため、属性で探す
  const btn = page.locator('button[aria-label="ページの先頭に戻る"]')
  // 先頭にいるときは表示しない（押す意味がないため）
  await expect(btn).toHaveCSS('opacity', '0')
  await expect(btn).toHaveAttribute('tabindex', '-1')

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
  await expect(btn).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: 'ページの先頭に戻る' })).toBeVisible()
  const box = (await btn.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x + box.width).toBeGreaterThan(vp.width - 40) // 右下にある
  expect(box.y + box.height).toBeGreaterThan(vp.height - 40)

  await btn.click()
  // 滑らかなスクロール：押した直後はまだ途中にいて、少し待つと先頭に着く
  const midway = await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))))
  expect(midway).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBe(0)
  await expect(btn).toHaveCSS('opacity', '0')
})
