import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BANNED, demo, throughDemoSteps } from './helpers'

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
  // このデモで体験できること：品質異常のデモでは、正式な出力が止まるところまで（正常のデモとは書き分ける）
  const exp = page.getByRole('region', { name: 'このデモで体験できること' })
  await expect(exp).toContainText('品質ルールが混入を見つけて、正式な出力を止めるところまで確かめます')
  await expect(exp).toContainText('今回のデータ（品質異常）：10月分のファイルに、11月の伝票が混ざっています。')
  // デモ名も示す（何のデモか）
  await expect(page.locator('header').filter({ hasText: '月次売上集計デモ' }).first()).toBeVisible()

  // STEP 2：手順と改善を確認（説明は実際の作業手順の処理ステップ・品質ルールと対応している）
  await page.getByRole('button', { name: '次へ：作業手順と改善案を見る' }).click()
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
  // 先頭に、実際の判定結果を使った「正式出力停止」の見出し
  await expect(page.getByRole('alert', { name: '正式出力停止' }).getByRole('heading')).toHaveText('対象期間外3件・正式出力停止')
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

  // 「調査用プレビュー（正式出力停止中）」は、レビュー指摘（2026-11-17）で明示された見出しなので例外とする（docs/ui-terminology.md の言い換えより優先）
  const text = (await page.locator('body').innerText()).replace('調査用プレビュー（正式出力停止中）', '')
  expect(text).not.toMatch(BANNED)
})

