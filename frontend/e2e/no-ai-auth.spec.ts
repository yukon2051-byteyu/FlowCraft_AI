import { expect, test } from '@playwright/test'
import { demo } from './helpers'

/*
 * AI を使わない操作では、AI 利用パスワードを求めない（docs/ai-auth-design.md）。
 * 「自分のExcelで試す」→ 読み込み → プレビュー → 実行 → Excel 出力、とデモの開始・実行で、
 * パスワードの入力欄・認証のダイアログが一度も出ないことを確かめる。
 */

const noAuthPrompt = async (page: import('@playwright/test').Page) => {
  await expect(page.getByRole('dialog', { name: /AI機能を利用する/ })).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
}

test('自分のExcelで試す → 読み込み → プレビュー → 作業手順へ、まで AI のパスワードを求めない', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('main').getByRole('link', { name: '自分のExcelで試す' }).first().click()
  await expect(page).toHaveURL(/\/build$/)
  await noAuthPrompt(page)
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx')])
  await expect(page.getByText('1ファイル')).toBeVisible({ timeout: 20_000 })
  await noAuthPrompt(page)
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()
  await expect(page.getByRole('article', { name: /^ステップ1：/ })).toBeVisible()
  await noAuthPrompt(page)
})

test('デモの開始・実行・Excel 出力まで AI のパスワードを求めない', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/build?demo=monthly_sales&pattern=ok')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(page.getByRole('status', { name: '総合判定' })).toBeVisible({ timeout: 30_000 })
  await Promise.all([page.waitForEvent('download'), page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  await noAuthPrompt(page)
})
