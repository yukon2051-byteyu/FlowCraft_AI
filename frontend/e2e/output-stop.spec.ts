import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import { throughDemoSteps } from './helpers'
import { xlsxSheetNames } from './xlsx'

/*
 * レビュー指摘 1・2（2026-11-17）：重大な品質異常のときの表示を「正式出力停止」に統一し、原因と対応・再実行を上部にまとめる。
 * 商品マスタ照合の異常デモ（架空のデータ）：照合できない行 6行（前後の空白 2・全角半角 2・マスタ未登録 2）で、正式な出力を止める。
 */

const REPORT = '調査用レポートをExcelに出力'
const top = async (page: Page, name: string) => (await page.locator(`[aria-label="${name}"]`).first().boundingBox())!.y

async function sheets(download: Download) {
  return xlsxSheetNames((await download.path())!)
}

test('重大：先頭に「照合漏れ6行・正式出力停止」、原因ごとの行数と直し方、すぐ下に再実行。どの入口からも調査用レポートだけを出力し、直して再実行すると正式な出力に戻る', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/build?demo=product_match&pattern=ng')
  await throughDemoSteps(page)
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()

  // 1. 先頭は正式な出力の可否。実行と品質検証は最後まで終わったことを補足する
  const stop = page.getByRole('alert', { name: '正式出力停止' })
  await expect(stop.getByRole('heading')).toHaveText('照合漏れ6行・正式出力停止', { timeout: 30_000 })
  await expect(stop).toContainText('照合できない行が6行あります（許容 0行）。')
  await expect(stop).toContainText('実行と品質検証は最後まで完了しました。')

  // ヘッダーと本文のボタン名は同じ。「出力する表」は調査用プレビューにし、「すべての行を保存できる」とは書かない
  const header = page.getByRole('banner').getByRole('button', { name: REPORT })
  const body = page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: REPORT })
  await expect(header).toBeVisible()
  await expect(body).toBeVisible()
  await expect(page.getByRole('button', { name: /^Excelに出力(する)?$/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '調査用プレビュー（正式出力停止中）' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('すべての行は')

  // 2. 原因と対応：原因ごとの行数・直し方・例（実行結果から）。例と判定の根拠は原因の近くで開け、全件数と表示件数を示す
  const causes = page.getByRole('region', { name: '原因と対応' })
  const rows = causes.getByRole('table', { name: '原因の内訳' }).locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('前後の空白2行')
  await expect(rows.nth(1)).toContainText('全角・半角の違い2行')
  await expect(rows.nth(2)).toContainText('マスタ未登録（相手の表にない値）2行')
  await expect(rows.nth(2)).toContainText('マスタへの登録漏れか、コードの誤りを確認してください。')
  const details = causes.getByRole('button', { name: '該当する例と判定の根拠（6行中5行を表示）' })
  await details.click()
  await expect(causes.getByRole('list', { name: '該当する例' }).getByRole('listitem')).toHaveCount(5)
  await expect(causes.getByLabel('判定の根拠')).toContainText('許容件数')

  // 並び：判定と出力可否 → 原因と対応 → 再実行 → 前回比較・データの分析
  const fix = page.getByRole('button', { name: '直したデータで再実行する' })
  const fixY = (await fix.boundingBox())!.y
  expect(await top(page, '正式出力停止')).toBeLessThan(await top(page, '実行の結論'))
  expect(await top(page, '実行の結論')).toBeLessThan(await top(page, '原因と対応'))
  expect(await top(page, '原因と対応')).toBeLessThan(fixY)
  expect(fixY).toBeLessThan(await top(page, '前回との比較'))
  expect(fixY).toBeLessThan(await top(page, 'データの分析'))

  // どの入口からも、調査用レポート（確認結果・処理の記録）だけ。正式な集計・明細のシートは含まない
  const [d1] = await Promise.all([page.waitForEvent('download'), header.click()])
  expect(await sheets(d1)).toEqual(['確認結果', '処理の記録'])
  const [d2] = await Promise.all([page.waitForEvent('download'), body.click()])
  expect(await sheets(d2)).toEqual(['確認結果', '処理の記録'])

  // 直したデータで再実行：未照合 6→0、重大→正常、停止→出力できる。通常の「Excelに出力」と正式な結果のプレビューに戻る
  await fix.click()
  const compare = page.getByRole('region', { name: '直す前と後の比較' })
  await expect(compare).toBeVisible({ timeout: 30_000 })
  await expect(compare.getByRole('row', { name: /総合判定/ })).toContainText('重大正常')
  await expect(compare.getByRole('row', { name: /正式な出力/ })).toContainText('停止出力できる')
  await expect(compare.getByRole('row', { name: /照合できない商品コードが0件/ })).toContainText('6')
  await expect(compare.getByRole('row', { name: /照合できない商品コードが0件/ })).toContainText('0')
  await expect(page.getByRole('alert', { name: '正式出力停止' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '原因と対応' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '出力する表' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Excelに出力', exact: true })).toBeVisible()
  const [d3] = await Promise.all([page.waitForEvent('download'), page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  const names = await sheets(d3)
  expect(names).toEqual(expect.arrayContaining(['カテゴリ別売上', '照合済みの明細', '確認結果', '処理の記録']))
})
