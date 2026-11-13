import { expect, test } from '@playwright/test'

/*
 * TOPページ：6つ目の価値（無人定期実行）と「ページの先頭に戻る」ボタン。
 */

test('無人定期実行のカードは「開発中」と、5つの確認を示す', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('article', { name: '決まった日時に無人で実行できる' })
  await expect(card.getByRole('heading', { name: '毎月のExcel作業を、確認するだけの業務へ。' })).toBeVisible()
  await expect(card.getByText('開発中', { exact: true })).toHaveCount(3) // 無人定期実行・クラウドで試す・Windows Worker
  // 3分後の自動実行デモは、完成するまで押せない
  await expect(card.getByRole('button', { name: '3分後に自動実行を試す' })).toBeDisabled()
  await expect(card.getByRole('list', { name: '無人で実行する前の5つの確認' }).getByRole('listitem')).toHaveText([/設定を保存/, /接続テスト/, /テスト実行/, /品質検証/, /利用者が有効化/])
  await expect(page.getByText('FlowCraft AIの6つの特徴')).toBeVisible()
  // 試し方の3つの区分：未実装のものは「開発中」、製品版の機能は「対応予定」と分けて示す
  const ways = card.getByRole('list', { name: '無人実行の試し方' }).getByRole('listitem')
  await expect(ways).toHaveCount(3)
  await expect(ways.nth(0)).toContainText('クラウドで試す')
  await expect(ways.nth(0)).toContainText('開発中')
  await expect(ways.nth(1)).toContainText('Windows Workerで試せる')
  await expect(ways.nth(1)).toContainText('開発中')
  await expect(ways.nth(2)).toContainText('製品版で対応予定')
})

test('先頭に戻るボタン：先頭では隠れ、スクロールすると右下に出て、押すと滑らかに先頭へ戻る', async ({ page }) => {
  await page.goto('/')
  // 隠れている間は読み上げの対象からも外すため、属性で探す
  const btn = page.locator('button[aria-label="ページの先頭に戻る"]')
  // 先頭にいるときは表示しない（押す意味がないため）
  await expect(btn).toHaveCSS('opacity', '0')
  await expect(btn).toHaveAttribute('tabindex', '-1')

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
  await expect(btn).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: 'ページの先頭に戻る' })).toBeVisible()
  const box = (await btn.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x + box.width).toBeGreaterThan(vp.width - 40) // 右下にある
  expect(box.y + box.height).toBeGreaterThan(vp.height - 40)

  await btn.click()
  // 滑らかなスクロール：押した直後はまだ途中にいて、少し待つと先頭に着く
  const midway = await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))))
  expect(midway).toBeGreaterThan(0)
  // 他のテストと同時に動くと描画が遅くなるため、着くまで長めに待つ
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBe(0)
  await expect(btn).toHaveCSS('opacity', '0')
})

test('特徴カードから詳しい説明へ：③「品質検証の仕組みを見る」で品質の確認へ移動し、見出しがヘッダーに隠れない', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  const features = page.locator('#features')
  // 詳しい説明のセクションがあるカードだけに案内を付ける（01・03・04）
  const links = features.getByRole('link', { name: /見る$/ })
  await expect(links).toHaveCount(3)
  expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')))).toEqual(['#flow', '#trust', '#try'])
  for (const href of ['#flow', '#trust', '#try']) await expect(page.locator(href)).toHaveCount(1)

  await features.getByRole('link', { name: '品質検証の仕組みを見る' }).click()
  const heading = page.getByRole('heading', { name: 'AI任せにしない。決めた基準で、毎回検証。' })
  await expect(heading).toBeFocused()
  await expect.poll(async () => (await heading.boundingBox())?.y ?? -1, { timeout: 10_000 }).toBeGreaterThan(64)
  await expect.poll(async () => (await heading.boundingBox())?.y ?? 999, { timeout: 10_000 }).toBeLessThan(160)
  // 同じページの中の移動で、履歴を増やさない
  expect(page.url()).not.toContain('#')
  // 説明を読んだ直後に、品質異常のデモを体験できる
  await expect(page.locator('#trust').getByRole('link', { name: '品質異常のデモを体験する' })).toHaveAttribute('href', '/build?demo=monthly_sales&pattern=ng')
})

