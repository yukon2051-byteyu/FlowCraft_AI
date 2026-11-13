// 画面幅ごとのスクリーンショット撮影と、レイアウトの自動チェック。
// 使い方：開発サーバー（npm run dev）を起動した状態で
//   node scripts/screenshots.mjs <出力フォルダ> [ベースURL]
// チェック内容：横スクロールの有無、ブラウザのエラー、ファーストビューに主要ボタンが見えるか
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'screenshots'
const base = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })

// PC専用（docs/pc-only.md）：主要な確認解像度だけを撮る。スマートフォン・タブレットは対象外
const VIEWPORTS = [
  { name: 'pc-1920x1080', width: 1920, height: 1080 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
]

const PAGES = [
  { name: 'top', path: '/' },
  { name: 'workspace', path: '/build' },
  { name: 'workspace-sample', path: '/build?view=sample' },
  { name: 'kaizen-demo', path: '/kaizen-demo' },
]

const browser = await chromium.launch()
const problems = []

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  for (const pg of PAGES) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(base + pg.path, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) problems.push(`${vp.name} ${pg.name}: 横スクロール ${overflow}px`)
    if (errors.length) problems.push(`${vp.name} ${pg.name}: エラー ${errors.join(' / ')}`)

    if (pg.name === 'top') {
      // ファーストビュー内に主要CTAが完全に表示されているか
      for (const label of ['デモを体験する', '自分のExcelで試す']) {
        const box = await page.locator('main').getByRole('link', { name: label }).first().boundingBox()
        const visible = box && box.y >= 0 && box.y + box.height <= vp.height
        if (!visible) problems.push(`${vp.name} top: 「${label}」がファーストビューに入っていない（y=${box?.y}）`)
      }
      await page.screenshot({ path: join(outDir, `${vp.name}_${pg.name}_firstview.png`) })
    }
    await page.screenshot({ path: join(outDir, `${vp.name}_${pg.name}_full.png`), fullPage: pg.name === 'top' })
    await page.close()
  }
  await context.close()
}
await browser.close()

console.log(problems.length ? '問題あり:\n- ' + problems.join('\n- ') : '自動チェック：問題なし（横スクロールなし・エラーなし・CTA表示OK）')
