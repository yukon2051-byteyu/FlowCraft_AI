import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/*
 * タスク1-8：作業手順の保存（ブラウザの一覧・.json ファイル・版数・未保存のまま離れるときの確認）。
 * デモ用の架空データを使う。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = (name: string) => path.join(here, '..', '..', 'backend', 'app', 'demos', 'data', name)
const LIBRARY_KEY = 'flowcraft.savedFlows.v1'

async function startFlow(page: Page) {
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx')])
  await expect(page.getByText('1ファイル')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()
}

const header = (page: Page) => page.getByRole('banner')
const dialog = (page: Page) => page.getByRole('dialog', { name: '作業手順を保存' })

test('保存すると、版1としてブラウザの一覧とファイルに保存され、ファイルはサーバーの検証を通る', async ({ page, request }) => {
  test.setTimeout(90_000)
  await startFlow(page)
  await expect(header(page).getByText('保存していません（保存は任意です）')).toBeVisible() // 一度も保存していないときは、控えめに表示（1-11）

  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await expect(dialog(page)).toContainText('初めての保存です。版1として保存します。')
  // 名前は必須
  await dialog(page).getByRole('textbox', { name: '作業手順の名前' }).fill('  ')
  await expect(dialog(page)).toContainText('作業手順の名前を入力してください。')
  await expect(dialog(page).getByRole('button', { name: '保存する' })).toBeDisabled()
  await dialog(page).getByRole('textbox', { name: '作業手順の名前' }).fill('月次売上集計')
  await dialog(page).getByRole('textbox', { name: '説明（任意）' }).fill('前月の売上を集計する')

  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: '保存する' }).click()])
  expect(download.suggestedFilename()).toBe('月次売上集計_v1.json')
  await expect(dialog(page).getByRole('status')).toContainText('「月次売上集計」を版1として保存しました')

  // ファイル：形の決まりの検証を通る。業務データ（ファイルの割当）は含まない
  const text = await readFile((await download.path())!, 'utf-8')
  const saved = JSON.parse(text)
  expect(saved.flow_name).toBe('月次売上集計')
  expect(saved.flow_version).toBe(1)
  expect(text).not.toContain('file_id')
  const session = (await (await request.post('/api/session')).json()).session_id
  const res = await request.post('/api/flows/validate', { data: { flow: saved }, headers: { 'X-Session-Id': session } })
  expect((await res.json()).valid).toBe(true)

  // ブラウザの一覧にも同じ内容が入っている
  const lib = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), LIBRARY_KEY)
  expect(lib).toHaveLength(1)
  expect(lib[0].summary).toMatchObject({ flow_name: '月次売上集計', flow_version: 1 })
  expect(lib[0].flow).toEqual(saved)

  // 閉じると、名前が上部に出て、未保存の印が消える
  await dialog(page).getByRole('button', { name: '閉じる' }).last().click()
  await expect(header(page)).toContainText('月次売上集計')
  await expect(header(page).getByText('未保存の変更があります')).toBeHidden()
  await expect(header(page).getByText('保存していません（保存は任意です）')).toBeHidden()

  // 変更してから保存すると版2。一覧は置き換わり、2件にならない
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await page.getByRole('region', { name: '追加する処理を選ぶ' }).getByRole('button', { name: /^条件に合う行だけ残す/ }).click()
  await expect(header(page).getByText('未保存の変更があります')).toBeVisible()
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await expect(dialog(page)).toContainText('変更があるため、版2として保存します（前の版：1）。')
  await dialog(page).getByRole('checkbox', { name: /ファイル（\.json）としてダウンロード/ }).uncheck()
  // 条件を1つも決めていない「条件で残す」は、形の決まりに合わないため保存しない（後で開けないファイルを作らない）
  await dialog(page).getByRole('button', { name: '保存する' }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('ステップ2「条件に合う行だけ残す」：条件を1つ以上追加してください')
  expect((await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), LIBRARY_KEY))[0].summary.flow_version).toBe(1)
  await dialog(page).getByRole('button', { name: 'やめる' }).click()

  // 条件を決めれば保存できる（確認済みにしていなくても、作りかけとして保存できる）
  const settings = page.getByRole('region', { name: 'ステップ2の設定' })
  await settings.getByRole('button', { name: /条件を追加/ }).first().click()
  await settings.getByRole('combobox', { name: /条件1の列/ }).selectOption('部署コード')
  await settings.getByRole('textbox', { name: /条件1の値/ }).fill('D01')
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await dialog(page).getByRole('checkbox', { name: /ファイル（\.json）としてダウンロード/ }).uncheck()
  await dialog(page).getByRole('button', { name: '保存する' }).click()
  await expect(dialog(page).getByRole('status')).toContainText('版2として保存しました')
  const lib2 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), LIBRARY_KEY)
  expect(lib2).toHaveLength(1)
  expect(lib2[0].summary.flow_version).toBe(2)
})

test('保存先を1つも選ばないと保存できない。「やめる」で閉じると何も保存しない', async ({ page }) => {
  await startFlow(page)
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await dialog(page).getByRole('checkbox', { name: /このブラウザの「保存した作業手順」/ }).uncheck()
  await dialog(page).getByRole('checkbox', { name: /ファイル（\.json）としてダウンロード/ }).uncheck()
  await expect(dialog(page)).toContainText('保存先を1つ以上選んでください。')
  await expect(dialog(page).getByRole('button', { name: '保存する' })).toBeDisabled()
  await dialog(page).getByRole('button', { name: 'やめる' }).click()
  await expect(dialog(page)).toBeHidden()
  expect(await page.evaluate((k) => localStorage.getItem(k), LIBRARY_KEY)).toBeNull()
  await expect(header(page).getByText('保存していません（保存は任意です）')).toBeVisible()
})

test('未保存のままトップへ戻ろうとすると確認が出る。キャンセルすれば留まる', async ({ page }) => {
  await startFlow(page)
  const messages: string[] = []
  page.once('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })
  await header(page).getByRole('link', { name: 'トップへ戻る' }).click()
  expect(messages[0]).toContain('保存していない変更があります')
  await expect(page).toHaveURL(/\/build$/)

  // 保存した後は確認なしで移動できる
  await header(page).getByRole('button', { name: '作業手順を保存' }).click()
  await dialog(page).getByRole('checkbox', { name: /ファイル（\.json）としてダウンロード/ }).uncheck()
  await dialog(page).getByRole('button', { name: '保存する' }).click()
  await dialog(page).getByRole('button', { name: '閉じる' }).last().click()
  let asked = false
  page.once('dialog', (d) => {
    asked = true
    void d.accept()
  })
  await header(page).getByRole('link', { name: 'トップへ戻る' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(asked).toBe(false)
})

test('作業手順を作る前は、保存できない', async ({ page }) => {
  await page.goto('/build')
  await expect(header(page).getByRole('button', { name: '作業手順を保存' })).toBeDisabled()
  await expect(header(page).getByText('未保存の変更があります')).toBeHidden()
})

test('未保存のままタブを閉じようとすると、ブラウザの確認が出る', async ({ page }) => {
  await startFlow(page)
  const shown = new Promise<string>((resolve) => page.once('dialog', (d) => { resolve(d.type()); void d.dismiss() }))
  await page.close({ runBeforeUnload: true })
  expect(await shown).toBe('beforeunload')
})
