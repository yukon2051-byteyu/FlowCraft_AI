import { expect, test } from '@playwright/test'
import { BANNED, exportFromOutput } from './helpers'

/*
 * 業務改善診断デモ（デモ①「その集計、本当に必要？」）。
 * Phase 2：STEP 1（現在の7工程・90分〈想定〉）→ STEP 2（改善候補 A〜D と根拠。決まった規則。AIは使っていない）。
 * Phase 3：STEP 3（採用する／保留する／採用しない。廃止は確認してから。前提の候補。理由）。
 * Phase 4：STEP 4（判断から、改善後の作業の流れと、実行できる作業手順を作る。判断を変えると手順が変わる）。
 * Phase 5：作った作業手順を作業手順の画面で開き、サンプルのExcelで実行・品質の確認・出力・保存。デモに戻れる。
 * Phase 6：STEP 5（改善前後の比較。値は作った手順から数える。作業時間は想定。実行した結果を並べる）。
 */

test('現在の作業を確認し、改善候補を根拠とともに見る（AIは使っていない）', async ({ page }) => {
  await page.goto('/kaizen-demo')
  // 全件実行の最初に開く画面は、開発サーバーの準備で時間がかかるため長めに待つ
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分のExcel作業。何に時間がかかっている？', { timeout: 20_000 })
  const progress = page.getByRole('list', { name: 'デモの進み具合' })
  await expect(progress.locator('[aria-current="step"]')).toContainText('現在の作業を確認')

  // STEP 1：7工程・合計90分（想定）。各工程の6項目
  const steps = page.getByRole('table', { name: '現在の作業の工程' })
  await expect(steps.locator('tbody tr')).toHaveCount(7)
  await expect(page.getByText('7工程・合計')).toContainText('90分（想定）')
  await expect(steps.locator('tbody tr').nth(4)).toContainText('同じ集計結果を会議用資料に転記する')
  await expect(steps.locator('tbody tr').nth(4)).toContainText('会議用報告資料')
  await expect(steps.locator('tbody tr').nth(5)).toContainText('元データとの合計一致（必ず残す）')
  await expect(page.getByText('実際に測った時間ではありません')).toBeVisible()
  // 業務の背景（入力済み）と、受け取るExcel（実際の列名）
  await expect(page.getByRole('region', { name: /業務の背景/ })).toContainText('会議用資料への個別転記')
  await expect(page.getByRole('region', { name: /受け取るExcel/ })).toContainText('日付／伝票No／商品コード／数量／単価／金額')

  // STEP 2：改善候補
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('自動化する前に、見直せる作業があります。')
  await expect(page.getByText('決まった規則による検出（AIは使っていません）')).toBeVisible()
  const cands = page.getByRole('list', { name: '改善候補' }).getByRole('article')
  await expect(cands).toHaveCount(4)
  const a = page.getByRole('article', { name: '候補A：会議用資料への重複転記を廃止' })
  await expect(a).toContainText('改善候補・廃止')
  await expect(a).toContainText('工程3「部署別の売上を個別に集計する」の結果を、工程4・工程5で書き写しています。')
  await expect(a).toContainText('採用する前に確認が必要です：会議用資料への転記は、独立した承認・監査・報告上の要件がありますか？')
  await expect(a.getByLabel('判断の状態：未判断')).toBeVisible()
  await expect(page.getByRole('article', { name: '候補B：部署別の個別集計を簡素化' })).toContainText('前提になる候補：候補C')
  await expect(page.getByRole('article', { name: '候補C：集計方法を標準化' })).toContainText('営業2部「金額」')
  const d = page.getByRole('article', { name: '候補D：残った集計を自動化' })
  await expect(d).toContainText('未対応：会議用資料（スライド・文書）の作成には対応していません')
  await expect(page.getByRole('region', { name: '見直しの対象にしない工程' })).toContainText('工程6「集計結果と元データの合計を照合する」')
  // AIの診断として表示していない
  await expect(page.getByText(/AIが診断|AIの診断結果|AIによる診断/)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0) // パスワードを求めない
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(BANNED)

  // 前のSTEPへ戻れる
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await expect(steps.locator('tbody tr')).toHaveCount(7)
})

