import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * タスク1-4：処理内容の設定フォーム（よく使う9種）のE2Eテスト。
 * 画面から9種すべてを設定して確認済みにし、作業手順のチェック（サーバーの検証）を通ることを確かめる。
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

test('よく使う9種の処理を画面から設定し、作業手順のチェックを通る', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/build?start=file')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(page.getByText('3ファイル')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()

  // 1 読み込む：使う列を表示（変更は前の画面で）
  await card(page, 1).getByRole('heading').click()
  await expect(panel(page, 1)).toContainText('使う列（8列）')

  // 4 情報を付け加える（売上 ＋ 商品マスタ）
  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の元の表' }).selectOption({ label: 'ステップ1の結果：売上実績を読み込む' })
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の付け加える表' }).selectOption({ label: 'ステップ2の結果：商品マスタを読み込む' })
  const p4 = panel(page, 4)
  // 設定が終わるまでは、確認済みにできない
  await expect(p4.getByRole('button', { name: 'この内容で確認済みにする' })).toBeDisabled()
  await expect(p4.getByRole('list', { name: '設定が必要なこと' })).toContainText('元の表と付け加える表の列を選んでください')
  await p4.getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('商品コード')
  await expect(p4.getByRole('combobox', { name: '付け加える表の照合に使う列1' })).toHaveValue('商品コード') // 同じ名前の列を自動で選ぶ
  await p4.getByRole('checkbox', { name: '売上金額' }).check()
  await confirm(page, 4)
  await expect(card(page, 4)).toContainText('処理内容：商品コードを使って、情報を付け加える')

  // 5 情報を付け加える（＋ 部署マスタ）
  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 5).getByRole('combobox', { name: 'ステップ5の付け加える表' }).selectOption({ label: 'ステップ3の結果：部署マスタを読み込む' })
  await panel(page, 5).getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('部署コード')
  await confirm(page, 5)

  // 6 条件に合う行だけ残す
  await addAtEnd(page, '条件に合う行だけ残す')
  const p6 = panel(page, 6)
  await p6.getByRole('button', { name: '条件を追加' }).click()
  await p6.getByRole('combobox', { name: '条件1の列' }).selectOption('数量')
  await p6.getByRole('combobox', { name: '条件1の比べ方' }).selectOption('ge')
  await p6.getByRole('textbox', { name: '条件1の値' }).fill('１') // 全角は受け付けない
  await expect(p6.getByRole('list', { name: '設定が必要なこと' })).toContainText('数値（半角）で入力してください')
  await p6.getByRole('textbox', { name: '条件1の値' }).fill('1')
  await confirm(page, 6)
  await expect(card(page, 6)).toContainText('「数量」が 1 以上の行だけ残す')

  // 7 計算した列を追加する
  await addAtEnd(page, '計算した列を追加する')
  const p7 = panel(page, 7)
  await p7.getByRole('textbox', { name: '計算結果の列名' }).fill('税込金額')
  await p7.getByRole('combobox', { name: '左側の列' }).selectOption('売上金額')
  await p7.getByRole('combobox', { name: '右側の種類' }).selectOption('constant')
  await p7.getByRole('textbox', { name: '右側の数値' }).fill('1.1')
  await p7.getByRole('combobox', { name: '小数の桁数' }).selectOption('0')
  await confirm(page, 7)

  // 8 列の名前を変える
  await addAtEnd(page, '列の名前を変える')
  await panel(page, 8).getByRole('combobox', { name: '1つ目の元の列' }).selectOption('部署名')
  await panel(page, 8).getByRole('textbox', { name: '1つ目の新しい名前' }).fill('部署')
  await confirm(page, 8)

  // 9 必要な列を取り出す
  await addAtEnd(page, '必要な列を取り出す')
  await panel(page, 9).getByRole('checkbox', { name: '部署', exact: true }).check()
  await panel(page, 9).getByRole('checkbox', { name: '税込金額', exact: true }).check()
  await confirm(page, 9)

  // 10 項目ごとに合計・集計する
  await addAtEnd(page, '項目ごとに合計・集計する')
  const p10 = panel(page, 10)
  await p10.getByRole('checkbox', { name: '「部署」ごとにまとめる' }).check()
  await p10.getByRole('combobox', { name: '集計1の列' }).selectOption('税込金額')
  await expect(p10.getByRole('textbox', { name: '集計1の結果の列名' })).toHaveValue('税込金額合計')
  await confirm(page, 10)
  await expect(card(page, 10)).toContainText('部署ごとに税込金額の合計を求める')

  // 11 複数の表を縦にまとめる
  await addAtEnd(page, '複数の表を縦にまとめる')
  await card(page, 11).getByRole('combobox', { name: 'ステップ11のまとめる表2' }).selectOption({ label: 'ステップ3の結果：部署マスタを読み込む' })
  await panel(page, 11).getByRole('combobox', { name: '一部の表に列がないとき' }).selectOption('allow')
  await confirm(page, 11)

  // 12 Excelに出力する
  await addAtEnd(page, 'Excelに出力する')
  await card(page, 12).getByRole('combobox', { name: 'ステップ12の出力する表1' }).selectOption({ label: 'ステップ10の結果：項目ごとに合計・集計する' })
  const sheet = panel(page, 12).getByRole('textbox', { name: 'シート1の名前' })
  await expect(sheet).toHaveValue('項目ごとに合計・集計する')
  await sheet.fill('部署別/売上')
  await expect(panel(page, 12).getByRole('list', { name: '設定が必要なこと' })).toContainText('シート名に [ ] : * ? / \\ は使えません')
  await sheet.fill('部署別売上')
  await confirm(page, 12)

  // すべて確認済みになり、作業手順のチェック（サーバー）も通る
  const status = page.getByRole('status', { name: '作業手順のチェック' })
  await expect(status).toHaveText('作業手順の形に問題はありません。すべてのステップが確認済みです', { timeout: 10_000 })

  // 確認済みのステップの設定を変えると、もう一度確認が必要になる
  await card(page, 6).getByRole('heading').click()
  await panel(page, 6).getByRole('textbox', { name: '条件1の値' }).fill('2')
  await expect(card(page, 6)).toContainText('設定が必要')
  await expect(status).toContainText('確認済みでないステップ：1個', { timeout: 10_000 })

  const texts = (await page.locator('body').innerText()).split('\n')
  expect(texts.filter((t) => BANNED.test(t))).toEqual([])
})

