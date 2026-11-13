import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { demo } from './helpers'

/*
 * タスク2-3：総合判定（正常／注意／重大／未検証）と出力の制御を、画面から確かめる。
 * 完了基準の設定画面（2-4）はまだないため、完了基準を書いた作業手順ファイルを開いて使う。デモ用の架空データ。
 */

const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })
const verdictBox = (page: Page) => conclusion(page).getByRole('status', { name: '総合判定' })

/** デモの作業手順（1.0）に完了基準を足した 1.1 のファイルを作る */
async function flowFile(criteria: unknown[]): Promise<string> {
  const flow = JSON.parse(await readFile(demo('../flows/monthly_sales.json'), 'utf-8'))
  flow.schema_version = '1.1'
  flow.run_parameters = []
  flow.completion_criteria = { version: 1, items: criteria, changelog: [] }
  const file = path.join(os.tmpdir(), `flowcraft-verdict-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  await writeFile(file, JSON.stringify(flow), 'utf-8')
  return file
}

async function openAndRun(page: Page, criteria: unknown[]) {
  await page.goto('/build')
  await page.getByRole('banner').getByRole('button', { name: '作業手順を開く' }).click()
  await page.getByTestId('flow-file-input').setInputFiles(await flowFile(criteria))
  await page.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(page.getByRole('button', { name: 'この割当で作業手順へ進む' })).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'この割当で作業手順へ進む' }).click()
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(conclusion(page)).toContainText('最後まで実行しました', { timeout: 30_000 })
}

const rows = (min: number, onFail: string) => ({
  criterion_id: 'c_rows',
  name: '部署は4つ',
  kind: 'row_count',
  target: { ref: 'by_dept' },
  params: { min, max: min },
  on_fail: onFail,
})

test('完了基準をすべて満たすと「正常」。確認なしで出力できる', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(4, 'critical')])
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  await expect(verdictBox(page)).toContainText('（完了基準と標準の確認）')
  await expect(verdictBox(page)).toContainText('完了基準（1件）をすべて満たしています。')
  await expect(conclusion(page).getByRole('checkbox', { name: /確認したうえで出力する/ })).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
})

test('「注意」の結果は、確認のチェックを入れるまで出力できない（上部のボタンも同じ）', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(5, 'caution')])
  await expect(verdictBox(page)).toContainText('総合判定：注意')
  await expect(verdictBox(page).getByRole('list', { name: '判定の理由' })).toContainText('注意とした完了基準を満たしていません：「部署は4つ」')
  const exportButton = conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true })
  await expect(exportButton).toBeDisabled()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Excelに出力' })).toBeDisabled()

  await conclusion(page).getByRole('checkbox', { name: /確認したうえで出力する/ }).check()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Excelに出力' })).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toContain('_結果_')
})

test('「重大」の結果は、処理結果を出力せず、調査用の確認結果だけを出力する', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(5, 'critical')])
  await expect(verdictBox(page)).toContainText('総合判定：重大')
  await expect(verdictBox(page)).toContainText('処理結果は出力できません')
  await expect(conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true })).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: '確認結果をExcelに出力する（調査用）' }).click()])
  expect(download.suggestedFilename()).toContain('確認結果（調査用）')
})

test('業務の完了基準がないときは「正常」と言い切らず、標準の確認のみと示す', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [])
  await expect(verdictBox(page)).toContainText('（標準の確認のみ）')
  await expect(verdictBox(page)).toContainText('業務の完了基準は設定されていません')
})
