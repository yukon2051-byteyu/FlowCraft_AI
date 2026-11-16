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
  await page.goto('/build?start=file')
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

const footerStatus = (page: Page) => page.getByRole('status', { name: '今の判定' })
const outputArea = (page: Page) => page.getByRole('region', { name: 'Excelを出力する' })

test('完了基準をすべて満たすと「正常」。STEP 4 から「次へ：出力・保存」で STEP 5 へ進み、確認なしで出力できる', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(4, 'critical')])
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  await expect(verdictBox(page)).toContainText('（完了基準と標準の確認）')
  await expect(verdictBox(page)).toContainText('完了基準（1件）をすべて満たしています。')
  await expect(conclusion(page).getByRole('checkbox', { name: /確認したうえで出力する/ })).toHaveCount(0)
  // STEP 4 には出力・保存の操作を置かない。次に行うことを1行で示す
  await expect(conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true })).toHaveCount(0)
  await expect(conclusion(page).getByLabel('次に行うこと')).toHaveText('処理と品質確認が完了しました。次に、Excelの出力・保存へ進んでください。')
  await expect(footerStatus(page)).toHaveText('正常：正式な出力ができます')
  const summary = await conclusion(page).getByLabel('処理結果の要約').innerText()
  await page.getByRole('button', { name: '次へ：出力・保存' }).click()
  await expect(page.getByRole('heading', { name: '出力・保存' })).toBeVisible()
  await expect(outputArea(page).getByRole('list', { name: '出力するシート' })).toContainText('確認結果')
  const [download] = await Promise.all([page.waitForEvent('download'), outputArea(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
  await expect(outputArea(page).getByRole('status').last()).toContainText('を保存しました')
  // STEP 4 に戻っても再実行しない（実行日時が同じ＝同じ実行の結果のまま）
  await page.getByRole('button', { name: '実行結果に戻る' }).click()
  await expect(conclusion(page).getByLabel('処理結果の要約')).toHaveText(summary)
  await expect(footerStatus(page)).toHaveText('正常：正式な出力ができます')
})

test('「注意」（確認必須）は「注意事項を確認する」で確認の欄へ移動し、確認すると「次へ」に切り替わる（上部のボタンも STEP 5 へ進む）', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(5, 'caution')])
  await expect(verdictBox(page)).toContainText('総合判定：注意')
  await expect(verdictBox(page).getByRole('list', { name: '判定の理由' })).toContainText('注意とした完了基準を満たしていません：「部署は4つ」')
  await expect(page.getByRole('button', { name: '次へ：出力・保存' })).toHaveCount(0)
  await page.getByRole('button', { name: '注意事項を確認する' }).click()
  const check = conclusion(page).getByRole('checkbox', { name: /確認したうえで出力する/ })
  await expect(check).toBeInViewport()
  await check.check()
  await expect(footerStatus(page)).toHaveText('確認済み：出力できます')
  // 上部の「Excelに出力」も、STEP 4 では出力・保存の画面へ進む（同じ目的に進む）
  await page.getByRole('banner').getByRole('button', { name: 'Excelに出力' }).click()
  await expect(page.getByRole('heading', { name: '出力・保存' })).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), outputArea(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
})

test('「重大」は「異常の詳細を確認する」で完了基準の判定へ移動する（重大の項目が先頭）。正式な処理結果は出力できず、調査用の確認結果だけを出力する', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [rows(5, 'critical')])
  await expect(verdictBox(page)).toContainText('総合判定：重大')
  await expect(verdictBox(page)).toContainText('処理結果は出力できません')
  // 処理と検証は完了したが、正式な出力は停止（2つを分けて示す）
  await expect(conclusion(page)).toContainText('処理・検証：完了')
  await expect(conclusion(page).getByLabel('正式な出力')).toHaveText('正式な出力：停止（調査用の確認結果だけを出力できます）')
  await expect(footerStatus(page)).toHaveText('重大な異常：正式な出力を停止しています')
  await expect(page.getByRole('button', { name: '次へ：出力・保存' })).toHaveCount(0)
  await page.getByRole('button', { name: '異常の詳細を確認する' }).click()
  const results = page.getByRole('region', { name: '完了基準の判定' })
  await expect(results).toBeInViewport()
  await expect(results.getByRole('listitem').first()).toContainText('満たしていない（重大）')
  // 調査用の記録は STEP 5 で出力できる（正式な処理結果ではない）
  await page.getByRole('button', { name: '調査用の記録を出力する' }).click()
  await expect(outputArea(page).getByRole('status', { name: '正式な出力' })).toContainText('重大な品質異常があるため、正式な処理結果は出力できません')
  await expect(outputArea(page).getByRole('button', { name: 'Excelに出力する', exact: true })).toHaveCount(0)
  await expect(outputArea(page).getByRole('list', { name: '出力するシート' }).getByRole('listitem')).toHaveCount(2)
  const [download] = await Promise.all([page.waitForEvent('download'), outputArea(page).getByRole('button', { name: '確認結果をExcelに出力する（調査用）' }).click()])
  expect(download.suggestedFilename()).toContain('確認結果（調査用）')
})

test('業務の完了基準がないときは「正常」と言い切らず、標準の確認のみと示す', async ({ page }) => {
  test.setTimeout(120_000)
  await openAndRun(page, [])
  await expect(verdictBox(page)).toContainText('（標準の確認のみ）')
  await expect(verdictBox(page)).toContainText('業務の完了基準は設定されていません')
})
