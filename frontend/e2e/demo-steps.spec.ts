import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BANNED } from './helpers'

/*
 * デモ全面改善：デモは「業務を知る」ところから始める5段階。
 *   作業を知る → 手順と改善を確認 → データを確認 → 実行・品質確認（実際の処理エンジン） → 結果を確認
 * STEP 1・2 は事前に用意した説明（架空の業務シナリオ・AIの提案ではない）。STEP 3〜5 は通常の画面と処理を使う。
 */

const current = (page: Page) => page.getByRole('list', { name: '作業の段階' }).locator('[aria-current="step"]')
const verdictBox = (page: Page) => page.getByRole('region', { name: '実行の結論' }).getByRole('status', { name: '総合判定' })

test('月次売上（品質異常）：業務を知る → 改善を確認 → データを確認 → 実際に実行 → 結果と振り返り。戻っても再実行しない', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/build?demo=monthly_sales&pattern=ng')

  // STEP 1：作業を知る
  await expect(current(page)).toContainText('作業を知る')
  await expect(page.getByRole('list', { name: '作業の段階' })).toContainText('手順と改善を確認')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('月次売上の部署別・カテゴリ別集計', { timeout: 20_000 })
  await expect(page.getByText('架空の業務シナリオ（デモ用の架空データ）')).toBeVisible()
  await expect(page.getByRole('region', { name: '今の作業（手作業）' })).toContainText('商品マスタを見ながら、商品名・カテゴリを転記する')
  await expect(page.getByRole('region', { name: '困っていること' })).toContainText('商品コードの照合漏れに気づきにくい')
  await expect(page.getByRole('region', { name: '今回の体験' })).toContainText('品質異常')

  // STEP 2：手順と改善を確認（説明は実際の作業手順の処理ステップ・品質ルールと対応している）
  await page.getByRole('button', { name: '次へ：作業手順を見る' }).click()
  await expect(current(page)).toContainText('手順と改善を確認')
  await expect(page.getByText('事前に用意した改善例です（AIの提案ではありません）')).toBeVisible()
  const compare = page.getByRole('table', { name: '改善前と改善後' })
  await expect(compare.locator('tbody tr')).toHaveCount(4)
  await expect(compare).toContainText('ステップ4「商品マスタの商品名・カテゴリを付け加える」')
  await expect(compare).toContainText('品質ルール「対象月の伝票だけ」')
  const steps = page.getByRole('list', { name: '改善後の処理手順' }).getByRole('listitem').filter({ has: page.locator('p') })
  await expect(steps.first()).toContainText('売上実績・商品マスタ・部署マスタを読み込む')
  await expect(page.getByRole('list', { name: '改善後の処理手順' })).toContainText('ステップ9「Excelに出力する」')

  // STEP 3：データを確認（読み込み済み。作業手順が使う列がそろっていることを確かめる）
  await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
  await expect(current(page)).toContainText('データを確認')
  const files = page.getByRole('list', { name: '使用するファイル' })
  await expect(files.getByRole('listitem')).toHaveCount(3)
  await expect(files).toContainText('デモ_月次売上_期間外あり.xlsx')
  await expect(files).toContainText('商品マスタ.xlsx')
  await expect(files.getByText(/作業手順が使う列（\d+列）はすべてあります/)).toHaveCount(3, { timeout: 20_000 })
  await expect(page.getByText('3ファイル・合計')).toBeVisible()
  // 中身（先頭の行）
  await files.getByRole('button', { name: /^商品マスタ：/ }).click()
  await expect(page.getByRole('region', { name: '商品マスタの中身' })).toContainText('P-1001')

  // STEP 4：実行・品質確認（実際の処理エンジン）
  await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
  await expect(current(page)).toContainText('実行・品質確認')
  await expect(page.getByRole('article', { name: /^ステップ9：/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '結果を見る（再実行しない）' })).toHaveCount(0) // まだ実行していない
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()

  // STEP 5：結果を確認（品質異常を実際のルールで検出し、正式な出力を止める。改善の振り返り）
  await expect(verdictBox(page)).toContainText('総合判定：重大', { timeout: 30_000 })
  await expect(current(page)).toContainText('結果を確認')
  await expect(page.getByRole('region', { name: '実行の結論' }).getByLabel('正式な出力')).toContainText('停止')
  const review = page.getByRole('region', { name: '改善内容の振り返り' })
  await expect(review).toContainText('今回の実行：品質ルール「対象月の伝票だけ」を満たさなかった')
  await expect(review).toContainText('今回の実行：品質ルール「照合できない商品コードが0件」を満たした')
  // 同じ実行の結果か（実行日時で確かめる）
  const ranAt = (await page.getByRole('region', { name: '実行の結論' }).innerText()).match(/実行日時：[^／\n]+/)![0].trim()

  // 前の段階へ戻っても、結果と状態は消えない。再実行せずに結果へ戻れる
  await page.getByRole('button', { name: '作業手順に戻る' }).click()
  await page.getByRole('button', { name: '前へ：データを確認' }).click()
  await page.getByRole('button', { name: '前へ：作業手順を確認' }).click()
  await expect(current(page)).toContainText('手順と改善を確認')
  const states = await page.getByRole('list', { name: '作業の段階' }).getByRole('listitem').evaluateAll((li) => li.map((e) => e.getAttribute('aria-current') ?? (e.querySelector('[aria-label="完了"]') ? 'done' : 'todo')))
  expect(states).toEqual(['done', 'step', 'done', 'done', 'done'])
  await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
  await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
  await page.getByRole('button', { name: '結果を見る（再実行しない）' }).click()
  await expect(page.getByRole('region', { name: '実行の結論' })).toContainText(ranAt)

  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(BANNED)
})

