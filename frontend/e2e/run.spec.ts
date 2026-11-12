import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/*
 * タスク1-6：テスト実行（ステップの処理前後のデータ）と、作業手順全体の実行。
 * デモ用の架空データを使い、合計は manifest.json の正解値（10月の売上合計 20,818,240円）と照合する。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = (name: string) => path.join(here, '..', '..', 'backend', 'app', 'demos', 'data', name)
const BANNED = /ノード|フロー|Phase|確定|真偽値|プレビュー|JSON|マッピング|スキーマ|結合キー|未照合|(?<![定0-9０-９])型(?!番)/

const card = (page: Page, n: number) => page.getByRole('article', { name: new RegExp(`^ステップ${n}：`) })
const panel = (page: Page, n: number) => page.getByRole('region', { name: `ステップ${n}の設定` })

async function addAtEnd(page: Page, name: string) {
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await page.getByRole('region', { name: '追加する処理を選ぶ' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

async function confirm(page: Page, n: number) {
  await panel(page, n).getByRole('button', { name: 'この内容で確認済みにする' }).click()
  await expect(card(page, n)).toContainText('確認済み')
}

/** 売上 ＋ 商品マスタ ＋ 部署マスタ → 部署別に売上を合計 → 出力 */
async function buildMonthlySales(page: Page, master: string) {
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo(master), demo('部署マスタ.csv')])
  await expect(page.getByText('3ファイル')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()

  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の元の表' }).selectOption('in1')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の付け加える表' }).selectOption('in2') // マスタのファイル名によってステップの名前が変わるため、内部の値で選ぶ
  await panel(page, 4).getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('商品コード')
  await panel(page, 4).getByRole('checkbox', { name: '売上金額' }).check()
  await confirm(page, 4)

  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 5).getByRole('combobox', { name: 'ステップ5の付け加える表' }).selectOption('in3')
  await panel(page, 5).getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('部署コード')
  await confirm(page, 5)

  await addAtEnd(page, '項目ごとに合計・集計する')
  await panel(page, 6).getByRole('checkbox', { name: '「部署名」ごとにまとめる' }).check()
  await panel(page, 6).getByRole('combobox', { name: '集計1の列' }).selectOption('売上金額')
  await confirm(page, 6)

  await addAtEnd(page, 'Excelに出力する')
  await panel(page, 7).getByRole('textbox', { name: 'シート1の名前' }).fill('部署別売上')
  await confirm(page, 7)
}

test('ステップの処理前後を確かめ、全体を実行すると、正解値どおりの集計結果になる', async ({ page }) => {
  test.setTimeout(120_000)
  await buildMonthlySales(page, '商品マスタ.xlsx')

  // ステップ4の処理前後のデータ（テスト実行）
  await card(page, 4).getByRole('heading').click()
  await panel(page, 4).getByRole('tab', { name: '処理前後のデータ' }).click()
  await panel(page, 4).getByRole('button', { name: 'このステップまで実行して確かめる' }).click()
  await expect(panel(page, 4).getByLabel('件数の変化')).toContainText('240行 ＋ 30行')
  await expect(panel(page, 4).getByLabel('件数の変化')).toContainText('240行', { timeout: 20_000 })
  // 付け加えた列（商品名など）は、処理後の表に表れる
  await expect(panel(page, 4).getByRole('columnheader', { name: /商品名/ })).toBeVisible()
  // 「使わない」にしなかった列だけが渡る。照合の確認（金額）の結果も表示される
  await expect(panel(page, 4).getByRole('list', { name: '処理のお知らせ' })).toContainText('金額')
  await panel(page, 4).getByRole('tab', { name: '処理前1' }).click()
  await expect(panel(page, 4)).toContainText('全 240 行')

  // 全体を実行
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(page.getByRole('region', { name: '実行の結論' })).toContainText('最後まで実行しました', { timeout: 30_000 })
  const steps = page.getByRole('region', { name: 'ステップごとの結果' })
  await expect(steps.locator(':scope > ol > li')).toHaveCount(7)
  await expect(steps.locator(':scope > ol > li').nth(5)).toContainText('240行 → 4行')

  // 出力する表：部署別の合計を足すと、10月の売上合計（正解値）と一致する
  const out = page.getByRole('region', { name: '出力する表' })
  await expect(out.getByRole('tab', { name: '部署別売上' })).toBeVisible()
  await expect(out).toContainText('全 4 行')
  const totals = await out.locator('tbody tr').evaluateAll((rows) => rows.map((r) => Number((r.lastElementChild?.textContent ?? '0').replace(/,/g, ''))))
  expect(totals.reduce((a, b) => a + b, 0)).toBe(20_818_240)

  // Excelに出力：ファイル名に作業手順の名前と「結果」が入り、中身は Excel（.xlsx は zip 形式で、先頭が PK）
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toMatch(/^無題の作業手順_結果_\d{8}-\d{4}\.xlsx$/)
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 2).toString()).toBe('PK')
  await expect(page.getByRole('status').filter({ hasText: 'を保存しました' })).toBeVisible()
  // 上部の「Excelに出力」も、結果の画面では使える
  await expect(page.getByRole('banner').getByRole('button', { name: 'Excelに出力' })).toBeEnabled()

  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await expect(card(page, 7)).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Excelに出力' })).toBeDisabled()
})

test('マスタに重複があると、照合のステップで止まり、理由と直し方を示す（結果は出力できない）', async ({ page }) => {
  test.setTimeout(120_000)
  await buildMonthlySales(page, '商品マスタ_重複あり.xlsx')

  // 後ろのステップのテスト実行：止まったステップへ案内する
  await card(page, 6).getByRole('heading').click()
  await panel(page, 6).getByRole('tab', { name: '処理前後のデータ' }).click()
  await panel(page, 6).getByRole('button', { name: 'このステップまで実行して確かめる' }).click()
  await expect(panel(page, 6)).toContainText('ステップ4「別の表から情報を付け加える」で問題が見つかったため', { timeout: 20_000 })
  await panel(page, 6).getByRole('button', { name: 'ステップ4を開いて確かめる' }).click()
  await expect(panel(page, 4)).toBeVisible()

  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  const head = page.getByRole('region', { name: '実行の結論' })
  await expect(head).toContainText('ステップ4「別の表から情報を付け加える」で止まりました', { timeout: 30_000 })
  await expect(head).toContainText('結果は出力できません')
  const steps = page.getByRole('region', { name: 'ステップごとの結果' })
  await expect(steps.locator(':scope > ol > li').nth(3)).toContainText('エラー')
  await expect(steps.locator(':scope > ol > li').nth(3)).toContainText('直し方：')
  await expect(steps.locator(':scope > ol > li').nth(4)).toContainText('実行していない')
  // 調査用に、確認結果だけを出力できる
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '確認結果をExcelに出力する（調査用）' }).click()])
  expect(download.suggestedFilename()).toContain('確認結果（調査用）')

  // 内部の名前（in2 など）や専門用語を見せない
  const texts = (await page.locator('body').innerText()).split(/\r?\n/)
  expect(texts.filter((t) => BANNED.test(t) || /(^|[^A-Za-z])in[0-9]+([^0-9]|$)/.test(t))).toEqual([])
})
