import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BANNED, buildMonthlySales, card, demo } from './helpers'

/*
 * タスク1-9：保存した作業手順を開き、今回のファイルを割り当てて実行する。
 * デモ用の架空データ（10月分・11月分）を使う。11月分は「売上金額」が「金額」に変わっている。
 */

const header = (page: Page) => page.getByRole('banner')
const openDialog = (page: Page) => page.getByRole('dialog', { name: '作業手順を開く' })
const saveDialog = (page: Page) => page.getByRole('dialog', { name: '作業手順を保存' })
const slot = (page: Page, label: string) => page.getByRole('region', { name: `入力「${label}」の割当` })

/** 月次売上集計を作って保存し、保存したファイルの中身を返す */
async function buildAndSave(page: Page): Promise<string> {
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await saveDialog(page).getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
  const [download] = await Promise.all([page.waitForEvent('download'), saveDialog(page).getByRole('button', { name: '保存する' }).click()])
  await expect(saveDialog(page).getByRole('status')).toContainText('版1として保存しました')
  await saveDialog(page).getByRole('button', { name: '閉じる' }).last().click()
  return readFile((await download.path())!, 'utf-8')
}

async function stepNames(page: Page): Promise<string[]> {
  return page.getByRole('article', { name: /^ステップ\d+：/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
}

test('一覧から開くと、ステップの構成・設定・順序が完全に復元され、同じ結果になる', async ({ page }) => {
  test.setTimeout(150_000)
  await buildAndSave(page)
  const before = await stepNames(page)
  expect(before).toHaveLength(7)

  // 画面を読み込み直す（編集中の状態は消える。保存した一覧とサーバーのファイルは残る）
  await page.reload()
  await expect(header(page)).toContainText('無題の作業手順')
  await header(page).getByRole('button', { name: '作業手順を開く' }).click()
  const item = openDialog(page).getByRole('listitem').filter({ hasText: '月次売上集計' })
  await expect(item).toContainText('版1')
  await expect(item).toContainText('入力3つ・ステップ7個')
  await item.getByRole('button', { name: '開く' }).click()

  // 割当：ファイル名から候補が選ばれ、列がそろっていることを確かめる
  await expect(page.getByRole('heading', { name: '「月次売上集計」に、今回のファイルを割り当てる' })).toBeVisible()
  await expect(slot(page, '売上実績').getByRole('combobox', { name: '「売上実績」に使うファイル' })).toHaveValue(/.+/)
  await expect(slot(page, '売上実績').getByRole('list', { name: '「売上実績」の列の確認' })).toContainText('売上金額')
  await page.getByRole('button', { name: 'この割当で作業手順へ進む' }).click()

  // 構成・順序・名前・確認済みの状態が、保存したときと同じ
  expect(await stepNames(page)).toEqual(before)
  await expect(card(page, 7)).toContainText('確認済み')
  // 内容も同じ：もう一度保存しようとすると「変更はありません」
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await expect(saveDialog(page)).toContainText('変更はありません。版1のまま')
  await saveDialog(page).getByRole('button', { name: 'やめる' }).click()

  // 実行すると、正解値と同じ合計になる
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(page.getByRole('region', { name: '実行の結論' })).toContainText('最後まで実行しました', { timeout: 30_000 })
  const out = page.getByRole('region', { name: '出力する表' })
  await expect(out).toContainText('全 4 行')
  const totals = await out.locator('tbody tr').evaluateAll((rows) => rows.map((r) => Number((r.lastElementChild?.textContent ?? '0').replace(/,/g, ''))))
  expect(totals.reduce((a, b) => a + b, 0)).toBe(20_818_240)
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await expect(page.getByRole('button', { name: 'ファイルの割当に戻る' })).toBeVisible()
})

test('ファイルから開き、必須の列がないファイル（11月分：「売上金額」→「金額」）を選ぶと、実行前に止めて理由を示す', async ({ page, browser }) => {
  test.setTimeout(150_000)
  const text = await buildAndSave(page)
  const file = path.join(os.tmpdir(), `flowcraft-e2e-${Date.now()}.json`)
  await writeFile(file, text, 'utf-8')

  // 別のブラウザ（保存した一覧がない状態）で、ファイルから開く
  const other = await browser.newPage()
  await other.goto('/build')
  await header(other).getByRole('button', { name: '作業手順を開く' }).click()
  await expect(openDialog(other)).toContainText('まだありません')
  await openDialog(other).getByTestId('flow-file-input').setInputFiles(file)
  await expect(other.getByRole('heading', { name: '「月次売上集計」に、今回のファイルを割り当てる' })).toBeVisible()

  // 今回のファイルを読み込む。10月分と11月分の両方があると、売上実績の候補は選ばない（曖昧なまま選ばない）
  await other.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('売上実績_2026-11.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  const sales = slot(other, '売上実績')
  const select = sales.getByRole('combobox', { name: '「売上実績」に使うファイル' })
  await expect(select.locator('option')).toHaveCount(4, { timeout: 20_000 }) // （選ぶ）＋ Excel 3つ（売上2つ・商品マスタ）。CSV は出さない
  await expect(select).toHaveValue('')
  await expect(slot(other, '部署マスタ').getByRole('combobox', { name: '「部署マスタ」に使うファイル' })).not.toHaveValue('')
  await expect(other.getByRole('list', { name: 'まだ進めない理由' })).toContainText('「売上実績」に使うファイルを選んでください')

  // 11月分：必須の列「売上金額」がない → 進めない
  await select.selectOption({ label: '売上実績_2026-11.xlsx' })
  await expect(sales.getByRole('list', { name: '「売上実績」の列の確認' })).toContainText('売上金額整数・必須の列がありません')
  await expect(sales).toContainText('作業手順で使わない列（読み込みません）：担当者、金額')
  await expect(other.getByRole('list', { name: 'まだ進めない理由' })).toContainText('「売上実績」に選んだ「売上実績_2026-11.xlsx」に、必須の列「売上金額」がありません')
  await expect(other.getByRole('button', { name: 'この割当で作業手順へ進む' })).toBeDisabled()

  // 10月分に変えると進める
  await select.selectOption({ label: '売上実績_2026-10.xlsx' })
  await expect(other.getByRole('button', { name: 'この割当で作業手順へ進む' })).toBeEnabled({ timeout: 20_000 })
  await expect(other.locator('body')).not.toContainText(BANNED)
  await other.close()
})

test('割り当てずに開くと、作業手順は見られるが、実行はできない（理由を示す）', async ({ page }) => {
  test.setTimeout(150_000)
  await buildAndSave(page)
  await page.reload()
  await header(page).getByRole('button', { name: '作業手順を開く' }).click()
  await openDialog(page).getByRole('listitem').filter({ hasText: '月次売上集計' }).getByRole('button', { name: '開く' }).click()
  await page.getByRole('button', { name: 'ファイルを割り当てずに作業手順を見る' }).click()
  await expect(card(page, 7)).toBeVisible()
  await expect(page.getByText('ファイルを割り当てていない入力が3つあります（「ファイルの割当」で割り当ててください）')).toBeVisible()
  await expect(page.getByRole('button', { name: '作業手順全体を実行する' })).toBeDisabled()
})

test('作業手順のファイルでないもの・形の決まりに合わないものは開かない', async ({ page }) => {
  await page.goto('/build')
  await header(page).getByRole('button', { name: '作業手順を開く' }).click()
  const input = openDialog(page).getByTestId('flow-file-input')

  await input.setInputFiles({ name: 'メモ.json', mimeType: 'application/json', buffer: Buffer.from('これはJSONではない') })
  await expect(openDialog(page).getByRole('alert')).toContainText('「メモ.json」は作業手順のファイルとして読めません')

  await input.setInputFiles({ name: '設定.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"x"}') })
  await expect(openDialog(page).getByRole('alert')).toContainText('「設定.json」は作業手順のファイルではありません')

  const broken = { flow_name: '壊れた手順', nodes: [{ node_id: 'n1', node_type: 'filter', node_name: '条件', parameters: {}, input_references: ['x'], output_reference: 'r1' }] }
  await input.setInputFiles({ name: '壊れた.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) })
  await expect(openDialog(page).getByRole('alert')).toContainText('「壊れた.json」は、作業手順の形の決まりに合わないため開けません。')
  // 開かなかったので、今の画面のまま
  await expect(header(page)).toContainText('無題の作業手順')
})

test('一覧から削除するときは確認し、削除すると一覧から消える', async ({ page }) => {
  test.setTimeout(150_000)
  await buildAndSave(page)
  await header(page).getByRole('button', { name: '作業手順を開く' }).click()
  page.once('dialog', (d) => void d.accept())
  await openDialog(page).getByRole('button', { name: '「月次売上集計」を一覧から削除' }).click()
  await expect(openDialog(page)).toContainText('まだありません')
})

test('ブラウザを閉じて開き直しても、保存した一覧から開ける（1-10）', async ({ page, browser }) => {
  test.setTimeout(150_000)
  await buildAndSave(page)
  const before = await stepNames(page)
  // ブラウザの保存領域（localStorage）を引き継いだ、新しいブラウザを開く（閉じて開き直したのと同じ）
  const state = await page.context().storageState()
  await page.context().close()
  const reopened = await browser.newContext({ storageState: state })
  const p = await reopened.newPage()
  await p.goto('/build')
  await header(p).getByRole('button', { name: '作業手順を開く' }).click()
  await openDialog(p).getByRole('listitem').filter({ hasText: '月次売上集計' }).getByRole('button', { name: '開く' }).click()
  await p.getByRole('button', { name: 'ファイルを割り当てずに作業手順を見る' }).click()
  expect(await stepNames(p)).toEqual(before)
  await reopened.close()
})

test('開始画面の「保存した作業手順を使う」から開ける', async ({ page }) => {
  await page.goto('/build')
  const card = page.getByRole('complementary', { name: 'ほかの始め方' })
  await expect(card.getByText('保存した作業手順を使う')).toBeVisible()
  await card.getByRole('button', { name: '作業手順を開く' }).click()
  await expect(openDialog(page)).toBeVisible()
})

test('形の版 1.0 の作業手順ファイルを開いて保存すると、最新の版（1.2）になり、完了基準の欄が加わる（2-1）', async ({ page }) => {
  await page.goto('/build')
  await header(page).getByRole('button', { name: '作業手順を開く' }).click()
  await openDialog(page).getByTestId('flow-file-input').setInputFiles(demo('../flows/monthly_sales.json'))
  await page.getByRole('button', { name: 'ファイルを割り当てずに作業手順を見る' }).click()
  await expect(card(page, 9)).toBeVisible()
  // 開いた直後は「変更なし」（古い版からの読み替えは、利用者の変更ではない）
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await expect(dialog).toContainText('変更はありません')
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  const saved = JSON.parse(await readFile((await download.path())!, 'utf-8'))
  expect(saved.schema_version).toBe('1.2')
  expect(saved.completion_criteria).toEqual({ version: 1, items: [], changelog: [] })
  expect(saved.run_parameters).toEqual([])
})
