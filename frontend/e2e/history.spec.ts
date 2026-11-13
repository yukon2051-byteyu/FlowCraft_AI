import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { demo } from './helpers'

/*
 * 分析 Phase C：実行の履歴（このブラウザの IndexedDB）と、毎月の再実行での前回比較。
 * 正式に出力した前月の記録があれば、次の月の実行で自動的に比べる（サーバーは履歴を保存しない。画面が送る）。
 * デモの記録は、通常の履歴と混ぜない。
 */

const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })
const month = (page: Page) => page.getByRole('textbox', { name: '実行時に指定する値：対象月' })

async function runAll(page: Page) {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(conclusion(page).getByRole('status', { name: '総合判定' })).toBeVisible({ timeout: 30_000 })
}

test('毎月の再実行：前月に正式出力した記録と自動で比べ、履歴に残る（このブラウザ）', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/build?start=saved')
  await page.getByRole('dialog', { name: '作業手順を開く' }).getByTestId('flow-file-input').setInputFiles(demo('../flows/demo_monthly_sales.json'))
  await page.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  const proceed = page.getByRole('button', { name: 'この割当で作業手順へ進む' })
  await expect(proceed).toBeEnabled({ timeout: 20_000 })
  await proceed.click()

  // 10月分：初めての実行なので比べる相手はない。正式に出力すると、記録に「出力した」と付く
  await month(page).fill('2026-10')
  await runAll(page)
  await expect(page.getByRole('region', { name: '前回との比較' })).toContainText('比較できる前月（2026年9月）')
  await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])

  // 同じ作業手順を11月として実行：前月（10月）の正式な出力の記録と、自動で比べる
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await month(page).fill('2026-11')
  await runAll(page)
  const prev = page.getByRole('region', { name: '前回との比較' })
  await expect(prev).toContainText('2026年10月と比べています')
  await expect(prev.getByRole('row', { name: /入力件数（売上実績）/ })).toBeVisible()

  // 履歴：2件。新しい順。10月分は「出力した」
  await page.getByRole('banner').getByRole('button', { name: '実行の履歴' }).click()
  const dialog = page.getByRole('dialog', { name: '実行の履歴' })
  const rows = dialog.getByRole('table', { name: '実行の記録' }).locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('2026-11')
  await expect(rows.nth(1)).toContainText('2026-10')
  await expect(rows.nth(1)).toContainText('出力した')
  // 絞り込みと詳細（どのデータを、どの版のルールで検証したか）
  await dialog.getByRole('combobox', { name: '対象期間で絞り込む' }).selectOption('2026-10')
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  const detail = dialog.getByRole('region', { name: '実行の記録の詳細' })
  await expect(detail).toContainText('売上実績_2026-10.xlsx')
  await expect(detail).toContainText('識別')
  await expect(detail).toContainText('（版1）')
})

test('履歴の書き出し・取り込み・削除。デモの記録は通常の履歴に入らない', async ({ page }) => {
  test.setTimeout(150_000)
  // デモを実行しても、通常の履歴には残らない
  await page.goto('/build?demo=monthly_sales&pattern=ok')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible({ timeout: 20_000 })
  await runAll(page)
  await page.getByRole('banner').getByRole('button', { name: '実行の履歴' }).click()
  const dialog = page.getByRole('dialog', { name: '実行の履歴' })
  await expect(dialog).toContainText('記録はまだありません')

  // 取り込み：書き出した形のファイルを取り込むと、「取り込んだ記録」として並ぶ。壊れたファイルは取り込まない
  const record = {
    record_version: 1,
    run_id: 'r_imported',
    source: 'manual',
    executed_at: '2026-10-31T09:00:00Z',
    duration_ms: 10,
    flow_id: 'f-1',
    flow_name: '取り込んだ手順',
    flow_version: 2,
    period: '2026-10',
    inputs: [],
    outputs: [],
    processing_status: 'completed',
    verdict: 'normal',
    verdict_headline: null,
    rules: [],
    official_output: { mode: 'allowed', performed: true, performed_at: null, stop_reason: null },
    metrics: [],
  }
  const file = { name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'flowcraft-run-history', record_version: 1, records: [record, { run_id: 'bad' }] })) }
  await dialog.getByTestId('history-import-input').setInputFiles(file)
  await expect(dialog.getByRole('status')).toContainText('1件を取り込みました（1件は、形が合わないか、すでにあるため取り込みませんでした）')
  const rows = dialog.getByRole('table', { name: '実行の記録' }).locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('取り込んだ記録')
  // 書き出し
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '書き出す' }).click()])
  expect(download.suggestedFilename()).toContain('実行の履歴')
  // 削除（確認してから）
  page.once('dialog', (d) => void d.accept())
  await dialog.getByRole('button', { name: 'すべて削除' }).click()
  await expect(dialog).toContainText('記録はまだありません')
})
