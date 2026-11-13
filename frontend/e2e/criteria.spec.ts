import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildMonthlySales } from './helpers'

/*
 * タスク2-4：完了基準の設定画面（何を満たせば完了？）。
 * テンプレートと手動で設定し、サーバーの検証を通り、実行すると総合判定に反映されることを確かめる。デモ用の架空データ。
 */

const panelList = (page: Page) => page.getByRole('list', { name: '完了基準' })
const editor = (page: Page, name: string) => page.getByRole('region', { name: `完了基準「${name}」の設定` })
const verdictBox = (page: Page) => page.getByRole('region', { name: '実行の結論' }).getByRole('status', { name: '総合判定' })

async function openCriteria(page: Page) {
  await page.getByRole('tab', { name: /何を満たせば完了？/ }).click()
  await expect(page.getByRole('heading', { name: '何を満たせば完了？（完了基準）' })).toBeVisible()
}

test('テンプレート「売上集計」で設定し、対象月を入れて実行すると、完了基準で判定される', async ({ page }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await openCriteria(page)
  await expect(page.getByText('まだ完了基準はありません')).toBeVisible()
  // 自動で行う確認（設定は不要）も一覧で示す
  await expect(page.getByRole('region', { name: '自動で行う確認' })).toContainText('集計の前後で合計と件数が一致しているか')

  await page.getByRole('button', { name: 'テンプレートから追加' }).click()
  await page.getByRole('region', { name: 'テンプレートを選ぶ' }).getByRole('button', { name: /^売上集計/ }).click()
  const items = panelList(page).getByRole('listitem')
  await expect(items).toHaveCount(5)
  await expect(page.getByRole('tab', { name: /完了基準 5/ })).toBeVisible()
  // 推し当てた基準は設定済み（期間は「実行するたびに指定」）
  await expect(items.filter({ hasText: '設定が必要' })).toHaveCount(0)
  await expect(items.filter({ hasText: '対象月の伝票だけ' })).toContainText('実行時に指定（対象月）')

  // 対象月を入れるまで実行できない
  const run = page.getByRole('button', { name: '作業手順全体を実行する' })
  await expect(page.getByText('実行時に指定する値（対象月）を入力してください')).toBeVisible()
  await expect(run).toBeDisabled()
  await page.getByRole('textbox', { name: '実行時に指定する値：対象月' }).fill('2026-10')
  await expect(run).toBeEnabled({ timeout: 10_000 })
  await run.click()
  await expect(verdictBox(page)).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(verdictBox(page)).toContainText('（完了基準と標準の確認）')
  await expect(verdictBox(page)).toContainText('完了基準（5件）をすべて満たしています。')
})

test('別の月を指定すると、対象期間の基準を満たさず「重大」になる', async ({ page }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await openCriteria(page)
  await page.getByRole('button', { name: 'テンプレートから追加' }).click()
  await page.getByRole('region', { name: 'テンプレートを選ぶ' }).getByRole('button', { name: /^売上集計/ }).click()
  await page.getByRole('textbox', { name: '実行時に指定する値：対象月' }).fill('2026-11')
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toContainText('総合判定：重大', { timeout: 30_000 })
  await expect(verdictBox(page).getByRole('list', { name: '判定の理由' })).toContainText('「対象月の伝票だけ」')
})

test('手動で基準を追加・設定し、未設定の間は実行できない。保存したファイルに基準が残る', async ({ page, request }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await openCriteria(page)
  await page.getByRole('button', { name: '基準を追加' }).click()
  await page.getByRole('region', { name: '追加する基準を選ぶ' }).getByRole('button', { name: /^件数が範囲内にある/ }).click()
  const ed = editor(page, '件数が範囲内にある')
  await expect(ed.getByRole('list', { name: '設定が必要なこと' })).toContainText('最小・最大のどちらかを入れてください')
  await expect(page.getByText(/設定が終わっていない完了基準が1つあります/)).toBeVisible()
  await expect(page.getByRole('button', { name: '作業手順全体を実行する' })).toBeDisabled()

  await ed.getByRole('textbox', { name: '基準の名前' }).fill('部署は4つ')
  const named = editor(page, '部署は4つ')
  // ステップ6（集計）の結果を対象にする（ステップの名前は作り方で変わるため、番号で選ぶ）
  const target = named.getByRole('combobox', { name: '確かめる対象' })
  const opts = await target.locator('option').allTextContents()
  await target.selectOption({ label: opts.find((o) => o.startsWith('ステップ6の結果'))! })
  await named.getByRole('spinbutton', { name: '最小の件数' }).fill('4')
  await named.getByRole('spinbutton', { name: '最大の件数' }).fill('4')
  await named.getByRole('radio', { name: '注意（確認してから出力）' }).check()
  await expect(named.getByRole('list', { name: '設定が必要なこと' })).toHaveCount(0)
  await expect(panelList(page).getByRole('listitem')).toContainText('設定済み')

  // 保存したファイルに完了基準が入り、サーバーの検証を通る
  await page.getByRole('banner').getByRole('button', { name: '作業手順を保存' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await dialog.getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  await expect(dialog.getByRole('status')).toContainText('保存しました')
  const saved = JSON.parse(await readFile((await download.path())!, 'utf-8'))
  expect(saved.schema_version).toBe('1.1')
  expect(saved.completion_criteria.items).toEqual([
    expect.objectContaining({ name: '部署は4つ', kind: 'row_count', params: { min: 4, max: 4 }, on_fail: 'caution', origin: 'manual' }),
  ])
  const session = (await (await request.post('/api/session')).json()).session_id
  const check = await (await request.post('/api/flows/validate', { data: { flow: saved }, headers: { 'X-Session-Id': session } })).json()
  expect(check.valid).toBe(true)

  // 実行すると、手動で決めた基準で判定される
  await dialog.getByRole('button', { name: '閉じる' }).last().click()
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(verdictBox(page)).toContainText('完了基準（1件）をすべて満たしています。')
})

test('基準を削除すると一覧から消え、使われなくなった「実行時に指定する値」も消える', async ({ page }) => {
  test.setTimeout(150_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await openCriteria(page)
  await page.getByRole('button', { name: 'テンプレートから追加' }).click()
  await page.getByRole('region', { name: 'テンプレートを選ぶ' }).getByRole('button', { name: /^売上集計/ }).click()
  await expect(page.getByRole('textbox', { name: '実行時に指定する値：対象月' })).toBeVisible()
  await panelList(page).getByRole('button', { name: '完了基準：対象月の伝票だけ' }).click()
  await editor(page, '対象月の伝票だけ').getByRole('button', { name: 'この基準を削除' }).click()
  await expect(panelList(page).getByRole('listitem')).toHaveCount(4)
  await expect(page.getByRole('textbox', { name: '実行時に指定する値：対象月' })).toHaveCount(0)
})
