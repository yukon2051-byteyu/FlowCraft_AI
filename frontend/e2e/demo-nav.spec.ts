import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/*
 * すべてのデモの全段階から「デモ選択へ戻る」（TOPのデモ欄）へ戻れる。失われる変更があるときだけ確認する。
 * 戻り先はすべて同じ（/#demo）。「自分のExcelで試す」の画面には出さない。デモ用の架空データを使う。
 */

const back = (page: Page) => page.getByRole('button', { name: 'デモ選択へ戻る' })
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'デモ選択へ戻りますか？' })

async function expectDemoList(page: Page) {
  await expect(page).toHaveURL(/\/#demo$/)
  await expect(page.locator('#demo')).toBeInViewport()
}

test('作業手順のデモ：5つの段階すべてから戻れ、戻った後に別のデモを始められる', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/build?demo=monthly_sales&pattern=ok')
  // STEP 1〜3（デモ専用の段階）
  await expect(page.getByRole('button', { name: '次へ：作業手順と改善案を見る' })).toBeVisible({ timeout: 20_000 })
  await expect(back(page)).toBeVisible()
  await page.getByRole('button', { name: '次へ：作業手順と改善案を見る' }).click()
  await expect(back(page)).toBeVisible()
  await expect(page.getByRole('button', { name: '前へ：作業を知る' })).toBeVisible() // 同じデモの前の段階へ戻る操作は別にある
  await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
  await expect(back(page)).toBeVisible()
  await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
  // STEP 4（実行・品質確認）
  await expect(page.getByRole('button', { name: '作業手順全体を実行する' })).toBeVisible()
  await expect(back(page)).toBeVisible()
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  // STEP 5（結果を確認）：別のデモを試す（戻り先は同じ）
  const end = page.getByRole('navigation', { name: 'デモの終了' })
  await expect(end.getByRole('button', { name: '別のデモを試す' })).toBeVisible({ timeout: 30_000 })
  // 変更していないので、確認せずに戻る
  await end.getByRole('button', { name: '別のデモを試す' }).click()
  await expect(confirmDialog(page)).toHaveCount(0)
  await expectDemoList(page)
  // 別のデモを正しく始められる
  await page.locator('#demo').getByRole('article', { name: '商品マスタ照合デモ' }).getByRole('link', { name: '商品マスタ照合デモ：正常デモを実行' }).click()
  await expect(page.getByRole('heading', { name: '売上データの商品マスタ照合' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'このデモで体験できること' })).toContainText('照合できない商品コードが0件であることを確かめます')
})

test('作業手順のデモ：作業手順を変えた後は確認し、「このまま続ける」で留まれる', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/build?demo=monthly_sales&pattern=ok')
  await page.getByRole('button', { name: '次へ：作業手順と改善案を見る' }).click({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
  await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
  // ステップの名前を変える（保存していない変更）
  const card = page.getByRole('article', { name: /^ステップ2：/ })
  await card.getByRole('heading').click()
  await page.getByRole('region', { name: 'ステップ2の設定' }).getByRole('textbox', { name: 'ステップの名前' }).fill('使う列だけにする（変更）')
  await back(page).click()
  const dialog = confirmDialog(page)
  await expect(dialog).toContainText('このデモで保存していない変更内容は失われます。')
  await expect(dialog.getByRole('button', { name: 'このまま続ける' })).toBeFocused() // 誤って戻らないように
  await dialog.getByRole('button', { name: 'このまま続ける' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('article', { name: /^ステップ2：使う列だけにする（変更）/ })).toBeVisible()
  await back(page).click()
  await confirmDialog(page).getByRole('button', { name: 'デモ選択へ戻る' }).click()
  await expectDemoList(page)
})

test('業務改善デモ：判断を入れる前は確認せずに戻り、判断を入れた後は確認する。完了画面からも戻れる', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/kaizen-demo')
  await expect(page.getByRole('button', { name: 'この作業を改善診断する' })).toBeEnabled({ timeout: 20_000 })
  await back(page).click()
  await expect(confirmDialog(page)).toHaveCount(0)
  await expectDemoList(page)

  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await page.getByRole('radiogroup', { name: '候補Dの判断' }).getByText('採用する').click()
  await back(page).click()
  await expect(confirmDialog(page)).toBeVisible()
  await confirmDialog(page).getByRole('button', { name: 'このまま続ける' }).click()
  await expect(page.getByRole('radiogroup', { name: '候補Dの判断' }).getByRole('radio', { name: /採用する/ })).toBeChecked()
  await back(page).click()
  await confirmDialog(page).getByRole('button', { name: 'デモ選択へ戻る' }).click()
  await expectDemoList(page)
})

test('「自分のExcelで試す」の画面には、デモ選択へ戻るを出さない', async ({ page }) => {
  await page.goto('/build?start=work')
  await expect(page.getByRole('heading', { name: 'やりたい作業を伝える' })).toBeVisible()
  await expect(back(page)).toHaveCount(0)
  await page.goto('/build?start=file')
  await expect(page.getByRole('heading', { name: 'Excel・CSVを読み込む' })).toBeVisible()
  await expect(back(page)).toHaveCount(0)
})
