import { expect, test } from '@playwright/test'
import { BANNED } from './helpers'

/*
 * 業務改善診断デモ（デモ①「その集計、本当に必要？」）。
 * Phase 2：STEP 1（現在の7工程・90分〈想定〉）→ STEP 2（改善候補 A〜D と根拠。決まった規則。AIは使っていない）。
 * STEP 3 以降は準備中（押せない）。
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

  // STEP 3 は準備中（押せない・理由を表示）。前のSTEPへ戻れる
  await expect(page.getByRole('button', { name: '次へ進む' })).toBeDisabled()
  await expect(page.getByText('STEP 3（改善する作業の判断）は準備中です')).toBeVisible()
  await page.getByRole('button', { name: '前のSTEPへ戻る' }).click()
  await expect(steps.locator('tbody tr')).toHaveCount(7)
})
