import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E2E で共通に使う操作（デモ用の架空データで、月次売上集計の作業手順を作る など）。
 */

export const here = path.dirname(fileURLToPath(import.meta.url))
export const demo = (name: string) => path.join(here, '..', '..', 'backend', 'app', 'demos', 'data', name)
export const BANNED = /ノード|フロー|Phase|確定|真偽値|プレビュー|JSON|マッピング|スキーマ|結合キー|未照合|(?<![定0-9０-９])型(?!番)/

export const card = (page: Page, n: number) => page.getByRole('article', { name: new RegExp(`^ステップ${n}：`) })
export const panel = (page: Page, n: number) => page.getByRole('region', { name: `ステップ${n}の設定` })

export async function addAtEnd(page: Page, name: string) {
  await page.getByRole('button', { name: '処理ステップを追加する' }).click()
  await page.getByRole('region', { name: '追加する処理を選ぶ' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

export async function confirm(page: Page, n: number) {
  await panel(page, n).getByRole('button', { name: 'この内容で確認済みにする' }).click()
  await expect(card(page, n)).toContainText('確認済み')
}

/** 売上 ＋ 商品マスタ ＋ 部署マスタ → 部署別に売上を合計 → 出力 */
export async function buildMonthlySales(page: Page, master: string) {
  await page.goto('/build?start=file')
  await page.getByTestId('file-input').first().setInputFiles([demo('売上実績_2026-10.xlsx'), demo(master), demo('部署マスタ.csv')])
  await expect(page.getByText('3ファイル')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '次へ：使う列と形式を決める' }).click()
  // 空白データの扱い（Phase Q-4）：売上実績の「備考」は空欄が多い。業務上ありうるので許可する
  await page.getByRole('combobox', { name: '「備考」の空欄の扱い' }).first().selectOption('allow')
  await page.getByRole('button', { name: 'この内容で作業手順を作り始める' }).click()

  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の元の表' }).selectOption('in1')
  await card(page, 4).getByRole('combobox', { name: 'ステップ4の付け加える表' }).selectOption('in2') // マスタのファイル名によってステップの名前が変わるため、内部の値で選ぶ
  await panel(page, 4).getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('商品コード')
  await panel(page, 4).getByRole('checkbox', { name: '売上金額' }).check()
  await confirm(page, 4)

  await addAtEnd(page, '別の表から情報を付け加える')
  await card(page, 5).getByRole('combobox', { name: 'ステップ5の付け加える表' }).selectOption('in3')
  await panel(page, 5).getByRole('combobox', { name: '元の表の照合に使う列1' }).selectOption('部署コード')
  await confirm(page, 5)

  await addAtEnd(page, '項目ごとに合計・集計する')
  await panel(page, 6).getByRole('checkbox', { name: '「部署名」ごとにまとめる' }).check()
  await panel(page, 6).getByRole('combobox', { name: '集計1の列' }).selectOption('売上金額')
  await confirm(page, 6)

  await addAtEnd(page, 'Excelに出力する')
  await panel(page, 7).getByRole('textbox', { name: 'シート1の名前' }).fill('部署別売上')
  await confirm(page, 7)
}

