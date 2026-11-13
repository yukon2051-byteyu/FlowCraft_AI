import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BANNED, demo } from './helpers'

/*
 * 新しいワークフロー Phase 1：開始画面（3つの開始方法）と、開始方法ごとの段階の表示。
 * 段階のIDは共通で、表示の順番だけが変わる。未完了の段階を完了として表示しない。
 */

const stepper = (page: Page) => page.getByRole('list', { name: '作業の段階' })
const stepTexts = async (page: Page) => (await stepper(page).locator(':scope > li').allInnerTexts()).map((t) => t.replace(/\s+/g, ''))

test('開始画面：3つの開始方法を同じ大きさのカードで示し、作業起点をおすすめにする', async ({ page }) => {
  await page.goto('/build')
  const ways = page.getByRole('list', { name: '開始方法' })
  await expect(ways.locator(':scope > li')).toHaveCount(3)
  const work = ways.getByRole('region', { name: 'やりたい作業から始める' })
  await expect(work).toContainText('おすすめ')
  // 開発中の機能を、使えるように見せない
  await expect(work).toContainText('AIによる手順の作成・改善診断は開発中です')
  await expect(ways.getByRole('region', { name: 'Excelを読み込んで始める' })).toBeVisible()
  await expect(ways.getByRole('region', { name: '保存した手順を使う' })).toBeVisible()
  // 開始方法を選ぶまで、段階は出さない
  await expect(stepper(page).locator(':scope > li')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(BANNED)
})

test('作業起点：案件名と作業を入れると、作業手順の名前・目的として引き継ぎ、データの読み込みへ進む', async ({ page }) => {
  await page.goto('/build')
  await page.getByRole('button', { name: '作業の説明から始める' }).click()
  await expect(page).toHaveURL(/start=work/)
  expect(await stepTexts(page)).toEqual(['1作業を伝える', '2手順を確認する', '3データを読み込む', '4実行・品質確認', '5出力・保存'])

  // 改善診断：AI改善診断と簡易チェックは別の機能で、どちらも開発中（選べない）。診断せずに進む
  const diagnosis = page.getByRole('radiogroup', { name: '改善診断' })
  await expect(diagnosis.getByRole('radio', { name: 'AI改善診断を受ける' })).toHaveAttribute('aria-disabled', 'true')
  await expect(diagnosis.getByRole('radio', { name: '簡易チェックで見直す' })).toHaveAttribute('aria-disabled', 'true')
  await expect(diagnosis.getByRole('radio', { name: '診断せずに進む' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radiogroup', { name: '手順の作り方' }).getByRole('radio', { name: 'AIで手順を作る' })).toHaveAttribute('aria-disabled', 'true')

  // 処理部品を組み合わせて作る（Excelを読み込んで列を確かめながら）を選ぶ
  await page.getByRole('radiogroup', { name: '手順の作り方' }).getByRole('radio', { name: '処理部品を組み合わせて作る' }).click()
  // 案件名がないと進めない
  const next = page.getByRole('button', { name: '次へ：データを読み込む' })
  await expect(next).toBeDisabled()
  await page.getByRole('textbox', { name: '案件名' }).fill('月次売上集計')
  await page.getByRole('textbox', { name: 'やりたい作業・目的' }).fill('部署別の売上を集計し、営業会議で使う')
  await next.click()

  // 作業の名前がヘッダーに出る。部品で組み立てるので、データ → 手順の順になる
  await expect(page.getByRole('banner')).toContainText('月次売上集計')
  expect(await stepTexts(page)).toEqual(['作業を伝える', '2データを読み込む', '3手順を確認する', '4実行・品質確認', '5出力・保存'])
  await expect(stepper(page).locator(':scope > li').first().getByLabel('完了')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Excel・CSVを読み込む' })).toBeVisible()
  await page.getByTestId('file-input').first().setInputFiles(demo('売上実績_2026-10.xlsx'))
  await expect(page.getByText('1ファイル')).toBeVisible()
})

test('作業起点で開始方法を選び直すと、開始画面に戻る（入力した案件名は残る）', async ({ page }) => {
  await page.goto('/build?start=work')
  await page.getByRole('textbox', { name: '案件名' }).fill('在庫の確認')
  await page.getByRole('radiogroup', { name: '手順の作り方' }).getByRole('radio', { name: '処理部品を組み合わせて作る' }).click()
  await page.getByRole('button', { name: '次へ：データを読み込む' }).click()
  await page.goto('/build?start=work')
  await page.getByRole('button', { name: '開始方法を選び直す' }).click()
  await expect(page.getByRole('list', { name: '開始方法' })).toBeVisible()
})

test('Excel起点：読み込み画面から始め、作業の説明は（AIが開発中のため）省略と示す', async ({ page }) => {
  await page.goto('/build')
  await page.getByRole('button', { name: 'Excel・CSVを読み込む' }).click()
  await expect(page).toHaveURL(/start=file/)
  await expect(page.getByRole('heading', { name: 'Excel・CSVを読み込む' })).toBeVisible()
  const items = await stepTexts(page)
  expect(items[0]).toContain('データを読み込む')
  expect(items[1]).toContain('作業を伝える')
  expect(items[1]).toContain('省略')
})

test('保存した手順を使う：作業手順を開く画面が出る。作業の説明は「不要」', async ({ page }) => {
  await page.goto('/build')
  await page.getByRole('button', { name: '保存した手順を開く' }).click()
  await expect(page.getByRole('dialog', { name: '作業手順を開く' })).toBeVisible()
  // ?start=saved で直接開いても同じ
  await page.goto('/build?start=saved')
  const dialog = page.getByRole('dialog', { name: '作業手順を開く' })
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('flow-file-input').setInputFiles(demo('../flows/monthly_sales.json'))
  await expect(page.getByRole('heading', { name: /に、今回のファイルを割り当てる/ })).toBeVisible()
  const items = await stepTexts(page)
  expect(items[0]).toContain('不要')
  expect(items.find((t) => t.includes('データを読み込む'))).toBeTruthy()
})
