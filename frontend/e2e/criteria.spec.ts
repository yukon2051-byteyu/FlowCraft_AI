import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildMonthlySales, demo } from './helpers'

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

  // 完了基準の判定と根拠（2-5）：重大で満たさないものが先頭。根拠の値と、該当する例を示す
  const results = page.getByRole('region', { name: '完了基準の判定' }).getByRole('listitem')
  await expect(results).toHaveCount(5)
  const first = results.first()
  await expect(first).toHaveAttribute('aria-label', '完了基準：対象月の伝票だけ')
  await expect(first).toContainText('満たしていない（重大）')
  await expect(first.getByRole('definition').first()).toBeVisible()
  await expect(first).toContainText('対象期間2026-11-01〜2026-11-30')
  await expect(first).toContainText('期間外の件数240') // 10月分のファイルなので、全240行が期間外
  await expect(first).toContainText('対応：')
  await first.getByRole('button', { name: /該当する例/ }).click()
  await expect(first).toContainText('結果の行：1')
  // 満たしているものは後ろに並び、対応は出さない
  const passed = results.filter({ hasText: '満たしている' }).first()
  await expect(passed).not.toContainText('対応：')
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
  expect(saved.schema_version).toBe('1.3')
  expect(saved.completion_criteria.items).toEqual([
    expect.objectContaining({ name: '部署は4つ', kind: 'row_count', params: { min: 4, max: 4 }, on_fail: 'caution', origin: 'manual', rule_version: 1 }),
  ])
  // 品質ルールの識別（品質MVP）：作業手順をまたいで追えるよう、ルールごとに推測できない識別を持つ
  expect(saved.completion_criteria.items[0].rule_id).toMatch(/^[0-9a-f-]{36}$/)
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

test('完了基準を変えて保存すると版が上がり、変更の記録がファイルに残る。開き直しても同じ判定になる（2-6）', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')
  await openCriteria(page)
  await page.getByRole('button', { name: '基準を追加' }).click()
  await page.getByRole('region', { name: '追加する基準を選ぶ' }).getByRole('button', { name: /^件数が範囲内にある/ }).click()
  const ed = editor(page, '件数が範囲内にある')
  await ed.getByRole('textbox', { name: '基準の名前' }).fill('部署は4つ')
  const named = editor(page, '部署は4つ')
  const target = named.getByRole('combobox', { name: '確かめる対象' })
  const opts = await target.locator('option').allTextContents()
  await target.selectOption({ label: opts.find((o) => o.startsWith('ステップ6の結果'))! })
  await named.getByRole('spinbutton', { name: '最小の件数' }).fill('4')
  await named.getByRole('spinbutton', { name: '最大の件数' }).fill('4')

  const save = async () => {
    await page.getByRole('banner').getByRole('button', { name: '作業手順を保存' }).click()
    const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
    await dialog.getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
    await expect(dialog.getByRole('status')).toContainText('保存しました')
    await dialog.getByRole('button', { name: '閉じる' }).last().click()
    return { path: (await download.path())!, json: JSON.parse(await readFile((await download.path())!, 'utf-8')) }
  }
  const first = await save()
  expect(first.json.completion_criteria.version).toBe(1)
  expect(first.json.completion_criteria.changelog.map((c: { summary: string }) => c.summary)).toEqual(['完了基準を設定（1件）'])

  // 重さを変えると（件数の基準の初期値は「注意」）、保存していない変更として示し、保存すると版2
  await named.getByRole('radio', { name: '重大（止める）' }).check()
  const history = page.getByRole('region', { name: '完了基準の変更の記録' })
  await expect(history.getByRole('list', { name: '保存していない変更' })).toContainText('「部署は4つ」：満たさないときを注意→重大に')
  const second = await save()
  expect(second.json.completion_criteria.version).toBe(2)
  expect(second.json.completion_criteria.changelog.at(-1)).toMatchObject({ version: 2, summary: '「部署は4つ」：満たさないときを注意→重大に' })
  await expect(history).toContainText('完了基準の版 2')

  // 別のブラウザでファイルを開いて再実行 → 記録が残り、同じ判定
  const other = await browser.newPage()
  await other.goto('/build?start=file')
  await other.getByRole('banner').getByRole('button', { name: '作業手順を開く' }).click()
  await other.getByTestId('flow-file-input').setInputFiles(second.path)
  await other.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(other.getByRole('button', { name: 'この割当で作業手順へ進む' })).toBeEnabled({ timeout: 30_000 })
  await other.getByRole('button', { name: 'この割当で作業手順へ進む' }).click()
  await other.getByRole('tab', { name: /何を満たせば完了？/ }).click()
  await expect(other.getByRole('region', { name: '完了基準の変更の記録' })).toContainText('版2')
  await other.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(other)).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(verdictBox(other)).toContainText('完了基準（1件）をすべて満たしています。')
  await other.close()
})
