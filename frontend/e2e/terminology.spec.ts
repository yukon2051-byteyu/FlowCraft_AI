import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/*
 * 用語の統一（docs/ui-terminology.md）の回帰テスト。
 * 一般ユーザー向けの画面に開発者向けの言葉が表示されないこと、
 * 「次の操作」の案内が状況に応じて変わることを確認する。
 */

// 画面に出してはいけない言葉。「型」は単独の用語として使われた場合のみ（「定型」「14型」は対象外）
const BANNED = /ノード|フロー|Phase|確定|真偽値|プレビュー|JSON|マッピング|スキーマ|結合キー|未照合|(?<![定0-9０-９])型(?!番)/

async function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = [document.body.innerText]
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
      for (const a of ['title', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(a)
        if (v) out.push(v)
      }
    }
    return out.join('\n').split('\n')
  })
}

async function expectNoJargon(page: Page) {
  const hits = (await visibleTexts(page)).filter((t) => BANNED.test(t))
  expect(hits, '画面に専門用語が残っています').toEqual([])
}

for (const [label, path] of [
  ['TOP', '/'],
  ['開始画面', '/workspace'],
  ['作業手順の画面（サンプル）', '/workspace?view=sample'],
] as const) {
  test(`${label}に専門用語が表示されない`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expectNoJargon(page)
  })
}

test('「次の操作」の案内が、回答・確認に合わせて変わる', async ({ page }) => {
  await page.goto('/workspace?view=sample')
  const hint = page.locator('p', { hasText: '次の操作：' })
  await expect(hint).toContainText('ステップ3の確認が必要です。商品コードの重複について回答してください')

  // AIからの確認には、理由と回答による違いが表示される
  await expect(page.getByText('確認する理由：')).toBeVisible()
  await expect(page.getByText('この回答の場合：').first()).toBeVisible()

  await page.getByRole('button', { name: 'はい、1つだけ' }).click()
  await expect(hint).toContainText('AIの提案を確認してください（残り2ステップ）')

  for (const name of ['部署コードを使って', '部署名ごとに']) {
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await page.getByRole('button', { name: 'この内容で確認済みにする' }).click()
  }
  await expect(hint).toContainText('ステップ6「Excelに出力する」の設定が必要です')
  // 押せないボタンの理由が、ボタンの近くに文章で表示される
  await expect(page.getByText('確認が終わっていないステップが1つあるため、まだ実行できません')).toBeVisible()
})

test('用語の説明はマウスでもキーボードでも読める', async ({ page }) => {
  await page.goto('/workspace?view=sample')
  const tip = page.getByRole('button', { name: '照合に使う列の説明' })
  await tip.hover()
  await expect(page.getByRole('tooltip')).toContainText('2つの表で同じ値が入っている列')
  await page.mouse.move(5, 5)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await tip.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})
