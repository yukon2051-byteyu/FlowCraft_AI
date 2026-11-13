import { expect, test } from '@playwright/test'
import { BANNED } from './helpers'

/*
 * 業務改善診断デモ（デモ①「その集計、本当に必要？」）。
 * Phase 2：STEP 1（現在の7工程・90分〈想定〉）→ STEP 2（改善候補 A〜D と根拠。決まった規則。AIは使っていない）。
 * Phase 3：STEP 3（採用する／保留する／採用しない。廃止は確認してから。前提の候補。理由）。
 * Phase 4：STEP 4（判断から、改善後の作業の流れと、実行できる作業手順を作る。判断を変えると手順が変わる）。
 * Phase 5：作った作業手順を作業手順の画面で開き、サンプルのExcelで実行・品質の確認・出力・保存。デモに戻れる。STEP 5 は準備中。
 */

test('現在の作業を確認し、改善候補を根拠とともに見る（AIは使っていない）', async ({ page }) => {
  await page.goto('/kaizen-demo')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('毎月90分のExcel作業。何に時間がかかっている？')
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
  await page.getByRole('button', { name: 'すぐに実施できる' }).click()
  await expect(page.getByRole('textbox', { name: /判断の理由/ }).first()).toHaveValue('すぐに実施できる')
  // 後から「要件がある」に変えると、採用は取り消される（確認なしに採用されない）
  await q.getByRole('radio', { name: '要件がある' }).check()
  await expect(decision('A').getByRole('radio', { name: '採用する' })).not.toBeChecked()
  await decision('A').getByText('採用しない').click()
  await page.getByRole('button', { name: '業務上の要件がある' }).click()

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
  const [download] = await Promise.all([page.waitForEvent('download'), conclusion.getByRole('button', { name: 'Excelに出力する', exact: true }).click()])
  expect(download.suggestedFilename()).toContain('_結果_')

  // 保存（通常の作業手順と同じ。新しい作業手順・版1）
  await page.getByRole('banner').getByRole('button', { name: '作業手順を保存' }).click()
  const dialog = page.getByRole('dialog', { name: '作業手順を保存' })
  await expect(dialog).toContainText('初めての保存です。版1として保存します。')
  await expect(dialog.getByRole('textbox', { name: '作業手順の名前' })).toHaveValue('月次報告資料の作成（改善後）')
  await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '保存する' }).click()])
  await expect(dialog.getByRole('status')).toContainText('版1として保存しました')
  await dialog.getByRole('button', { name: '閉じる' }).first().click()

  // デモの実行の記録は、通常の履歴に入らない
  await page.getByRole('banner').getByRole('button', { name: '実行の履歴' }).click()
  const history = page.getByRole('dialog', { name: '実行の履歴' })
  await expect(history).toContainText('記録はまだありません')
  await history.getByRole('button', { name: '閉じる' }).first().click()
  await expect(history).toHaveCount(0)

  // 業務改善デモに戻る：判断と改善後の手順が残っている
  await banner.getByRole('link', { name: '業務改善デモに戻る' }).click()
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