test('改善する作業を判断する：廃止は確認してから、前提の候補、理由。判断は後から確かめられ、やり直せる', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('改善する作業を選んでください。')
  const summary = page.getByRole('region', { name: '判断の集計' })
  await expect(summary).toContainText('未判断：4件')
  await expect(summary).toContainText('まだ判断していない候補があります（候補A・B・C・D）')
  await expect(page.getByRole('button', { name: '次へ進む：改善後の手順を作る' })).toBeDisabled()

  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  // 廃止（候補A）：確認の前は採用できない
  await expect(decision('A').getByRole('radio', { name: '採用する' })).toBeDisabled()
  await expect(decision('A')).toContainText('採用するには：確認の問いに「要件はない」と答えたときだけ採用できます')
  const q = page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ })
  await q.getByRole('radio', { name: '分からない' }).check()
  await expect(page.getByText('「保留する」を選び、関係者に確かめてから判断してください')).toBeVisible()
  await expect(decision('A').getByRole('radio', { name: '採用する' })).toBeDisabled()
  await q.getByRole('radio', { name: /要件はない/ }).check()
  await decision('A').getByText('採用する').click()
  await expect(decision('A').getByRole('radio', { name: '採用する' })).toBeChecked()
  // 理由は選択肢から選べる
  await page.locator('#kz-card-A').getByRole('button', { name: '作業時間を削減できる' }).click()
  await expect(page.locator('#kz-card-A').getByRole('textbox', { name: '採用する理由（自由入力）' })).toHaveValue('作業時間を削減できる')
  // 後から「要件がある」に変えると、採用は取り消される（確認なしに採用されない）
  await q.getByRole('radio', { name: '要件がある' }).check()
  await expect(decision('A').getByRole('radio', { name: '採用する' })).not.toBeChecked()
  await decision('A').getByText('採用しない').click()
  await page.locator('#kz-card-A').getByRole('button', { name: '業務上の要件がある' }).click()

  // 簡素化（候補B）は、前提の候補C を採用するまで採用できない
  await expect(decision('B').getByRole('radio', { name: '採用する' })).toBeDisabled()
  await expect(decision('B')).toContainText('前提の候補Cを採用すると選べます')
  await decision('C').getByText('採用する').click()
  await decision('B').getByText('採用する').click()
  await decision('D').getByText('採用する').click()
  await expect(summary).toContainText('採用：3件')
  await expect(summary).toContainText('採用しない：1件')
  await expect(summary).not.toContainText('まだ判断していない')

  // 前提を後から外すと、矛盾として知らせる（判断は勝手に書き換えない）
  await decision('C').getByText('保留する').click()
  await expect(decision('B').getByRole('radio', { name: '採用する' })).toBeChecked()
  await expect(summary).toContainText('候補B：前提の候補Cを採用すると選べます（判断を見直してください）')
  await decision('C').getByText('採用する').click()
  await expect(summary).not.toContainText('判断を見直してください')
  await expect(page.getByRole('button', { name: '次へ進む：改善後の手順を作る' })).toBeEnabled()

  // STEP 2 に戻ると、判断の状態が見える
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await expect(page.getByRole('article', { name: /^候補A：/ }).getByLabel('判断の状態：採用しない')).toBeVisible()
  await expect(page.getByRole('article', { name: /^候補D：/ }).getByLabel('判断の状態：採用')).toBeVisible()

  // 最初からやり直すと、判断は残らない
  await page.getByRole('button', { name: '最初からやり直す' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await expect(page.getByRole('article', { name: /^候補A：/ }).getByLabel('判断の状態：未判断')).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(BANNED)
})

