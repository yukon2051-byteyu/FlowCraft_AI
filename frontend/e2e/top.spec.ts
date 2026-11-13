import { expect, test } from '@playwright/test'

/*
 * TOPページ：6つ目の価値（無人定期実行）と「ページの先頭に戻る」ボタン。
 */

test('無人定期実行のカードは「開発中」と、5つの確認を示す', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('article', { name: '決まった日時に無人で実行できる' })
  await expect(card.getByRole('heading', { name: '毎月の作業は、もう開かなくていい。' })).toBeVisible()
  await expect(card.getByText('開発中', { exact: true })).toHaveCount(3) // 無人定期実行・クラウドで試す・Windows Worker
  // 3分後の自動実行デモは、完成するまで押せない
  await expect(card.getByRole('button', { name: '3分後に自動実行を試す' })).toBeDisabled()
  await expect(card.getByRole('list', { name: '無人で実行する前の5つの確認' }).getByRole('listitem')).toHaveText([/設定を保存/, /接続テスト/, /テスト実行/, /品質検証/, /利用者が有効化/])
  await expect(page.getByText('選ばれる6つの理由')).toBeVisible()
  // 試し方の3つの区分：未実装のものは「開発中」、製品版の機能は「対応予定」と分けて示す
  const ways = card.getByRole('list', { name: '無人実行の試し方' }).getByRole('listitem')
  await expect(ways).toHaveCount(3)
  await expect(ways.nth(0)).toContainText('クラウドで試す')
  await expect(ways.nth(0)).toContainText('開発中')
  await expect(ways.nth(1)).toContainText('Windows Workerで試せる')
  await expect(ways.nth(1)).toContainText('開発中')
  await expect(ways.nth(2)).toContainText('製品版で対応予定')
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
