import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/*
 * M1-1：デモ（正常終了／品質異常）を TOP から始めて、実際の処理と判定を確かめる。
 * 判定はサーバーの実際の評価から出る（デモのための作り込みはしない）。デモ用の架空データ。
 */

const conclusion = (page: Page) => page.getByRole('region', { name: '実行の結論' })
const verdictBox = (page: Page) => conclusion(page).getByRole('status', { name: '総合判定' })
const banner = (page: Page) => page.getByRole('note', { name: 'デモの案内' })

async function run(page: Page) {
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toBeVisible({ timeout: 30_000 })
}

test('TOP から品質異常のデモを始めると、期間外の伝票を見つけて正式な出力を止める', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  const card = page.getByRole('article', { name: '月次売上集計デモ' })
  await card.getByRole('link', { name: '月次売上集計デモ：異常デモを実行' }).click()
  await expect(page).toHaveURL(/\/build\?demo=monthly_sales&pattern=ng/)

  // デモの案内と、読み込まれた作業手順（完了基準つき）・実行時に指定する値
  await expect(banner(page)).toContainText('デモ：月次売上集計デモ（品質異常）')
  await expect(banner(page)).toContainText('10月分のファイルに、11月の伝票が混ざっています。')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('tab', { name: /完了基準 4/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '実行時に指定する値：対象月' })).toHaveValue('2026-10')

  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：重大')
  await expect(conclusion(page)).toContainText('処理・検証：完了')
  await expect(conclusion(page).getByLabel('正式な出力')).toContainText('停止')
  const first = page.getByRole('region', { name: '完了基準の判定' }).getByRole('listitem').first()
  await expect(first).toHaveAttribute('aria-label', '完了基準：対象月の伝票だけ')
  await expect(first).toContainText('満たしていない（重大）')
  await expect(first).toContainText('期間外の件数3')
  // デモの作業手順は、利用者が保存したものではない（「保存済み」と表示しない）
  await expect(conclusion(page)).not.toContainText('この作業手順は保存済みです')
  await expect(conclusion(page).getByRole('button', { name: 'この作業手順を保存する' })).toBeVisible()
  // 調査用の確認結果は出力できる
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: '確認結果をExcelに出力する（調査用）' }).click()])
  expect(download.suggestedFilename()).toContain('確認結果（調査用）')
})

test('案内の帯から正常終了のデモに切り替えると、正常と判定され、結果を出力できる', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/build?demo=monthly_sales&pattern=ng')
  await expect(banner(page)).toContainText('品質異常')
  await banner(page).getByRole('link', { name: '正常終了のデモに切り替える' }).click()
  await expect(banner(page)).toContainText('デモ：月次売上集計デモ（正常終了）', { timeout: 20_000 })
  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  await expect(verdictBox(page)).toContainText('完了基準（4件）をすべて満たしています。')
  // 分析レポート（AIを使わない計算）：主要数値・部署別のランキングと構成比。前回がなくても分析は成立する
  await expect(page.getByRole('region', { name: '今回の主要数値' })).toContainText('20,818,240')
  const chart = page.getByRole('region', { name: 'データの分析' }).getByRole('figure', { name: '「部署名」別の「売上合計」' })
  await expect(chart).toContainText('EC事業部')
  await expect(chart).toContainText('6,112,900（29.4%）')
  await expect(page.getByRole('region', { name: '前回との比較' })).toContainText('比較できる前月（2026年9月）の正式な出力の記録がありません。今回のデータの分析は確認できます。')
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
  // デモのファイルは入れ替わり、増え続けない
  const sessionId = await page.evaluate(() => sessionStorage.getItem('flowcraft.session'))
  expect(sessionId).toBeTruthy()
  const files = await page.request.get('/api/files', { headers: { 'X-Session-Id': sessionId! } })
  expect(files.ok()).toBe(true)
  expect((await files.json()).length).toBe(3)
})