test('改善後の手順：判断を変えると、実際の処理ステップと工程が変わる。合計の一致は必ず残る', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  // A 採用しない／B 採用しない／C 採用／D 採用
  await decision('A').getByText('採用しない').click()
  await decision('B').getByText('採用しない').click()
  await decision('C').getByText('採用する').click()
  await decision('D').getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('必要な作業だけを残して、手順を作り直しました。')

  const after = page.getByRole('list', { name: '改善後の工程' }).getByRole('listitem')
  const nodes = page.getByRole('list', { name: '処理ステップ' }).getByRole('listitem')
  const rules = page.getByRole('list', { name: '完了基準' })
  await expect(after.filter({ hasText: '同じ集計結果を会議用資料に転記する' })).toContainText('手作業のまま')
  await expect(page.getByText('7工程・90分 →')).toContainText('7工程・35分')
  await expect(nodes.filter({ hasText: '営業2部の列名を共通の列名にそろえる（日付→売上日・伝票No→伝票番号・金額→売上金額）' })).toHaveCount(1)
  await expect(nodes.filter({ hasText: /^.*の売上を集計する$/ })).toHaveCount(3) // 部署ごとに集計
  await expect(nodes.filter({ hasText: 'まとめる' })).toHaveCount(0)
  await expect(rules).toContainText('営業2部：集計前後の売上金額が一致')
  await expect(page.getByText('候補A（採用しない）：工程5は手作業のまま残しました')).toBeVisible()
  await expect(page.getByText('未対応：工程5「同じ集計結果を会議用資料に転記する」')).toBeVisible()

  // 判断を変える：A・B も採用 → 転記の工程がなくなり、3部署を1つの表にまとめて1回で集計する
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ }).getByRole('radio', { name: /要件はない/ }).check()
  await decision('A').getByText('採用する').click()
  await decision('B').getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await expect(page.getByText('7工程・90分 →')).toContainText('5工程・20分')
  await expect(after).toHaveCount(5)
  await expect(after.filter({ hasText: '会議用資料' })).toHaveCount(0)
  await expect(nodes.filter({ hasText: '3部署の売上を1つの表にまとめる' })).toHaveCount(1)
  await expect(nodes.filter({ hasText: '部署別に売上を集計する' })).toHaveCount(1)
  await expect(rules).toContainText('集計前後の売上金額が一致')
  await expect(rules).toContainText('満たさないとき：重大（出力を止める）')
  await expect(page.getByRole('region', { name: '引き継ぐ品質の確認' })).toContainText('元データとの合計一致（必ず残す）')
  await expect(page.getByText('月次報告資料の作成（改善後）')).toBeVisible()
  await expect(page.getByText('所要時間はすべて想定値です（実測ではありません）')).toBeVisible()

  // 自動化を採用しないと、作業手順は作らない
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await decision('D').getByText('採用しない').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await expect(page.getByText('実行できる作業手順はありません', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'この作業手順を開いて、サンプルのExcelで実行する' })).toHaveCount(0)
  await expect(page.getByText(/実行できる作業手順は作りません/)).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(BANNED)
})

