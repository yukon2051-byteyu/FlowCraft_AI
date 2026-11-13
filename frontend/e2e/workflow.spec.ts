import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { BANNED, demo } from './helpers'

/*
 * 新しいワークフロー Phase 2：作業起点（ひな形から仮の手順 → データを読み込んで列を照合 → 実行・品質確認）、
 * Excel起点の作業の名前、保存した手順の別名で保存（複製）。デモ用の架空データを使う。
 */

const stepTexts = async (page: Page) => (await page.getByRole('list', { name: '作業の段階' }).locator(':scope > li').allInnerTexts()).map((t) => t.replace(/\s+/g, ''))
const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })
const verdictBox = (page: Page) => conclusion(page).getByRole('status', { name: '総合判定' })

async function run(page: Page) {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toBeVisible({ timeout: 30_000 })
}

test('作業起点：ひな形から仮の手順を作り、データを読み込んで照合する。写した品質ルールは確かめるまで未検証で、正式な出力を止める', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/build?start=work')
  await page.getByRole('textbox', { name: '案件名' }).fill('部署別売上（10月）')
  await page.getByRole('textbox', { name: 'やりたい作業・目的' }).fill('営業会議で使う')
  const ways = page.getByRole('radiogroup', { name: '手順の作り方' })
  await expect(ways.getByRole('radio', { name: 'ひな形から作る' })).toHaveAttribute('aria-checked', 'true')
  const next = page.getByRole('button', { name: '次へ：手順を確認する' })
  await expect(next).toBeDisabled() // ひな形を選ぶまで進めない
  await page.getByRole('radiogroup', { name: 'もとにするひな形' }).getByRole('radio', { name: '月次売上集計' }).click()
  await next.click()

  // 仮の手順：作業の名前は引き継ぎ、まだデータを読み込んでいない（手順を確認する段階）
  await expect(page.getByRole('banner')).toContainText('部署別売上（10月）')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible({ timeout: 20_000 })
  expect(await stepTexts(page)).toEqual(['作業を伝える', '2手順を確認する', '3データを読み込む', '4実行・品質確認', '5出力・保存'])
  await expect(page.getByText(/ファイルを割り当てていない入力が3つあります/)).toBeVisible()

  // データを読み込み、ひな形の列と照合する（読込後の最終確認）
  await page.getByRole('button', { name: '次へ：データを読み込む' }).click()
  await expect(page.getByRole('heading', { name: '「部署別売上（10月）」に、今回のファイルを割り当てる' })).toBeVisible()
  expect((await stepTexts(page))[2]).toBe('3データを読み込む')
  await page.getByTestId('assign-file-input').setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  const proceed = page.getByRole('button', { name: 'この割当で作業手順へ進む' })
  await expect(proceed).toBeEnabled({ timeout: 20_000 })
  await proceed.click()

  // 写した品質ルールは未確認：実行すると未検証になり、重大のルールがあるので正式な出力を止める（U-1）
  await page.getByRole('textbox', { name: '実行時に指定する値：対象月' }).fill('2026-10')
  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：未検証')
  await expect(conclusion(page).getByLabel('正式な出力')).toContainText('停止')

  // ルールを1つずつ確かめて「確認済み」にすると、正常になり出力できる
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await page.getByRole('tab', { name: /完了基準/ }).click()
  const items = page.getByRole('list', { name: '完了基準' }).getByRole('button')
  const n = await items.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    await items.nth(i).click()
    await page.getByRole('button', { name: '内容を確かめた（確認済みにする）' }).click()
  }
  await expect(page.getByRole('list', { name: '完了基準' })).not.toContainText('未確認')
  await page.getByRole('tab', { name: /処理ステップ|作業手順/ }).first().click()
  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  await expect(page.locator('body')).not.toContainText(BANNED)
})

test('Excel起点：使う列を決める画面で作業の名前を入れると、「作業を伝える」が完了になる', async ({ page }) => {
  await page.goto('/build?start=file')
  await page.getByTestId('file-input').first().setInputFiles(demo('部署マスタ.csv'))
  await page.getByRole('button', { name: /次へ：使う列と形式を決める/ }).click()
  expect((await stepTexts(page))[1]).toContain('省略')
  await page.getByRole('textbox', { name: '作業の名前' }).fill('部署の一覧')
  expect((await stepTexts(page))[1]).toBe('作業を伝える')
  await expect(page.getByRole('banner')).toContainText('部署の一覧')
})

test('保存した手順を別名で保存（複製）すると、新しい手順IDの版1になり、複製元を記録し、品質ルールは未確認になる', async ({ page }) => {
  await page.goto('/build?start=saved')
  const dialog = page.getByRole('dialog', { name: '作業手順を開く' })
  await dialog.getByTestId('flow-file-input').setInputFiles(demo('../flows/demo_monthly_sales.json'))
  await page.getByRole('button', { name: 'ファイルを割り当てずに作業手順を見る' }).click()
  const original = JSON.parse(await readFile(demo('../flows/demo_monthly_sales.json'), 'utf-8'))

  await page.getByRole('banner').getByRole('button', { name: '作業手順を保存' }).click()
  const save = page.getByRole('dialog', { name: '作業手順を保存' })
  await save.getByRole('radio', { name: /別名で保存/ }).check()
  await expect(save.getByRole('textbox', { name: '作業手順の名前' })).toHaveValue(`${original.flow_name}（コピー）`)
  await expect(save).toContainText('新しい作業手順として、版1で保存します。')
  const [download] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: '保存する' }).click()])
  const saved = JSON.parse(await readFile((await download.path())!, 'utf-8'))
  expect(saved.flow_id).not.toBe(original.flow_id)
  expect(saved.flow_version).toBe(1)
  expect(saved.flow_name).toBe(`${original.flow_name}（コピー）`)
  const first = saved.completion_criteria.items[0]
  expect(first.copied_from).toEqual({ rule_id: `${original.flow_id}:${original.completion_criteria.items[0].criterion_id}`, rule_version: 1 })
  expect(first.confirmation_status).toBe('pending')
  // 複製元の変更の記録は引き継がず、新しい手順の版1の記録として始める
  expect(saved.completion_criteria.changelog).toEqual([expect.objectContaining({ version: 1, summary: `完了基準を設定（${original.completion_criteria.items.length}件）` })])
})
