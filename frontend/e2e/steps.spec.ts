import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * タスク1-3：処理ステップの一覧（追加・削除・上下移動・使うデータ）のE2Eテスト。
 * デモの作業手順と同じ形（結合2回 → 集計で枝分かれ → 出力）を画面から組み立てる。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = (name: string) => path.join(here, '..', '..', 'backend', 'app', 'demos', 'data', name)
const BANNED = /ノード|フロー|Phase|確定|真偽値|プレビュー|JSON|マッピング|スキーマ|結合キー|未照合|(?<![定0-9０-９])型(?!番)/

const card = (page: Page, n: number) => page.getByRole('article', { name: new RegExp(`^ステップ${n}：`) })

async function addAtEnd(page: Page, name: string) {
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await page.getByRole('region', { name: '追加する処理を選ぶ' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

test('結合・枝分かれを含む作業手順を組み立て、つながりを壊す操作は理由を示して止める', async ({ page }) => {
  await page.goto('/build')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo('商品マスタ.xlsx'), demo('部署マスタ.csv')])
  await expect(page.getByText('3ファイル')).toBeVisible({ timeout: 20_000 }) // 複数ファイルの解析は、並行実行中だと時間がかかる
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()

  const hint = page.locator('p', { hasText: '次の操作：' })
  await expect(hint).toContainText('「処理ステップを追加する」から')

  // ステップ4：売上に商品マスタを付け加える
  await addAtEnd(page, '別の表から情報を付け加える')
  await expect(hint).toContainText('ステップ4「別の表から情報を付け加える」で使うデータを選んでください')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の元の表' }).selectOption({ label: 'ステップ1の結果：売上実績を読み込む' })
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の付け加える表' }).selectOption({ label: 'ステップ2の結果：商品マスタを読み込む' })

  // ステップ5：さらに部署マスタを付け加える（元の表は、すぐ上のステップ4の結果が選ばれている）
  await addAtEnd(page, '別の表から情報を付け加える')
  await expect(card(page, 5).getByRole('combobox', { name: 'ステップ5の元の表' })).toHaveValue('r1')
  await card(page, 5).getByRole('combobox', { name: 'ステップ5の付け加える表' }).selectOption({ label: 'ステップ3の結果：部署マスタを読み込む' })

  // ステップ6・7：同じ結果から2種類の集計（枝分かれ）
  await addAtEnd(page, '項目ごとに合計・集計する')
  await addAtEnd(page, '項目ごとに合計・集計する')
  await card(page, 7).getByRole('combobox', { name: 'ステップ7の使うデータ' }).selectOption({ label: 'ステップ5の結果：別の表から情報を付け加える' })
  await expect(card(page, 5)).toContainText('この結果を使うステップ：ステップ6・ステップ7')
  await expect(card(page, 1)).toContainText('この結果を使うステップ：ステップ4')
  await expect(card(page, 7)).toContainText('この結果は、まだどのステップでも使っていません')

  // ステップ8：2つの集計を出力
  await expect(hint).toContainText('最後に「Excelに出力する」を追加してください')
  await addAtEnd(page, 'Excelに出力する')
  await card(page, 8).getByRole('combobox', { name: 'ステップ8の出力する表1' }).selectOption({ label: 'ステップ6の結果：項目ごとに合計・集計する' })
  await card(page, 8).getByRole('button', { name: '表を追加' }).click()
  await card(page, 8).getByRole('combobox', { name: 'ステップ8の出力する表2' }).selectOption({ label: 'ステップ7の結果：項目ごとに合計・集計する' })
  await expect(hint).toContainText('ステップ4「別の表から情報を付け加える」の設定が必要です')

  // つながりを壊す移動は止める（番号は画面に表示中のもの）
  await card(page, 6).getByRole('button', { name: 'ステップ6を上へ移動' }).click()
  await expect(card(page, 6).getByRole('alert')).toHaveText('このステップはステップ5「別の表から情報を付け加える」の結果を使うため、それより上には動かせません。')
  await card(page, 2).getByRole('button', { name: 'ステップ2を下へ移動' }).click()
  await card(page, 3).getByRole('button', { name: 'ステップ3を下へ移動' }).click() // 商品マスタ（いまステップ3）をさらに下へ
  await expect(card(page, 3).getByRole('alert')).toContainText('ステップ4「別の表から情報を付け加える」が使っているため、それより下には動かせません')
  await expect(card(page, 3)).toContainText('商品マスタを読み込む')
  await card(page, 8).getByRole('button', { name: 'ステップ8を上へ移動' }).click()
  await expect(card(page, 8).getByRole('alert')).toContainText('最後に置いてください')
  await expect(card(page, 8).getByRole('button', { name: 'ステップ8を下へ移動' })).toBeDisabled()

  // 結果を使われているステップは消せない
  await card(page, 5).getByRole('button', { name: 'ステップ5を削除' }).click()
  await card(page, 5).getByRole('button', { name: '削除する' }).click()
  await expect(card(page, 5).getByRole('alert')).toContainText('ステップ6・7が使っているため、削除できません')
  await expect(page.getByRole('list', { name: '処理ステップ' }).getByRole('article')).toHaveCount(8)

  // 出力があるときに最後へ追加すると、出力の上に入る。出力はもう追加できない
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await expect(page.getByRole('button', { name: /^Excelに出力する/ })).toBeDisabled()
  await page.getByRole('button', { name: /^条件に合う行だけ残す/ }).click()
  await expect(card(page, 8)).toContainText('条件に合う行だけ残す')
  await expect(card(page, 9)).toContainText('Excelに出力する')

  // ステップの下に追加できる（ステップ1の下に入り、番号が繰り下がる）。前の操作の理由の表示は消える
  await card(page, 1).getByRole('button', { name: 'ステップ1の下にステップを追加' }).click()
  await page.getByRole('button', { name: /^並べ替える/ }).click()
  await expect(card(page, 2)).toContainText('並べ替える')
  await expect(card(page, 2).getByRole('combobox', { name: 'ステップ2の使うデータ' })).toHaveValue('in1')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await card(page, 2).getByRole('button', { name: 'ステップ2を削除' }).click()
  await card(page, 2).getByRole('button', { name: '削除する' }).click()

  // 使われていないステップは、確認してから削除できる
  await card(page, 8).getByRole('button', { name: 'ステップ8を削除' }).click()
  await card(page, 8).getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('list', { name: '処理ステップ' }).getByRole('article')).toHaveCount(8)

  const texts = (await page.locator('body').innerText()).split('\n')
  expect(texts.filter((t) => BANNED.test(t))).toEqual([])

  // 設定画面へ戻って作り直そうとすると、追加したステップが消えることを知らせる
  await page.getByRole('button', { name: '使う列と形式の設定に戻る' }).click()
  await expect(page.getByText('作り直すと、追加した処理ステップ（5個）は消えます')).toBeVisible()
})