test('作った作業手順を開き、サンプルのExcelで実行・品質の確認・出力・保存する。デモに戻ると判断が残っている', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  await page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ }).getByRole('radio', { name: /要件はない/ }).check()
  for (const id of ['A', 'C', 'B', 'D']) await decision(id).getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await page.getByRole('button', { name: 'この作業手順を開いて、サンプルのExcelで実行する' }).click()

  // 通常の作業手順の画面で開く（処理ステップ8つ。部署のExcelは割当済み）
  await expect(page).toHaveURL(/[/]build[?]kaizen=monthly_report/)
  const banner = page.getByRole('note', { name: '業務改善デモの案内' })
  await expect(banner).toContainText('採用した改善案から作った作業手順です', { timeout: 20_000 })
  await expect(page.getByRole('article', { name: /^ステップ8：/ })).toBeVisible()
  await expect(page.getByRole('article', { name: /^ステップ6：/ })).toContainText('3部署の売上を1つの表にまとめる')

  // 実行 → 既存の品質の確認・結果のレポート
  await page.getByRole('button', { name: '作業手順全体を実行する' }).click()
  const conclusion = page.getByRole('region', { name: '実行の結論' })
  await expect(conclusion.getByRole('status', { name: '総合判定' })).toContainText('総合判定：正常', { timeout: 30_000 })
  await expect(conclusion.getByRole('status', { name: '総合判定' })).toContainText('完了基準（8件）をすべて満たしています。')
  await expect(page.getByRole('region', { name: '今回の主要数値' })).toContainText('9,287,200')
  const chart = page.getByRole('region', { name: 'データの分析' }).getByRole('figure', { name: '「部署」別の「売上合計」' })
  await expect(chart).toContainText('営業1部')
  // Excel出力
  const download = await exportFromOutput(page)
  expect(download.suggestedFilename()).toContain('_結果_')

  // デモ中は、上部に履歴・開く・保存のメニューを出さない（デモの手順と、保存した手順を混同させない）
  for (const name of ['実行の履歴', '作業手順を開く', '作業手順を保存']) await expect(page.getByRole('banner').getByRole('button', { name })).toHaveCount(0)
  // 保存は、出力・保存の画面（STEP 5）から（通常の作業手順と同じ。新しい作業手順・版1）
  await page.getByRole('region', { name: '作業手順の保存' }).getByRole('button', { name: 'この作業手順を保存する' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await expect(dialog).toContainText('初めての保存です。版1として保存します。')
  await expect(dialog.getByRole('textbox', { name: '作業手順の名前' })).toHaveValue('月次報告資料の作成（改善後）')
  await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  await expect(dialog.getByRole('status')).toContainText('版1として保存しました')
  await dialog.getByRole('button', { name: '閉じる' }).first().click()


  // 業務改善デモに戻る：STEP 5（改善前後の比較）で、実際に実行した結果を見せる。判断と改善後の手順も残っている
  await banner.getByRole('link', { name: '業務改善デモに戻る' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('作業を減らして、必要な確認は残す。')
  const actual = page.getByRole('region', { name: '自動化した作業手順の実行結果' })
  await expect(actual).toContainText('サンプルのExcelで実行した結果：総合判定 正常')
  await expect(actual).toContainText('完了基準 8件のうち 8件を満たしました。正式な出力：できる')
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('必要な作業だけを残して、手順を作り直しました。')
  await expect(page.getByText('7工程・90分 →')).toContainText('5工程・20分')
  // ふつうに開き直すと、初期状態から（前の判断は残らない）
  await page.goto('/kaizen-demo')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
  await page.goto('/kaizen-demo?resume=1')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
})

test('受け渡した作業手順がないまま開くと、理由と直し方を示す', async ({ page }) => {
  await page.goto('/build?kaizen=monthly_report')
  await expect(page.getByRole('alert')).toContainText('改善後の作業手順が見つかりません。')
  await expect(page.getByRole('alert')).toContainText('業務改善デモの「改善後の手順を作成」から、もう一度開いてください。')
})

test('STEP 5 改善前後の比較：作った手順から数えた比較。作業時間は想定と明記。廃止を採用しないと重複転記が残る', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  await decision('A').getByText('採用しない').click()
  for (const id of ['C', 'B', 'D']) await decision(id).getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await page.getByRole('button', { name: '次へ：改善前後を比較' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('作業を減らして、必要な確認は残す。')
  await expect(page.getByRole('list', { name: 'デモの進み具合' })).not.toContainText('準備中')

  const table = page.getByRole('table', { name: '改善前後の比較' })
  const row = (item: string) => table.getByRole('row', { name: new RegExp(`^${item}`) })
  // 廃止を採用しないので、転記と共有が別の手作業として残り、工程数は減らない（作業時間は減る）
  await expect(row('工程数')).toHaveText('工程数7工程7工程')
  await expect(row('重複転記')).toContainText('あり（1か所）')
  await expect(row('作業時間')).toContainText('想定')
  await expect(row('作業時間')).toContainText('毎月90分')
  await expect(row('作業時間')).toContainText('毎月35分')
  await expect(row('作業時間')).toContainText('実測ではありません')
  await expect(row('元データとの合計照合')).toContainText('自動の検証')
  await expect(row('実行できる処理ステップ')).toContainText('8ステップ') // 廃止は手作業の工程だけを変え、処理ステップは変えない
  // まだ実行していない：実行を勧める（結果を作り込んで見せない）
  await expect(page.getByRole('region', { name: '自動化した作業手順の実行結果' })).toContainText('作業手順として実際に動かせます')
  await expect(page.getByRole('region', { name: '自動化した作業手順の実行結果' })).not.toContainText('総合判定')
  await expect(page.getByRole('button', { name: 'この作業手順を開いて、サンプルのExcelで実行する' })).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(BANNED)
})

test('確認の問いに「要件はない」と答えただけでは判断にならない：どの候補が足りないかを示し、その候補へ移動できる', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  // 利用者の画面と同じ状態：A は確認の問いだけに答え、B・C・D は判断済み
  await page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ }).getByRole('radio', { name: /要件はない/ }).check()
  await decision('C').getByText('採用する').click()
  await decision('B').getByText('採用する').click()
  await decision('D').getByText('採用しない').click()

  const next = page.getByRole('button', { name: '次へ進む：改善後の手順を作る' })
  await expect(next).toBeDisabled()
  // ボタンの横で、足りない候補を具体的に示す
  await expect(page.getByRole('status').filter({ hasText: '候補Aの判断（採用する・保留する・採用しない）を選ぶと、次へ進めます' })).toBeVisible()
  // 候補Aのカードでも、まだ判断していないことを示す（ほかの候補には出さない）
  await expect(page.locator('#kz-card-A')).toContainText('まだ判断していません。3つから選んでください')
  await expect(page.locator('#kz-card-B')).not.toContainText('まだ判断していません')
  // 候補Aへ移動できる
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
  await page.getByRole('button', { name: '候補Aへ移動' }).click()
  await expect(page.locator('#kz-card-A')).toBeInViewport()
  // 判断を選べば進める
  await decision('A').getByText('採用する').click()
  await expect(next).toBeEnabled()
  await expect(page.getByRole('button', { name: '候補Aへ移動' })).toHaveCount(0)
})