for (const [id, name, files, dimension] of [
  ['product_match', '売上データの商品マスタ照合', 2, 'カテゴリ'],
  ['inventory', '月末の在庫差異の確認', 2, '商品コード'],
] as const) {
  test(`${name}：STEP 1 から始まり、改善例と実際のデータを確かめてから、正常に実行できる`, async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto(`/build?demo=${id}&pattern=ok`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, { timeout: 20_000 })
    await page.getByRole('button', { name: '次へ：作業手順と改善案を見る' }).click()
    await expect(page.getByRole('table', { name: '改善前と改善後' }).locator('tbody tr')).toHaveCount(4)
    await page.getByRole('button', { name: '次へ：使用するデータを見る' }).click()
    await expect(page.getByRole('list', { name: '使用するファイル' }).getByRole('listitem')).toHaveCount(files)
    await expect(page.getByText(/はすべてあります/)).toHaveCount(files, { timeout: 20_000 })
    await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
    await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
    await expect(verdictBox(page)).toContainText('総合判定：正常', { timeout: 30_000 })
    await expect(page.getByRole('region', { name: '改善内容の振り返り' })).toContainText('今回の実行：')
    // データの分析（AIを使わない計算）：まとめるステップの分類ごとのグラフが出る（デモごとに分類が違う）
    await expect(page.getByRole('region', { name: 'データの分析' }).getByRole('figure', { name: new RegExp(`^「${dimension}」別の`) }).first()).toBeVisible()
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

test('デモの後に「自分のExcelで試す」で開くと、デモの作業手順とファイルは残らない（自分で読み込んだファイルは残る）', async ({ page }) => {
  test.setTimeout(150_000)
  // 先に自分のファイルを読み込んでおく
  await page.goto('/build?start=file')
  await page.getByTestId('file-input').first().setInputFiles(demo('部署マスタ.csv'))
  await expect(page.getByText('1ファイル')).toBeVisible({ timeout: 20_000 })
  // デモを最後まで動かす
  await page.goto('/build?demo=product_match&pattern=ok')
  await throughDemoSteps(page)
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  await expect(verdictBox(page)).toContainText('総合判定：正常', { timeout: 30_000 })
  // TOP の「自分のExcelで試す」
  await page.goto('/')
  await page.getByRole('main').getByRole('link', { name: '自分のExcelで試す' }).first().click()
  await expect(page.getByRole('banner')).toContainText('無題の作業手順', { timeout: 20_000 })
  await expect(page.getByRole('banner')).not.toContainText('（デモ）')
  await expect(page.getByText('売上実績_2026-10.xlsx')).toHaveCount(0)
  await expect(page.getByText('商品マスタ.xlsx')).toHaveCount(0)
  await expect(page.getByText('部署マスタ.csv').first()).toBeVisible()
  await expect(page.getByRole('note', { name: 'デモの案内' })).toHaveCount(0)
})

test('デモの完了画面：完了のまとめ（処理と品質を分けて）・3桁区切りの表・表の近くの出力・終わりの操作。品質異常では正式な出力をしない', async ({ page }) => {
  test.setTimeout(180_000)
  // 正常データ
  await page.goto('/build?demo=product_match&pattern=ok')
  await throughDemoSteps(page)
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  const summary = page.getByRole('region', { name: '完了のまとめ' })
  await expect(summary).toContainText('商品マスタ照合が完了しました', { timeout: 30_000 })
  await expect(summary).toContainText('品質検証を通過しました。正式なExcelを出力できます。')
  await expect(summary).toContainText('最後まで実行（正常終了）')
  await expect(summary).toContainText('完了基準 3件のうち 3件を満たした')
  await expect(summary).toContainText('照合できない商品コードが0件：満たした')
  await expect(summary).toContainText(/カテゴリ別売上 \d+行/)
  // 案内の帯：どのデータで実行したかを一目で。詳しい説明は折りたたみ（初めは閉じている）
  const banner = page.getByRole('note', { name: 'デモの案内' })
  await expect(banner).toContainText('商品マスタ照合デモ｜正常データで実行')
  await expect(banner.getByText('このデモの確認ポイントを見る')).toBeVisible()
  await expect(banner.locator('details')).not.toHaveAttribute('open', '')
  // 出力する表：金額は3桁区切り・右揃え・単位
  const out = page.getByRole('region', { name: '出力する表' })
  await expect(out.locator('thead')).toContainText('売上合計（円）')
  await expect(out.locator('tbody td').filter({ hasText: /^\d{1,3}(,\d{3})+$/ }).first()).toBeVisible()
  // 表の近くから Excel に出力できる（上の結論の欄と同じ処理）
  const [download] = await Promise.all([page.waitForEvent('download'), out.getByRole('button', { name: 'Excelに出力する' }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')
  // 終わりの操作：左端に別のデモを試す（デモ選択へ）・作業手順に戻る … 右端に TOPページに戻る（主）
  const end = page.getByRole('navigation', { name: 'デモの終了' })
  await expect(end.getByRole('link', { name: 'TOPページに戻る' })).toHaveAttribute('href', '/')
  await expect(end.getByRole('button', { name: '別のデモを試す' })).toBeVisible()
  await end.getByRole('button', { name: '作業手順に戻る' }).click()
  await expect(page.getByRole('button', { name: '結果を見る（再実行しない）' })).toBeVisible()
  await page.getByRole('button', { name: '結果を見る（再実行しない）' }).click()

  // 品質異常のデータに切り替え：重大と正式な出力の停止。表の近くに正式な出力のボタンは出さない
  await banner.getByRole('link', { name: '品質異常のデモに切り替える' }).click()
  await expect(banner).toContainText('商品マスタ照合デモ｜品質異常のデータで実行', { timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：実行・品質確認' }).click()
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  // 先頭は正式な出力の可否（実際の判定結果の数）。完了のまとめでは同じ文を繰り返さない
  await expect(page.getByRole('alert', { name: '正式出力停止' })).toContainText('照合漏れ6行・正式出力停止', { timeout: 30_000 })
  await expect(summary).toContainText('照合できない商品コードが0件：満たしていない')
  await expect(page.getByRole('button', { name: 'Excelに出力する', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '実行の結論' }).getByRole('button', { name: '調査用レポートをExcelに出力' })).toBeVisible()
  await expect(end.getByRole('link', { name: 'TOPページに戻る' })).toBeVisible()
})
