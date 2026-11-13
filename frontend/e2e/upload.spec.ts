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
  await page.goto('/build?start=file')
})

test('Excelを読み込むと、列・型・先頭の行が表示される', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Excel・CSVを読み込む' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Excel・CSVを読み込む' })).toBeVisible()
})

test('旧URL /workspace を開くと、作る画面 /build へ転送される（指定も引き継ぐ）', async ({ page }) => {
  await page.goto('/workspace?view=sample')
  await expect(page).toHaveURL(/\/build\?view=sample$/)
  await expect(page.getByText('サンプル表示中')).toBeVisible()
})

test('最初の画面：読み込む前に始め方を選ばせず、すぐにファイルを選べる。ほかの始め方は右側にまとめる', async ({ page }) => {
  // 開始方法を選ぶ大きなカード（すぐに自動化する／作業の見直し）は出さない
  await expect(page.getByRole('radiogroup', { name: '始め方' })).toHaveCount(0)
  const main = page.getByRole('region', { name: 'Excel・CSVを読み込む' })
  await expect(main.getByRole('button', { name: 'ファイルを選択' })).toBeVisible()
  await expect(main.getByRole('list', { name: '対応形式と上限' })).toContainText('1ファイル10MB・合計10万行')
  await expect(main.getByLabel('読み込み後の流れ')).toContainText('③ 実行・品質確認')
  await expect(page.getByRole('list', { name: '作業の段階' })).toContainText('実行・品質確認')

  const side = page.getByRole('complementary', { name: 'ほかの始め方' })
  // 開発中の機能は押せる形にしない
  const derive = side.locator('[aria-disabled="true"]', { hasText: '手順を複製してカスタマイズ' })
  await expect(derive).toContainText('開発中')
  await expect(derive.getByRole('button')).toHaveCount(0)
  // AI利用・データの取扱い：詳細は開いたときだけ表示する
  const ai = side.getByRole('region', { name: 'AI利用・データの取扱い' })
  await expect(ai.getByText('現在はAIに何も送信していません', { exact: false })).toBeHidden()
  await ai.getByText('詳細を確認する').click()
  await expect(ai.getByText('現在はAIに何も送信していません', { exact: false })).toBeVisible()

  // そのままファイルを読み込める
  await page.getByTestId('file-input').first().setInputFiles(fixture('sales_sample.xlsx'))
  await expect(page.getByText('1ファイル')).toBeVisible()
})