test('STEP 5 の終わり方：自動化しなくても成果を伝える。TOPに戻る（主）・前のSTEPへ（副）・最初からやり直す（補助）', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const decision = (id: string) => page.getByRole('radiogroup', { name: `候補${id}の判断` })
  await page.getByRole('radiogroup', { name: /確認：会議用資料への転記は/ }).getByRole('radio', { name: /要件はない/ }).check()
  for (const id of ['A', 'C', 'B']) await decision(id).getByText('採用する').click()
  await decision('D').getByText('採用しない').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await page.getByRole('button', { name: '次へ：改善前後を比較' }).click()

  // 改善後の作業の進め方：実際の改善の結果から作った成果（比較表と食い違わない）
  const outcome = page.getByRole('region', { name: '改善後の作業の進め方' })
  await expect(outcome).toContainText('必要な作業を残し、手順を整理しました')
  await expect(outcome).toContainText('7工程から6工程に整理し、重複していた転記作業をなくしました。元データとの合計照合など、必要な確認作業は引き続き人が実施します。')
  const sum = page.getByRole('list', { name: '成果のまとめ' }).or(outcome.locator('dl'))
  await expect(sum).toContainText('7工程 → 6工程')
  await expect(sum).toContainText('同じ集計結果を会議用資料に転記する')
  await expect(sum).toContainText('今回は採用しない')
  await expect(sum).toContainText('毎月90分 → 49分')
  await expect(sum).toContainText('実測ではありません')
  await expect(page.getByRole('table', { name: '改善前後の比較' }).getByRole('row', { name: /^工程数/ })).toHaveText('工程数7工程6工程')
  // 自動化しないことを、失敗のように見せない
  await expect(outcome).toContainText('今回は、自動化よりも作業の整理を優先しました。')
  await expect(page.getByText('実行できる作業手順はありません')).toHaveCount(0)
  await expect(page.getByText('サンプルのExcelで実行した結果')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /作業手順を開いて/ })).toHaveCount(0)

  // 前のSTEPへ戻る：選択は残る
  const end = page.getByRole('navigation', { name: 'デモの終了' })
  await end.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('必要な作業だけを残して、手順を作り直しました。')
  await page.getByRole('button', { name: '次へ：改善前後を比較' }).click()

  // 最初からやり直す：STEP 1 から（TOPには移らない）
  await end.getByRole('button', { name: '最初からやり直す' }).click()
  await expect(page).toHaveURL(/[/]kaizen-demo/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await expect(page.getByRole('region', { name: '判断の集計' })).toContainText('未判断：4件')

  // TOPページに戻る：もう一度デモを始めると STEP 1 から（前の STEP 5 を出さない）
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await page.getByRole('radiogroup', { name: /確認：/ }).getByRole('radio', { name: /要件はない/ }).check()
  for (const id of ['A', 'C', 'B', 'D']) await decision(id).getByText('採用する').click()
  await page.getByRole('button', { name: '次へ進む：改善後の手順を作る' }).click()
  await page.getByRole('button', { name: '次へ：改善前後を比較' }).click()
  await page.getByRole('navigation', { name: 'デモの終了' }).getByRole('button', { name: 'TOPページに戻る' }).click()
  await expect(page).toHaveURL(/localhost:\d+[/]$/)
  await page.locator('#demo').getByRole('link', { name: '業務改善デモを体験する' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
  await page.goto('/kaizen-demo?resume=1')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分')
})

test('判断の理由：候補は押せるボタン。選ぶと入力欄に入り、編集でき、判断ごとに保たれる。キーボードでも選べる', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await page.getByRole('button', { name: 'この作業を改善診断する' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  const card = page.locator('#kz-card-D')
  await card.getByText('採用しない').click()
  // 判断に合わせた見出しと説明、候補3つ（押せるボタン）
  await expect(card).toContainText('採用しない理由任意・100文字まで')
  await expect(card).toContainText('当てはまる理由を選ぶか、自由に入力してください。')
  const group = card.getByRole('group', { name: '採用しない理由の候補' })
  await expect(group.getByRole('button')).toHaveCount(3)
  const input = card.getByRole('textbox', { name: '採用しない理由（自由入力）' })
  // 選ぶと入力欄へ。選択の印が付く
  await group.getByRole('button', { name: '効果が小さい' }).click()
  await expect(input).toHaveValue('効果が小さい')
  await expect(group.getByRole('button', { name: '効果が小さい' })).toHaveAttribute('aria-pressed', 'true')
  // 別の候補に切り替え（単一選択）
  await group.getByRole('button', { name: '別の方法で対応する' }).click()
  await expect(input).toHaveValue('別の方法で対応する')
  await expect(group.getByRole('button', { name: '効果が小さい' })).toHaveAttribute('aria-pressed', 'false')
  // 同じ候補をもう一度押すと解除
  await group.getByRole('button', { name: '別の方法で対応する' }).click()
  await expect(input).toHaveValue('')
  // 自由に編集すると、候補の選択は外れる。書き換えた文章は、確かめずに上書きしない（キャンセルなら残る）
  await input.fill('効果が小さい。来期に再検討')
  await expect(group.getByRole('button', { name: '効果が小さい' })).toHaveAttribute('aria-pressed', 'false')
  page.once('dialog', (d) => void d.dismiss())
  await group.getByRole('button', { name: '業務上の要件がある' }).click()
  await expect(input).toHaveValue('効果が小さい。来期に再検討')
  // 100文字まで
  await input.fill('あ'.repeat(120))
  await expect(input).toHaveValue('あ'.repeat(100))
  await input.fill('効果が小さい。来期に再検討')
  // 判断を切り替えると候補も切り替わり、理由は判断ごとに保たれる
  await card.getByText('採用する').first().click()
  await expect(card.getByRole('group', { name: '採用する理由の候補' })).toContainText('作業時間を削減できる')
  await expect(card.getByRole('textbox', { name: '採用する理由（自由入力）' })).toHaveValue('')
  await card.getByText('保留する').click()
  await expect(card.getByRole('group', { name: '保留する理由の候補' })).toContainText('効果を検証したい')
  await card.getByText('採用しない').click()
  await expect(input).toHaveValue('効果が小さい。来期に再検討')
  // キーボードでも選べる
  await input.fill('')
  await group.getByRole('button', { name: '効果が小さい' }).focus()
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue('効果が小さい')
  // STEP を戻っても、判断と理由は残る
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await page.getByRole('button', { name: '次へ進む：改善する作業を選ぶ' }).click()
  await expect(page.locator('#kz-card-D').getByRole('textbox', { name: '採用しない理由（自由入力）' })).toHaveValue('効果が小さい')
})
