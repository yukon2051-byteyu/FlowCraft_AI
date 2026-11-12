import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * タスク1-9：ファイル読込とデータプレビューのE2Eテスト。
 * テスト用ファイルはすべて架空データ（e2e/fixtures）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => path.join(here, 'fixtures', name)

test.beforeEach(async ({ page }) => {
  await page.goto('/build')
})

test('Excelを読み込むと、列・型・先頭の行が表示される', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'データを読み込む' })).toBeVisible()
  await page.getByTestId('file-input').first().setInputFiles(fixture('sales_sample.xlsx'))

  const list = page.getByRole('list', { name: '読み込んだファイル' })
  await expect(list.getByText('sales_sample.xlsx')).toBeVisible()
  await expect(list.getByText('3行 × 5列')).toBeVisible()

  const preview = page.getByRole('region', { name: 'sales_sample.xlsx の内容' })
  await expect(preview.getByText('表示：先頭')).toContainText('全 3 行')
  // 商品コード「00123」は数値にならず、そのまま表示される
  await expect(preview.getByRole('cell', { name: '00123' }).first()).toBeVisible()
  await expect(preview.getByRole('cell', { name: '2026/10/01' })).toBeVisible()

  // 列の情報タブ：推定した型と空欄の件数
  await preview.getByRole('tab', { name: /列の情報/ }).click()
  const row = preview.getByRole('row', { name: /備考/ })
  await expect(row).toContainText('文字')
  await expect(row).toContainText('2件')
  await expect(preview.getByRole('row', { name: /売上日/ })).toContainText('日付')

  // 下部のバーに件数と次の操作
  await expect(page.getByText('1ファイル')).toBeVisible()
  await expect(page.locator('p', { hasText: '次の操作：' })).toContainText('列名とデータの形式')
})

test('シートと見出し行を切り替えられる', async ({ page }) => {
  await page.getByTestId('file-input').first().setInputFiles(fixture('sales_sample.xlsx'))
  const preview = page.getByRole('region', { name: 'sales_sample.xlsx の内容' })
  await expect(preview.getByText('表示：先頭')).toBeVisible()

  await preview.getByRole('combobox').selectOption('報告')
  // 「報告」シートは3行目が見出し
  await preview.getByRole('button', { name: '見出し行を下へ' }).click()
  await preview.getByRole('button', { name: '見出し行を下へ' }).click()
  await expect(preview.getByText('3行目')).toBeVisible()
  await expect(preview.getByRole('columnheader', { name: /部署/ })).toBeVisible()
  await expect(preview.getByText('表示：先頭')).toContainText('全 2 行')
  // 一覧の件数表示も切り替わる
  await expect(page.getByRole('list', { name: '読み込んだファイル' }).getByText('2行 × 2列')).toBeVisible()
})

test('Shift_JISのCSVを文字化けせずに読み込める', async ({ page }) => {
  await page.getByTestId('file-input').first().setInputFiles(fixture('dept_sjis.csv'))
  const list = page.getByRole('list', { name: '読み込んだファイル' })
  await expect(list.getByText('CSV・Shift_JIS（CP932）')).toBeVisible()
  const preview = page.getByRole('region', { name: 'dept_sjis.csv の内容' })
  await expect(preview.getByRole('columnheader', { name: /部署名/ })).toBeVisible()
  await expect(preview.getByRole('cell', { name: '営業1部' })).toBeVisible()
  await expect(preview.getByRole('cell', { name: '001' })).toBeVisible()
})

test('拡張子を偽装したファイルは、理由と直し方を表示して拒否する', async ({ page }) => {
  await page.getByTestId('file-input').first().setInputFiles(fixture('fake.xlsx'))
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('拡張子')
  await expect(alert).toContainText('対処方法')
  await expect(page.getByRole('list', { name: '読み込んだファイル' })).toHaveCount(0)
  await alert.getByRole('button', { name: '閉じる' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('再読み込みしても、読み込んだファイルが表示し直される', async ({ page }) => {
  await page.getByTestId('file-input').first().setInputFiles([fixture('sales_sample.xlsx'), fixture('dept_sjis.csv')])
  const list = page.getByRole('list', { name: '読み込んだファイル' })
  await expect(list.getByText('dept_sjis.csv')).toBeVisible()
  await page.reload()
  await expect(list.getByText('sales_sample.xlsx')).toBeVisible()
  await expect(list.getByText('dept_sjis.csv')).toBeVisible()
  await expect(page.getByText('2ファイル')).toBeVisible()
})

test('ファイルは確認してから削除される', async ({ page }) => {
  await page.getByTestId('file-input').first().setInputFiles(fixture('dept_sjis.csv'))
  const list = page.getByRole('list', { name: '読み込んだファイル' })
  await list.getByRole('button', { name: 'dept_sjis.csv を削除' }).click()
  await expect(list.getByText('このファイルを削除しますか？')).toBeVisible()
  await list.getByRole('button', { name: 'キャンセル' }).click()
  await expect(list.getByText('dept_sjis.csv')).toBeVisible()

  await list.getByRole('button', { name: 'dept_sjis.csv を削除' }).click()
  await list.getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('heading', { name: 'データを読み込む' })).toBeVisible()
})

test('旧URL /workspace を開くと、作る画面 /build へ転送される（指定も引き継ぐ）', async ({ page }) => {
  await page.goto('/workspace?view=sample')
  await expect(page).toHaveURL(/\/build\?view=sample$/)
  await expect(page.getByText('サンプル表示中')).toBeVisible()
})

test('始め方は2つ。見直し（カイゼン診断）は任意で、開発中のあいだは選べない', async ({ page }) => {
  const routes = page.getByRole('radiogroup', { name: '始め方' })
  await expect(routes.getByRole('radio', { name: /すぐにExcel作業を自動化する/ })).toHaveAttribute('aria-checked', 'true')
  const review = routes.getByRole('radio', { name: /作業の見直しから始める/ })
  await expect(review).toHaveAttribute('aria-disabled', 'true')
  await expect(review).toContainText('開発中')
  // 見直しを選ばなくても、そのままファイルを読み込める
  await page.getByTestId('file-input').first().setInputFiles(fixture('sales_sample.xlsx'))
  await expect(page.getByText('1ファイル')).toBeVisible()
})
