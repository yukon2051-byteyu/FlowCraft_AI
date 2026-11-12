import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * タスク1-2「新しく作る」のE2Eテスト。
 * デモ用の架空データ（backend/app/demos/data）を使う。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = (name: string) => path.join(here, '..', '..', 'backend', 'app', 'demos', 'data', name)

const BANNED = /ノード|フロー|Phase|確定|真偽値|プレビュー|JSON|マッピング|スキーマ|結合キー|未照合|(?<![定0-9０-９])型(?!番)/

test('読み込んだファイルから、使う列と形式を決めて作業手順を作り始める', async ({ page }) => {
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(page.getByText('3ファイル')).toBeVisible({ timeout: 20_000 }) // 複数ファイルの解析は、並行実行中だと時間がかかる

  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await expect(page.getByRole('heading', { name: '使う列と、データの形式を決める' })).toBeVisible()
  // AIの段階は省略されていることが分かる
  await expect(page.getByRole('list', { name: '作業の段階' })).toContainText('省略')

  const sales = page.getByRole('region', { name: '売上実績_2026-10.xlsx の設定' })
  // 入力の名前は、ファイル名から年月を除いた名前が候補になる
  await expect(sales.getByRole('textbox')).toHaveValue('売上実績')

  // 商品コード（P-1001 など）は文字と推定され、全件を変換できる
  const code = sales.getByRole('row', { name: /商品コード/ })
  await expect(code.getByRole('combobox')).toHaveValue('string')
  await expect(code).toContainText('全240件OK')

  // 形式を整数に変えると、変換できない値が行番号つきで表示され、先へ進めない
  await code.getByRole('combobox').selectOption('integer')
  await expect(code).toContainText('この形式にできない値が240件')
  await expect(code).toContainText('2行目')
  const startButton = page.getByRole('button', { name: 'この内容で作業手順を作り始める' })
  await expect(startButton).toBeDisabled()
  await expect(page.getByRole('list', { name: 'まだ進めない理由' })).toContainText('「商品コード」に、選んだ形式にできない値があります')

  // 文字に戻せば進める。備考は使わない列にする
  await code.getByRole('combobox').selectOption('string')
  await sales.getByRole('checkbox', { name: '「備考」を使う' }).uncheck()
  await expect(code).toContainText('全240件OK')

  // 画面に専門用語が出ていない
  const texts = (await page.locator('body').innerText()).split('\n')
  expect(texts.filter((t) => BANNED.test(t))).toEqual([])

  await expect(startButton).toBeEnabled()
  await startButton.click()

  // 読み込みのステップが3つ、確認済みで並ぶ
  const steps = page.getByRole('list', { name: '処理ステップ' }).getByRole('listitem')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toContainText('売上実績を読み込む')
  await expect(steps.nth(0)).toContainText('確認済み')
  await expect(steps.nth(0)).not.toContainText('備考')
  await expect(steps.nth(2)).toContainText('読み込むファイル：部署マスタ')

  // 戻っても、決めた内容は残っている
  await page.getByRole('button', { name: '使う列と形式の設定に戻る' }).click()
  await expect(sales.getByRole('checkbox', { name: '「備考」を使う' })).not.toBeChecked()
})

test('入力の名前が重なると、理由を示して進めない', async ({ page }) => {
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo('売上実績_2026-11.xlsx')])
  await expect(page.getByText('2ファイル')).toBeVisible({ timeout: 20_000 }) // 複数ファイルの解析は、並行実行中だと時間がかかる
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()

  await expect(page.getByRole('list', { name: 'まだ進めない理由' })).toContainText('入力の名前「売上実績」が重なっています')
  await page.getByRole('region', { name: '売上実績_2026-11.xlsx の設定' }).getByRole('textbox').fill('売上実績（今月）')
  await expect(page.getByRole('button', { name: 'この内容で作業手順を作り始める' })).toBeEnabled()
})

test('形式の確認ができなかったときは、確かめていない内容で進めない', async ({ page }) => {
  await page.route('**/type-check', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL', message: '処理中にエラーが発生しました。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }),
    }),
  )
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles(demo('部署マスタ.csv'))
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()

  await expect(page.getByText('データの形式を確認できませんでした')).toBeVisible()
  await expect(page.getByRole('list', { name: 'まだ進めない理由' })).toContainText('確認できなかったファイルがあります')
  await expect(page.getByRole('button', { name: 'この内容で作業手順を作り始める' })).toBeDisabled()
})