test('残りの6種（並べ替え・列を消す・同じ値の列・形式・重複・空欄）を設定し、作業手順のチェックを通る', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/build?start=file')
  await page.getByTestId('file-input').first().setInputFiles(demo('売上実績_2026-10.xlsx'))
  await expect(page.getByText('1ファイル')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()

  // 2 並べ替える
  await addAtEnd(page, '並べ替える')
  await panel(page, 2).getByRole('combobox', { name: '並べ替え1の列' }).selectOption('売上金額')
  await panel(page, 2).getByRole('combobox', { name: '並べ替え1の順番' }).selectOption('desc')
  await confirm(page, 2)
  await expect(card(page, 2)).toContainText('売上金額の大きい順に並べ替える')

  // 3 不要な列を消す
  await addAtEnd(page, '不要な列を消す')
  await panel(page, 3).getByRole('checkbox', { name: '「備考」を消す' }).check()
  await confirm(page, 3)

  // 4 同じ値の列を追加する
  await addAtEnd(page, '同じ値の列を追加する')
  await panel(page, 4).getByRole('textbox', { name: '追加する列の名前' }).fill('対象月')
  await panel(page, 4).getByRole('textbox', { name: '入れる値' }).fill('2026年10月')
  await confirm(page, 4)

  // 5 データの形式をそろえる
  await addAtEnd(page, 'データの形式をそろえる')
  await panel(page, 5).getByRole('combobox', { name: '1つ目の列' }).selectOption('数量')
  await panel(page, 5).getByRole('combobox', { name: '1つ目の変換後の形式' }).selectOption('decimal')
  await panel(page, 5).getByRole('combobox', { name: '1つ目の小数の桁数' }).selectOption('1')
  await confirm(page, 5)

  // 6 重複を調べる・取り除く（調べるだけ）
  await addAtEnd(page, '重複を調べる・取り除く')
  await panel(page, 6).getByRole('checkbox', { name: '「伝票番号」で重複を判断する' }).check()
  await confirm(page, 6)
  await expect(card(page, 6)).toContainText('伝票番号の重複を調べる（データは変えない）')

  // 7 空欄を調べる・埋める：形式に合わない値では埋められない
  await addAtEnd(page, '空欄を調べる・埋める')
  const p7 = panel(page, 7)
  await p7.getByRole('checkbox', { name: '「数量」の空欄を調べる' }).check()
  await p7.getByRole('combobox', { name: '空欄があったとき' }).selectOption('fill')
  await p7.getByRole('textbox', { name: '空欄に入れる値' }).fill('なし')
  await expect(p7.getByRole('list', { name: '設定が必要なこと' })).toContainText('小数の列には 数値（半角）で入力してください')
  await p7.getByRole('textbox', { name: '空欄に入れる値' }).fill('0')
  await confirm(page, 7)

  // 8 Excelに出力する
  await addAtEnd(page, 'Excelに出力する')
  await confirm(page, 8)

  await expect(page.getByRole('status', { name: '作業手順のチェック' })).toHaveText('作業手順の形に問題はありません。すべてのステップが確認済みです', { timeout: 10_000 })
  const texts = (await page.locator('body').innerText()).split('\n')
  expect(texts.filter((t) => BANNED.test(t))).toEqual([])
})
