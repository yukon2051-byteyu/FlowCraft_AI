import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/*
 * Phase K-1b：自分の業務の見直し（業務の情報と、今の工程の表）。架空の業務を入力する。
 * 「やりたい作業を伝える」の②で「今の工程から見直す」を選んだときだけ開き、入力した内容は画面を移っても残る。
 */

const row = (page: Page, n: number) => page.getByRole('row', { name: `工程${n}`, exact: true })
const field = (page: Page, n: number, what: string) => page.getByRole('textbox', { name: `工程${n}の${what}` })
const pick = (page: Page, n: number, what: string) => page.getByRole('combobox', { name: `工程${n}の${what}` })

async function openReview(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/build?start=work')
  await page.getByRole('textbox', { name: '案件名' }).fill('支店経費の月次集計')
  await page.getByRole('textbox', { name: 'やりたい作業・目的' }).fill('支店の経費を毎月まとめ、役員会に報告する')
  await page.getByRole('radiogroup', { name: '改善診断' }).getByRole('radio', { name: '今の工程から見直す' }).click()
  // 見直しを選んでいる間は、③（手順の作り方）は見直しの後で選ぶ
  await expect(page.getByRole('radiogroup', { name: 'もとにするひな形' })).toHaveCount(0)
  await expect(page.getByRole('note', { name: '手順の作り方' })).toContainText('作業手順の作り方は、見直しの後で選びます')
  await page.getByRole('button', { name: '次へ：今の工程を入力する' }).click()
  await expect(page.getByRole('heading', { name: '今の作業を書き出す' })).toBeVisible()
}

test('「今の工程から見直す」を選ぶと、業務の情報と工程の表を入力でき、戻っても内容が残る', async ({ page }) => {
  await openReview(page)
  // やりたい作業・目的は、業務の目的に引き継ぐ
  await expect(page.getByRole('textbox', { name: '業務の目的' })).toHaveValue('支店の経費を毎月まとめ、役員会に報告する')
  await page.getByRole('textbox', { name: '困っていること' }).fill('同じ数値を何度も書き写している')

  // 工程を入力する（1行目は最初からある）
  await field(page, 1, '工程名').fill('支店の経費Excelを受け取る')
  await page.getByRole('spinbutton', { name: '工程1のくり返しの回数' }).fill('4')
  await field(page, 1, '時間（分）').fill('10')
  await page.getByRole('button', { name: '工程を追加' }).click()
  await field(page, 2, '工程名').fill('科目ごとに合計する')
  await pick(page, 2, '作業の種類').selectOption({ label: '集計する' })
  await field(page, 2, '時間（分）').fill('30')
  await page.getByRole('button', { name: '工程を追加' }).click()
  await field(page, 3, '工程名').fill('役員会資料に書き写す')
  await pick(page, 3, '作業の種類').selectOption({ label: '資料（スライド・文書）に書き写す' })
  // 書き写し元は、それより前の工程だけ選べる。選ぶと書き写し先を入れられる
  await expect(pick(page, 3, '書き写し元').locator('option')).toHaveText(['なし', '工程1', '工程2'])
  await expect(field(page, 3, '書き写し先')).toBeDisabled()
  await pick(page, 3, '書き写し元').selectOption({ label: '工程2' })
  await field(page, 3, '書き写し先').fill('役員会報告資料')
  await field(page, 3, '時間（分）').fill('20')
  // すべての工程に時間があると、合計を出す（想定値。くり返しを含む）
  await expect(page.getByLabel('所要時間の合計')).toHaveText('合計 90分（想定値。くり返しを含む）')

  // 並べ替えで書き写し元が後ろになると、押したときに理由を行の直下に示し、その行へ移る（黙って直さない）
  await page.getByRole('button', { name: '工程3を上へ移動' }).click()
  await page.getByRole('button', { name: '工程2を上へ移動' }).click()
  await page.getByRole('button', { name: '改善候補を見る' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '工程1：書き写し元は、それより前の工程を選んでください' })).toBeVisible()
  await expect(page.getByRole('status', { name: '入力の状態' })).toHaveText('入力を直してください（1件）')
  await expect(field(page, 1, '工程名')).toBeFocused()
  await page.getByRole('button', { name: '工程1を下へ移動' }).click()
  await page.getByRole('button', { name: '工程2を下へ移動' }).click()
  await expect(field(page, 3, '工程名')).toHaveValue('役員会資料に書き写す')

  // 工程名がない行も、押したときに示す。削除すると消える
  await page.getByRole('button', { name: '工程を追加' }).click()
  await page.getByRole('button', { name: '改善候補を見る' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '工程4：工程名を入力してください' })).toBeVisible()
  await page.getByRole('button', { name: '工程4を削除' }).click()
  await page.getByRole('button', { name: '改善候補を見る' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status', { name: '入力の状態' })).toHaveText('入力に問題はありません（改善候補の表示は準備中です）')

  // 作業を伝える画面へ戻っても、見直しを選んだまま。入力の画面へ戻ると内容が残っている
  await page.getByRole('button', { name: '作業を伝える画面に戻る' }).click()
  await expect(page.getByRole('radiogroup', { name: '改善診断' }).getByRole('radio', { name: '今の工程から見直す' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '今の工程の入力に戻る' }).click()
  await expect(field(page, 3, '書き写し先')).toHaveValue('役員会報告資料')
  await expect(page.getByRole('textbox', { name: '困っていること' })).toHaveValue('同じ数値を何度も書き写している')
  await expect(row(page, 1)).toBeVisible()
})

test('見直しを選ばなければ、これまでどおり「診断せずに進む」で手順の作成へ進める', async ({ page }) => {
  await page.goto('/build?start=work')
  await page.getByRole('textbox', { name: '案件名' }).fill('支店経費の月次集計')
  await page.getByRole('radiogroup', { name: '改善診断' }).getByRole('radio', { name: '診断せずに進む' }).click()
  await expect(page.getByRole('button', { name: '次へ：今の工程を入力する' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ひな形を選ぶ' })).toBeVisible()
})