for (const [id, name, files] of [
  ['product_match', '売上データの商品マスタ照合', 2],
  ['inventory', '月末の在庫差異の確認', 2],
] as const) {
  test(`${name}：STEP 1 から始まり、改善例と実際のデータを確かめてから、正常に実行できる`, async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto(`/build?demo=${id}&pattern=ok`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, { timeout: 20_000 })
    await page.getByRole('button', { name: '次へ：作業手順を見る' }).click()
    await expect(page.getByRole('table', { name: '改善前と改善後' }).locator('tbody tr')).toHaveCount(4)
    await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
    await expect(page.getByRole('list', { name: '使用するファイル' }).getByRole('listitem')).toHaveCount(files)
    await expect(page.getByText(/はすべてあります/)).toHaveCount(files, { timeout: 20_000 })
    await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
    await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
    await expect(verdictBox(page)).toContainText('総合判定：正常', { timeout: 30_000 })
    await expect(page.getByRole('region', { name: '改善内容の振り返り' })).toContainText('今回の実行：')
    // 正常なら、実際に作ったExcelを出力できる
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: 'Excelに出力する', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toContain('_結果_')
  })
}

test('デモを始められないとき：HTTP 404 を「通信できない」と一括りにせず原因を示し、もう一度試せる（ダミーの結果に切り替えない）', async ({ page }) => {
  test.setTimeout(90_000)
  // 古い版のサーバー（デモの窓口がない）と同じ応答を返す
  await page.route('**/api/demos/*/start', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Not Found' }) }))
  await page.goto('/build?demo=monthly_sales&pattern=ok')
  const alert = page.getByRole('alert').filter({ hasText: 'デモを始められませんでした' })
  await expect(alert).toContainText('サーバーに、この機能の窓口が見つかりません（HTTP 404）。')
  await expect(alert).toContainText('窓口：/api/demos/monthly_sales/start')
  await expect(alert).not.toContainText('サーバーと通信できませんでした')
  await expect(page.getByRole('heading', { name: '月次売上の部署別・カテゴリ別集計' })).toHaveCount(0)

  // 直ったら、もう一度試す（実際の開始の API で始まる）
  await page.unroute('**/api/demos/*/start')
  await alert.getByRole('button', { name: 'もう一度試す' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('月次売上の部署別・カテゴリ別集計', { timeout: 20_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'デモを始められませんでした' })).toHaveCount(0)
})

test('サーバーが古い版のまま動いているときは、上部に原因と直し方を出す', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', engine_version: '0.1.0', ai_mode: 'fixed' }) }))
  await page.goto('/')
  const notice = page.getByRole('alert', { name: 'サーバーの状態' })
  await expect(notice).toContainText('サーバーが古い版のまま動いています。')
  await expect(notice).toContainText('起動し直してください')
  await page.unroute('**/api/health')
  await notice.getByRole('button', { name: 'もう一度確かめる' }).click()
  await expect(notice).toHaveCount(0)
})
