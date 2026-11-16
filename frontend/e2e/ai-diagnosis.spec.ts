import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

/*
 * A-3：AI業務改善診断の入口・送る情報の確認・AI使用パスワード・質問（回答は任意）。
 * テスト用のサーバーはAIを使わない設定なので、AIの状態と質問の API だけを差し替える（「AIに送る情報」はサーバーで実際に作る）。
 * 実際のAIは呼ばない。架空の業務を入力する。
 */

const QUESTIONS = {
  understanding: '支店の経費を毎月まとめ、役員会に報告する業務と把握しました。',
  questions: [
    { question: '役員会の資料は、誰が何に使っていますか？', why: '使われていない資料なら、作らずに済む可能性があるためです。', examples: ['役員が予算の判断に使う', '使っているか分からない'] },
    { question: 'いちばん時間がかかるのはどこですか？', why: '効果の大きい工程から考えるためです。', examples: ['支店ごとの確認'] },
  ],
  fingerprint: 'f'.repeat(64),
  cached: false,
  mode: 'fixed',
}
const err = (code: string, message: string, how_to_fix: string) => JSON.stringify({ error: { code, message, cause: null, how_to_fix, node_id: null } })

async function mockAi(page: Page, questions: (route: Route, authed: boolean) => Promise<void>) {
  let authed = false
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { status: 'fixed', authenticated: authed, expires_in_seconds: null, calls_left_this_hour: 20 } }))
  await page.route('**/api/ai/auth', async (r) => {
    const { password } = r.request().postDataJSON() as { password: string }
    if (password !== 'e2e-ai-password') return r.fulfill({ status: 401, contentType: 'application/json', body: err('AI_AUTH_FAILED', 'パスワードが正しくありません。', 'AI使用パスワードを確かめて、もう一度入力してください。') })
    authed = true
    return r.fulfill({ json: { status: 'fixed', authenticated: true, expires_in_seconds: 3600, calls_left_this_hour: 20 } })
  })
  await page.route('**/api/ai/diagnosis/questions', (r) => questions(r, authed))
}

async function openAi(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/build?start=work')
  await page.getByRole('textbox', { name: '案件名' }).fill('支店経費の月次集計')
  await page.getByRole('textbox', { name: 'やりたい作業・目的' }).fill('支店の経費を毎月まとめ、役員会に報告する')
  const ai = page.getByRole('radiogroup', { name: '改善診断' }).getByRole('radio', { name: 'AIで業務を改善する' })
  await expect(ai).not.toHaveAttribute('aria-disabled', 'true')
  await ai.click()
  // AIを選んでいる間は、手順の作り方は後で選ぶ
  await expect(page.getByRole('radiogroup', { name: 'もとにするひな形' })).toHaveCount(0)
  await page.getByRole('button', { name: '次へ：AIに送る情報を確かめる' }).click()
  await expect(page.getByRole('heading', { name: 'AIに送る情報を確かめる' })).toBeVisible()
}

test('送る情報を確かめ、パスワードを入れると押し直さずに質問が出る。回答は任意で、例を押すと入る', async ({ page }) => {
  await mockAi(page, (r, authed) =>
    authed
      ? r.fulfill({ json: QUESTIONS })
      : r.fulfill({ status: 401, contentType: 'application/json', body: err('AI_AUTH_REQUIRED', 'この機能ではAIを使用します。AI使用パスワードを入力してください。', '') }),
  )
  await openAi(page)
  // 送る情報（サーバーで実際に作ったもの）：入力した業務の説明と、足りない情報
  const sent = page.getByRole('region', { name: 'AIに送る情報' })
  await expect(sent).toContainText('作業の名前：支店経費の月次集計')
  await expect(sent).toContainText('やりたい作業・目的：支店の経費を毎月まとめ、役員会に報告する')
  await expect(page.getByRole('region', { name: '足りない情報' })).toContainText('Excel・CSVがまだ読み込まれていません')

  // 認証が必要 → パスワードの入力（間違えると理由を示す）
  await page.getByRole('button', { name: 'この内容でAIに質問を作ってもらう' }).click()
  const dialog = page.getByRole('dialog', { name: 'AI機能を利用する' })
  await expect(dialog).toContainText('この機能ではAIを使用します。利用するにはAIパスワードを入力してください。')
  const pw = dialog.getByRole('textbox', { name: 'AI利用パスワード' })
  await expect(pw).toBeFocused()
  await pw.fill('まちがい')
  await pw.press('Enter')
  await expect(dialog.getByRole('alert')).toContainText('パスワードが正しくありません。')
  await expect(pw).toHaveValue('') // パスワードを画面に残さない
  await pw.fill('e2e-ai-password')
  await dialog.getByRole('button', { name: '認証して続ける' }).click()

  // 押し直さずに、質問が出る（初回は3問まで。なぜ聞くかを添える）
  await expect(page.getByRole('heading', { name: 'AIからの質問（回答は任意）' })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  const qs = page.getByRole('list', { name: 'AIからの質問' }).getByRole('listitem')
  await expect(qs).toHaveCount(2)
  await expect(qs.first()).toContainText('なぜ聞くか：使われていない資料なら、作らずに済む可能性があるためです。')
  await qs.first().getByRole('button', { name: '使っているか分からない' }).click()
  await expect(page.getByRole('textbox', { name: '質問1への回答' })).toHaveValue('使っているか分からない')
  // 回答しなくても進める
  await page.getByRole('button', { name: '回答して改善案を作る' }).click()
  await expect(page.getByRole('status').filter({ hasText: '回答を受け取りました' })).toBeVisible()
})

test('AIを使えないとき（上限など）は理由を示し、AIを使わずに手順を作る道を示す（簡易診断へは切り替えない）', async ({ page }) => {
  await mockAi(page, (r) => r.fulfill({ status: 429, contentType: 'application/json', body: err('AI_LIMIT_REACHED', 'AIの利用回数の上限に達しました。', 'しばらく待ってから、もう一度お試しください。AIを使わずに手順を作ることもできます。') }))
  await openAi(page)
  await page.getByRole('button', { name: 'この内容でAIに質問を作ってもらう' }).click()
  await expect(page.getByText('AIの利用回数の上限に達しました。')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'AIを使わずに手順を作る' }).first().click()
  await expect(page.getByRole('heading', { name: 'やりたい作業を伝える' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '改善診断をせずに手順を作る' })).toBeVisible()
})

test('AIが設定されていないサーバーでは、AIのカードは「利用できません」で選べない（パスワードも求めない）', async ({ page }) => {
  await page.goto('/build?start=work')
  const ai = page.getByRole('radiogroup', { name: '改善診断' }).getByRole('radio', { name: 'AIで業務を改善する' })
  await expect(ai).toHaveAttribute('aria-disabled', 'true')
  await expect(ai).toContainText('利用できません')
  await expect(ai).toContainText('AI機能は現在利用できません（このサーバーではAIが設定されていません）。')
  await ai.click({ force: true })
  await expect(ai).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
