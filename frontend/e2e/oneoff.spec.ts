import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildMonthlySales, card, demo } from './helpers'

/*
 * タスク1-11：今回だけの作業の導線。
 * - 保存しなくても、実行してExcelに出力して終われる（保存を促し続けない・出力後は離れるときに確認しない）
 * - 実行した後で「この作業手順を保存する」を選べる（作り直し不要）。保存したファイルで、次回に再実行できる
 * デモ用の架空データを使う。
 */

const header = (page: Page) => page.getByRole('banner')
const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })

async function runAll(page: Page) {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(conclusion(page)).toContainText('最後まで実行しました', { timeout: 30_000 })
}

async function deptTotal(page: Page): Promise<number> {
  const out = page.getByRole('region', { name: '出力する表' })
  await expect(out).toContainText('全 4 行')
  const totals = await out.locator('tbody tr').evaluateAll((rows) => rows.map((r) => Number((r.lastElementChild?.textContent ?? '0').replace(/,/g, ''))))
  return totals.reduce((a, b) => a + b, 0)
}

test('保存しなくても、実行して出力して終われる。出力した後は、離れるときに確認しない', async ({ page }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  // 保存は任意：警告の色ではなく、控えめに表示する
  await expect(header(page).getByText('保存していません（保存は任意です）')).toBeVisible()
  await expect(header(page).getByText('未保存の変更があります')).toBeHidden()

  await runAll(page)
  // 実行しただけ（出力していない）なら、離れると作業が失われるので確認する
  let asked = ''
  page.once('dialog', (d) => {
    asked = d.message()
    void d.dismiss()
  })
  await header(page).getByRole('link', { name: 'トップへ戻る' }).click()
  expect(asked).toContain('保存していない変更があります')
  await expect(page).toHaveURL(/\/build$/)

  // 保存せずに出力する
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toMatch(/_結果_\d{8}-\d{4}\.xlsx$/)
  // 結果の画面では、保存は「任意」として案内するだけ
  await expect(conclusion(page).getByRole('button', { name: 'この作業手順を保存する' })).toBeVisible()
  await expect(conclusion(page)).toContainText('任意です。今回だけの作業なら、保存せずに終われます。')

  // 出力した後は、確認なしで離れられる（タブを閉じるときも確認しない）
  let askedAgain = false
  page.on('dialog', (d) => {
    askedAgain = true
    void d.accept()
  })
  await header(page).getByRole('link', { name: 'トップへ戻る' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(askedAgain).toBe(false)
})

test('出力した後に作業手順を変えたら、離れるときにもう一度確認する', async ({ page }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await runAll(page)
  await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await page.getByRole('region', { name: '追加する処理を選ぶ' }).getByRole('button', { name: /^並べ替える/ }).click()
  let asked = ''
  page.once('dialog', (d) => {
    asked = d.type()
    void d.dismiss()
  })
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => asked).toBe('beforeunload')
})

test('実行した後に保存でき（作り直し不要）、保存したファイルで次回に再実行できる', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await runAll(page)
  expect(await deptTotal(page)).toBe(20_818_240)

  // 結果の画面から保存する
  await conclusion(page).getByRole('button', { name: 'この作業手順を保存する' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await dialog.getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  await expect(dialog.getByRole('status')).toContainText('版1として保存しました')
  await dialog.getByRole('button', { name: '閉じる' }).last().click()
  // 結果はそのまま見られ、保存済みと表示される
  await expect(conclusion(page)).toContainText('この作業手順は保存済みです')
  await expect(header(page).getByText('保存していません（保存は任意です）')).toBeHidden()

  // 次回：別のブラウザで、保存したファイルを開いて再実行する → 同じ合計
  const file = path.join(os.tmpdir(), `flowcraft-oneoff-${Date.now()}.json`)
  await writeFile(file, await readFile((await download.path())!, 'utf-8'), 'utf-8')
  const next = await browser.newPage()
  await next.goto('/build')
  await header(next).getByRole('button', { name: '作業手順を開く' }).click()
  await next.getByTestId('flow-file-input').setInputFiles(file)
  await next.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(next.getByRole('button', { name: 'この割当で作業手順へ進む' })).toBeEnabled({ timeout: 30_000 })
  await next.getByRole('button', { name: 'この割当で作業手順へ進む' }).click()
  await expect(card(next, 7)).toContainText('確認済み')
  await runAll(next)
  expect(await deptTotal(next)).toBe(20_818_240)
  await next.close()
})
