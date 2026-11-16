import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BANNED, confirm, panel } from './helpers'

/*
 * 業務改善診断デモ（デモ①「その集計、本当に必要？」）の受入テスト（指示書 §11 の13項目を、1回の通しの操作で確かめる）。
 * 各操作の前のコメント【n】が、受入条件の番号。デモ②③（#11）は e2e/demo-steps.spec.ts・demo.spec.ts で確かめる。
 * 対応表：docs/kaizen-demo-acceptance.md
 */

// AIを使っていない結果を、AIの診断・提案として見せていないか（#12）
const AI_CLAIM = /AIが(診断|提案|判断|作成)し|AI診断済み|AIの診断結果|AIによる(診断|改善提案)/

async function noAiClaim(page: Page) {
  expect(await page.locator('main').innerText()).not.toMatch(AI_CLAIM)
}

test('受入条件1〜13：現状の確認 → 改善候補 → 判断 → 手順の作成 → 比較 → 実行 → 編集・保存', async ({ page }) => {
  test.setTimeout(240_000)
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  const confirmA = page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ })

  // 【1】デモ①を開始すると、7工程の現状手順が表示される
  await page.goto('/')
  await page.locator('#demo').getByRole('link', { name: '業務改善デモを体験する' }).click()
  await expect(page.getByRole('table', { name: '現在の作業の工程' }).locator('tbody tr')).toHaveCount(7, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
  await noAiClaim(page)

  // 【2】改善候補が根拠とともに表示される
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  const cands = page.getByRole('list', { name: '改善候補' }).getByRole('article')
  await expect(cands).toHaveCount(4)
  for (const c of await cands.all()) await expect(c).toContainText('判断の根拠')
  // 【12】AIを使っていないことを示し、AIの診断として表示しない（パスワードも求めない）
  await expect(page.getByText('決まった規則による検出（AIは使っていません）')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await noAiClaim(page)

  // 【3】採用・保留・採用しないを選べる
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await decision('C').getByText('保留する').click()
  await expect(decision('C').getByRole('radio', { name: '保留する' })).toBeChecked()
  await decision('C').getByText('採用しない').click()
  await expect(decision('C').getByRole('radio', { name: '採用しない' })).toBeChecked()
  // 【4】廃止の候補は、必要性を確かめるまで採用できない（自動で採用されない）
  await expect(decision('A').getByRole('radio', { name: '採用する' })).toBeDisabled()
  await expect(decision('A').getByRole('radio', { name: '採用する' })).not.toBeChecked()

  // 【6】採用しなかった改善案は反映されない（A 廃止・B 簡素化を採用しない）
  await decision('A').getByText('採用しない').click()
  await decision('B').getByText('採用しない').click()
  await decision('C').getByText('採用する').click()
  await decision('D').getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  const after = page.getByRole('list', { name: '改善後の工程' }).getByRole('listitem')
  const nodes = page.getByRole('list', { name: '処理ステップ' }).getByRole('listitem')
  await expect(after.filter({ hasText: '同じ集計結果を会議用資料に転記する' })).toHaveCount(1)
  await expect(nodes.filter({ hasText: 'まとめる' })).toHaveCount(0)
  await expect(nodes.filter({ hasText: /の売上を集計する$/ })).toHaveCount(3)

  // 【5】採用した改善案に応じて、改善後の手順（実際の処理ステップ）が変わる（A・B も採用）
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await confirmA.getByRole('radio', { name: /要件はない/ }).check()
  await decision('A').getByText('採用する').click()
  await decision('B').getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await expect(after).toHaveCount(5)
  await expect(after.filter({ hasText: '会議用資料' })).toHaveCount(0)
  await expect(nodes.filter({ hasText: '3部署の売上を1つの表にまとめる' })).toHaveCount(1)
  await expect(nodes.filter({ hasText: '部署別に売上を集計する' })).toHaveCount(1)
  // 【8】品質検証のルール（合計の一致）が引き継がれる
  await expect(page.getByRole('region', { name: '引き継ぐ品質の確認' })).toContainText('元データとの合計一致（必ず残す）')
  await expect(page.getByRole('list', { name: '完了基準' })).toContainText('集計前後の売上金額が一致')
  await noAiClaim(page)

  // 【10】改善前後の比較が表示される（作業時間は想定と明記）
  await page.getByRole('button', { name: '次へ：改善前後を比較' }).click()
  const table = page.getByRole('table', { name: '改善前後の比較' })
  await expect(table.getByRole('row', { name: /^工程数/ })).toHaveText('工程数7工程5工程')
  await expect(table.getByRole('row', { name: /^作業時間/ })).toContainText('想定')
  await expect(table.getByRole('row', { name: /^重複転記/ })).toContainText('なし')
  await noAiClaim(page)

  // 【7】改善後の手順が、既存の処理エンジンで実行できる 【9】サンプルExcelを処理し、実際の結果を確かめられる
  await page.getByRole('button', { name: 'この作業手順を開いて、サンプルのExcelで実行する' }).click()
  await expect(page.getByRole('note', { name: '業務改善デモの案内' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  const conclusion = page.getByRole('region', { name: '実行の結論' })
  await expect(conclusion.getByRole('status', { name: '総合判定' })).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(page.getByRole('region', { name: '今回の主要数値' })).toContainText('9,287,200')
  await expect(page.getByRole('region', { name: '完了基準の判定' })).toContainText('集計前後の売上金額が一致')

  // 【13】改善後の手順を編集できる（出力するシートの名前を変え、確認済みにして再実行）
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await page.getByRole('article', { name: /^ステップ8：/ }).getByRole('heading', { name: '集計結果をExcelに出力する' }).click()
  await panel(page, 8).getByRole('textbox', { name: 'シート1の名前' }).fill('部署別売上（会議用）')
  await confirm(page, 8)
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(conclusion.getByRole('status', { name: '総合判定' })).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(page.getByRole('tablist', { name: '出力するシート' })).toContainText('部署別売上（会議用）')

  // 【13】改善後の手順を保存できる（新しい作業手順・版1。編集した内容を含む）。デモ中は上部に保存のメニューを出さないので、出力・保存の画面から
  await expect(page.getByRole('banner').getByRole('button', { name: '作業手順を保存' })).toHaveCount(0)
  await page.getByRole('button', { name: '次へ：出力・保存' }).click()
  await page.getByRole('region', { name: '作業手順の保存' }).getByRole('button', { name: 'この作業手順を保存する' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await expect(dialog).toContainText('初めての保存です。版1として保存します。')
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  const saved = JSON.parse(await readFile((await download.path())!, 'utf-8'))
  expect(saved.flow_name).toBe('月次報告資料の作成（改善後）')
  expect(saved.flow_version).toBe(1)
  expect(JSON.stringify(saved.nodes)).toContain('部署別売上（会議用）')
  expect(JSON.stringify(saved)).not.toContain('file_id') // 業務データ（ファイルの割当）は保存しない

  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(BANNED)
})