for (const [title, first, evidence] of [
  ['商品マスタ照合デモ', '完了基準：照合できない商品コードが0件', '原因：相手の表（マスタ）にない値2行'],
  ['在庫差異検出デモ', '完了基準：伝票番号が重複しない', '重複したキー2種類'],
] as const) {
  test(`${title}：品質異常は、案件ごとの原因で重大になる`, async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto('/')
    await page.getByRole('article', { name: title }).getByRole('link', { name: `${title}：異常デモを実行` }).click()
    await expect(banner(page)).toContainText(`デモ：${title}（品質異常）`, { timeout: 20_000 })
    await run(page)
    await expect(verdictBox(page)).toContainText('総合判定：重大')
    const top = page.getByRole('region', { name: '完了基準の判定' }).getByRole('listitem').first()
    await expect(top).toHaveAttribute('aria-label', first)
    await expect(top).toContainText(evidence)
  })
}

test('品質異常の後に「直したデータで再実行する」と、自動で実行し、直す前と後を並べて比べる（M1-3）', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/build?demo=product_match&pattern=ng')
  await expect(page.getByRole('article', { name: /^ステップ5：/ })).toBeVisible({ timeout: 20_000 })
  await run(page)
  await expect(verdictBox(page)).toContainText('総合判定：重大')
  const fix = page.getByRole('region', { name: '直して再実行する' })
  await expect(fix).toContainText('商品コードの空白を取り除き')
  await fix.getByRole('button', { name: '直したデータで再実行する' }).click()

  // ボタンを押し直さなくても、直したデータで実行され、比較が出る
  const compare = page.getByRole('region', { name: '直す前と後の比較' })
  await expect(compare).toBeVisible({ timeout: 30_000 })
  await expect(verdictBox(page)).toContainText('総合判定：正常')
  const rows = compare.locator('tbody tr')
  await expect(rows.nth(0)).toContainText('総合判定重大正常改善')
  await expect(rows.nth(1)).toContainText('正式な出力停止出力できる改善')
  await expect(rows.filter({ hasText: '照合できない商品コードが0件' })).toContainText('満たしていない（未照合 6行）満たしている（未照合 0行）改善')
  await expect(rows.filter({ hasText: '集計前後の売上金額が一致' })).toContainText('変わらない')
  await expect(banner(page)).toContainText('直したデータで再実行')
  // 直した後は「直して再実行する」を出さない。正式な結果を出力できる
  await expect(page.getByRole('region', { name: '直して再実行する' })).toHaveCount(0)
  await expect(conclusion(page).getByRole('button', { name: 'Excelに出力する', exact: true })).toBeEnabled()

  // 自分で実行し直したら、前の比較は消える
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await run(page)
  await expect(page.getByRole('region', { name: '直す前と後の比較' })).toHaveCount(0)
})

/* TOP のデモ：3案件 × 正常・異常 の6パターン。キーボード（Enter・Space）で開始し、正しいデモと判定になる */
for (const [id, title] of [
  ['monthly_sales', '月次売上集計デモ'],
  ['product_match', '商品マスタ照合デモ'],
  ['inventory', '在庫差異検出デモ'],
] as const) {
  for (const [pattern, button, label, verdict, key] of [
    ['ok', '正常デモを実行', '正常終了', '総合判定：正常', 'Enter'],
    ['ng', '異常デモを実行', '品質異常', '総合判定：重大', 'Space'],
  ] as const) {
    test(`TOP：${title}の「${button}」を${key}キーで開始すると、${label}のデモになる`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.goto('/')
      const card = page.getByRole('article', { name: title })
      await expect(card.getByText('体験するパターンを選択')).toBeVisible()
      // 押せる要素は枠全体の1つだけ（ボタンの見た目の中に、別の押せる要素を入れ子にしない）
      const link = card.getByRole('link', { name: `${title}：${button}` })
      await expect(link.locator('a, button')).toHaveCount(0)
      await link.focus()
      await page.keyboard.press(key)
      await expect(page).toHaveURL(new RegExp(`/build[?]demo=${id}&pattern=${pattern}$`))
      await expect(banner(page)).toContainText(`デモ：${title}（${label}）`, { timeout: 20_000 })
      await run(page)
      await expect(verdictBox(page)).toContainText(verdict)
    })
  }
}