test('キーボードでも使える。動きを減らす設定では、すぐに移動し強調しない', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const link = page.locator('#features').getByRole('link', { name: '保存・再実行について見る' })
  await link.focus()
  await page.keyboard.press('Enter')
  const heading = page.getByRole('heading', { name: '一度作った手順を、何度でも使える。' })
  await expect(heading).toBeFocused()
  await expect(heading).not.toHaveClass(/section-flash/)
  const y = (await heading.boundingBox())!.y
  expect(y).toBeGreaterThan(64)
  expect(y).toBeLessThan(160)
})

test('品質の確認：実行結果のイメージはタイトル左揃え・5要素は中央。間隔がそろい、矢印とボタンの中心が一致。ボタンでデモへ', async ({ page }) => {
  for (const [w, h] of [
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    const m = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
      const q = (k: string) => r(`#trust [data-flow="${k}"]`)
      const card = r('#trust [aria-label="実行結果のイメージ"]')
      const det = q('detect'), a1 = q('arrow1'), stop = q('stop'), a2 = q('arrow2'), note = q('note')
      const btn = r('#trust [data-flow="demo"] a')
      const title = q('title').left
      const cy = (b: DOMRect) => b.top + b.height / 2
      const right = Math.max(btn.right, note.right)
      return {
        gaps: [a1.left - det.right, stop.left - a1.right, a2.left - stop.right, btn.left - a2.right],
        centers: [cy(a1), cy(stop), cy(a2), cy(btn), cy(det)],
        card: card.height,
        // 5要素のグループの左右の余白（カードの端から）。中央揃えなら等しい
        sides: [det.left - card.left, card.right - right],
        // タイトルは左揃え（カードの内側の余白の位置）
        titleIndent: title - card.left,
        noteBelowButton: note.top - btn.bottom,
        noteCenterDiff: (note.left + note.right) / 2 - (btn.left + btn.right) / 2,
        cards: [...document.querySelectorAll('#trust ol li')].map((e) => e.getBoundingClientRect().height),
      }
    })
    expect(Math.max(...m.gaps) - Math.min(...m.gaps), `${w}px：間隔の差`).toBeLessThanOrEqual(2)
    expect(Math.max(...m.centers) - Math.min(...m.centers), `${w}px：中心の差`).toBeLessThanOrEqual(2)
    expect(m.card).toBeLessThanOrEqual(180)
    expect(Math.abs(m.sides[0] - m.sides[1]), `${w}px：左右の余白の差`).toBeLessThanOrEqual(2)
    expect(m.sides[0], `${w}px：全幅に広げていない`).toBeGreaterThan(80)
    expect(m.titleIndent, `${w}px：タイトルは左揃え`).toBeLessThanOrEqual(40)
    expect(m.noteBelowButton).toBeGreaterThanOrEqual(4)
    expect(Math.abs(m.noteCenterDiff)).toBeLessThanOrEqual(2)
    expect(new Set(m.cards.map(Math.round)).size).toBe(1)
  }
  await page.locator('#trust').getByRole('link', { name: '品質異常のデモを体験する' }).click()
  await expect(page).toHaveURL(/[/]build[?]demo=monthly_sales&pattern=ng/)
})

test('データの取り扱いは「自分のExcelで試す」の右側に統合し、独立したセクションは置かない', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'データの取り扱い・ご利用上の注意' })).toHaveCount(0)
  const formats = page.getByRole('region', { name: '対応形式' })
  await expect(formats).toContainText('※ パスワード付きExcel、VBAマクロの実行には対応していません。')
  const handling = page.getByRole('region', { name: 'データの取り扱い' })
  await expect(handling).toContainText('読み込んだデータは、最後の操作から60分で自動的に削除します。')
  await expect(handling).toContainText('現在、AIへのデータ送信は行っていません（AI機能は開発中です）。')
  await expect(handling).toContainText('公開版では、機密情報や実在する個人情報を含むファイルは使用しないでください。')
  await expect(handling).toContainText('AI機能について')
  await expect(page.getByRole('region', { name: 'AI機能の利用について' })).toHaveCount(0)
  // 同じ説明をTOPの中で重複させない
  await expect(page.getByText('最後の操作から60分で自動的に削除します', { exact: false })).toHaveCount(1)
})
