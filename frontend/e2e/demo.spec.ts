import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/*
 * M1-1：デモ（正常終了／品質異常）を TOP から始めて、実際の処理と判定を確かめる。
 * 判定はサーバーの実際の評価から出る（デモのための作り込みはしない）。デモ用の架空データ。
 */

const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })
const verdictBox = (page: Page) => conclusion(page).getByRole('status', { name: '総合判定' })
const banner = (page: Page) => page.getByRole('note', { name: 'デモの案内' })

async function run(page: Page) {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toBeVisible({ timeout: 30_000 })
}

test('TOP から品質異常のデモを始めると、期間外の伝票を見つけて正式な出力を止める', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  const card = page.getByRole('article', { name: '月次売上集計デモ' })
  await card.getByRole('link', { name: /品質異常/ }).click()
  await expect(page).toHaveURL(/\/build\?demo=monthly_sales&pattern=ng/)

  // デモの案内と、読み込まれた作業手順（完了基準つき）・実行時に指定する値
  await expect(banner(page)).toContainText('デモ：月次売上集計デモ（品質異常）')
  await expect(banner(page)).toContainText('10月分のファイルに、11月の伝票が混ざっています。')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('tab', { name: /完了基準 4/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '実行時に指定する値：対象月' })).toHaveValue('2026-10')

  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：重大')
  await expect(conclusion(page)).toContainText('処理・検証：完了')
  await expect(conclusion(page).getByLabel('正式な出力')).toContainText('停止')
  const first = page.getByRole('region', { name: '完了基準の判定' }).getByRole('listitem').first()
  await expect(first).toHaveAttribute('aria-label', '完了基準：対象月の伝票だけ')
  await expect(first).toContainText('満たしていない（重大）')
  await expect(first).toContainText('期間外の件数3')
  // デモの作業手順は、利用者が保存したものではない（「保存済み」と表示しない）
  await expect(conclusion(page)).not.toContainText('この作業手順は保存済みです')
  await expect(conclusion(page).getByRole('button', { name: 'この作業手順を保存する' })).toBeVisible()
  // 調査用の確認結果は出力できる
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: '確認結果をExcelに出力する（調査用）' }).click()])
  expect(download.suggestedFilename()).toContain('確認結果（調査用）')
})

test('案内の帯から正常終了のデモに切り替えると、正常と判定され、結果を出力できる', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/build?demo=monthly_sales&pattern=ng')
  await expect(banner(page)).toContainText('品質異常')
  await banner(page).getByRole('link', { name: '正常終了のデモに切り替える' }).click()
  await expect(banner(page)).toContainText('デモ：月次売上集計デモ（正常終了）', { timeout: 20_000 })
  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  await expect(verdictBox(page)).toContainText('完了基準（4件）をすべて満たしています。')
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
  // デモのファイルは入れ替わり、増え続けない
  const sessionId = await page.evaluate(() => sessionStorage.getItem('flowcraft.session'))
  expect(sessionId).toBeTruthy()
  const files = await page.request.get('/api/files', { headers: { 'X-Session-Id': sessionId! } })
  expect(files.ok()).toBe(true)
  expect((await files.json()).length).toBe(3)
})

test('まだ使えないデモは、開発中と表示して押せない', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('article', { name: '在庫差異検出デモ' })
  await expect(card).toContainText('開発中')
  await expect(card.getByRole('link')).toHaveCount(0)
})
