import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BANNED, buildMonthlySales, demo } from './helpers'

/*
 * Phase 3-2：再実行時の入力の変化（列名の変更・列の順番の変化）を、実行前に確かめてから実行する。
 * デモ用の架空データを使う。11月分は「売上金額」が「金額」に変わっている。
 * 列名の対応付けは自動では決めない。利用者が承認した対応付けは、今回の実行の記録に残る。
 */

const header = (page: Page) => page.getByRole('banner')
const saveDialog = (page: Page) => page.getByRole('dialog', { name: '作業手順を保存' })
const slot = (page: Page, label: string) => page.getByRole('region', { name: `入力「${label}」の割当` })
const proceed = (page: Page) => page.getByRole('button', { name: 'この割当で作業手順へ進む' })

/** 月次売上集計を作って保存し、保存したファイルの中身を返す */
async function buildAndSave(page: Page): Promise<string> {
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await saveDialog(page).getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
  const [download] = await Promise.all([page.waitForEvent('download'), saveDialog(page).getByRole('button', { name: '保存する' }).click()])
  await saveDialog(page).getByRole('button', { name: '閉じる' }).last().click()
  return readFile((await download.path())!, 'utf-8')
}

/** 別のブラウザで、保存したファイルから開く */
async function openInOtherBrowser(page: Page, browser: import('@playwright/test').Browser): Promise<Page> {
  const file = path.join(os.tmpdir(), `flowcraft-e2e-remap-${Date.now()}.json`)
  await writeFile(file, await buildAndSave(page), 'utf-8')
  const other = await browser.newPage()
  await other.goto('/build?start=file')
  await header(other).getByRole('button', { name: '作業手順を開く' }).click()
  await other.getByRole('dialog', { name: '作業手順を開く' }).getByTestId('flow-file-input').setInputFiles(file)
  await expect(other.getByRole('heading', { name: '「月次売上集計」に、今回のファイルを割り当てる' })).toBeVisible()
  return other
}

async function runAndTotal(page: Page): Promise<number> {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(page.getByRole('region', { name: '実行の結論' })).toContainText('最後まで実行しました', { timeout: 30_000 })
  const out = page.getByRole('region', { name: '出力する表' })
  // 出力する表は結論の後に読み込まれる。行が出るまで待ってから読む（負荷が高いとき、空の表を読まないように）
  await expect(out.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 })
  const totals = await out.locator('tbody tr').evaluateAll((rows) => rows.map((r) => Number((r.lastElementChild?.textContent ?? '0').replace(/,/g, ''))))
  return totals.reduce((a, b) => a + b, 0)
}

test('列名が変わったファイル（11月分）：候補と理由を示し、承認するまで進めない。承認すると正しく再実行できる', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const other = await openInOtherBrowser(page, browser)
  await other.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-11.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  const sales = slot(other, '売上実績')
  await expect(sales.getByRole('combobox', { name: '「売上実績」に使うファイル' })).not.toHaveValue('', { timeout: 20_000 })

  // 候補と理由を示す。自動では対応付けない（まだ進めない）
  const q = sales.getByRole('group', { name: '前回の列「売上金額」の対応付け' })
  await expect(q).toContainText('前回使っていた「売上金額」列が見つかりません。')
  await expect(q).toContainText('今回のファイルにある「金額」列を使いますか？')
  const reasons = q.getByRole('list', { name: '「金額」を候補にした理由' })
  await expect(reasons).toContainText('列名が似ています')
  await expect(reasons).toContainText('値がすべて整数として読めます')
  await expect(proceed(other)).toBeDisabled()

  // 承認すると、必須の列がそろい、増えた列は「担当者」だけになる
  await q.getByRole('button', { name: '「金額」を使う' }).click()
  const approved = sales.getByRole('group', { name: '承認した列の対応付け' })
  await expect(approved).toContainText('今回の「金額」前回の「売上金額」として使います')
  await expect(approved).toContainText('保存した作業手順は変わりません')
  await expect(sales.getByRole('list', { name: '「売上実績」の列の確認' })).not.toContainText('必須の列がありません')
  await expect(sales).toContainText('作業手順で使わない列（読み込みません）：担当者')
  await expect(proceed(other)).toBeEnabled({ timeout: 20_000 })

  // 取り消すと、また進めなくなる。もう一度承認する
  await approved.getByRole('button', { name: '取り消す' }).click()
  await expect(proceed(other)).toBeDisabled()
  await q.getByRole('button', { name: '「金額」を使う' }).click()
  await expect(proceed(other)).toBeEnabled({ timeout: 20_000 })
  await expect(other.locator('body')).not.toContainText(BANNED)

  // 実行すると、11月分の正解の合計になる（manifest.json：21,448,960）
  await proceed(other).click()
  expect(await runAndTotal(other)).toBe(21_448_960)
  await other.close()
})

test('列の順番が変わったファイル：お知らせだけで止めず、同じ結果で再実行できる', async ({ page, browser }) => {
  test.setTimeout(180_000)
  // 部署マスタ（CSV）の列の順番を入れ替えたファイルを作る（バイト単位で入れ替えるため、文字コードは変わらない）
  const src = (await readFile(demo('部署マスタ.csv'))).toString('latin1')
  const swapped = src
    .split('\r\n')
    .map((line) => {
      if (!line) return line
      const cells = line.split(',')
      return [cells[1], cells[0], ...cells.slice(2)].join(',')
    })
    .join('\r\n')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcraft-e2e-order-'))
  const reordered = path.join(dir, '部署マスタ.csv')
  await writeFile(reordered, Buffer.from(swapped, 'latin1'))

  const other = await openInOtherBrowser(page, browser)
  await other.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), reordered])
  const depts = slot(other, '部署マスタ')
  await expect(depts).toContainText('列の順番が前回と変わっています。列名で読み込むため、結果には影響しません。', { timeout: 20_000 })
  await expect(proceed(other)).toBeEnabled({ timeout: 20_000 })
  await proceed(other).click()
  // 10月分の正解の合計（並べ替える前と同じ）
  expect(await runAndTotal(other)).toBe(20_818_240)
  await other.close()
})
