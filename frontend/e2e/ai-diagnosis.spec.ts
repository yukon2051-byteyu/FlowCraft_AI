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
const NO_BUILD = { fit: 'no', template_id: null, template_title: null, step_types: [], step_labels: [], criteria_kinds: [], criteria_labels: [], note: '', adjusted: false }
const P = (id: string, direction: string, title: string, extra: Record<string, unknown> = {}) => ({
  proposal_id: id, direction, title, target: '対象の工程', problem: '今の問題', change: `${title}にする`,
  evidence: [{ source: 'inference', text: '推測の根拠', ref: '', downgraded: false }], effect: '効果', estimate: null, risks: [], recommendation: '推奨する対応', priority: 1,
  build: NO_BUILD, ...extra,
})
const PROPOSALS = {
  note: '過去の実行の履歴は送っていないため、品質異常の傾向は考えていません。',
  shown_first: 3,
  fingerprint: 'p'.repeat(64),
  cached: false,
  mode: 'fixed',
  proposals: [
    P('p2', 'eliminate', '役員会資料への転記をやめる', {
      evidence: [
        { source: 'answer', text: '回答：使っているか分からない', ref: '', downgraded: false },
        { source: 'inference', text: '同じ数値を2つの資料に書いている', ref: '列「存在しない列」', downgraded: true },
      ],
      risks: ['監査で必要な資料なら、なくせない'],
      build: { ...NO_BUILD, note: '資料をやめるかどうかは、業務の判断です。' },
    }),
    P('p1', 'automate', '集計と確認を作業手順にする', {
      evidence: [{ source: 'data', text: '「金額」の列がある', ref: '列「金額」', downgraded: false }],
      estimate: { kind: 'assumed', text: '月に約30分（仮定：確認に毎回30分）' },
      build: { ...NO_BUILD, fit: 'yes', template_id: 'monthly_sales', template_title: '月次売上集計', step_types: ['aggregate'], step_labels: ['集計'], criteria_kinds: ['total_match'], criteria_labels: ['2つの結果で合計が一致する'] },
    }),
    P('p3', 'standardize', '列名をそろえる', {
      build: { ...NO_BUILD, fit: 'partial', step_types: ['rename_columns'], step_labels: ['列名の変更'], note: '列名の見本を配るのは人が行います。' },
    }),
    P('p4', 'simplify', '確認の回数を減らす'),
  ],
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
  await page.route('**/api/ai/diagnosis/proposals', (r) => r.fulfill({ json: PROPOSALS }))
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
  // 回答して改善案を作る（回答した内容を送る）
  const proposalRequest = page.waitForRequest('**/api/ai/diagnosis/proposals')
  await page.getByRole('button', { name: '回答して改善案を作る' }).click()
  const body = (await proposalRequest).postDataJSON() as { answers: { question: string; answer: string }[] }
  expect(body.answers[0]).toEqual({ question: '役員会の資料は、誰が何に使っていますか？', answer: '使っているか分からない' })

  // 改善提案：重要な順に初めは3件まで。ほかは開いて見る
  await expect(page.getByRole('heading', { name: 'AIの改善提案' })).toBeVisible()
  const cards = page.getByRole('list', { name: '改善提案' }).getByRole('listitem').filter({ has: page.getByRole('radiogroup') })
  await expect(cards).toHaveCount(3)
  await expect(cards.first()).toContainText('廃止')
  await page.getByRole('button', { name: 'ほかの提案を見る（1件）' }).click()
  await expect(cards).toHaveCount(4)
  // 根拠の種類を分けて示す。データで確かめられなかったものは推測として表示
  const first = cards.first()
  await expect(first).toContainText('あなたの回答')
  await expect(first).toContainText('（データで確かめられなかったため、推測として表示）')
  await expect(first).toContainText('監査で必要な資料なら、なくせない')
  await expect(cards.nth(1)).toContainText('データで確認')
  await expect(cards.nth(1)).toContainText('仮定月に約30分（仮定：確認に毎回30分）')
  await expect(page.getByLabel('AIからの断り書き')).toContainText('過去の実行の履歴は送っていない')
  // 手順への反映（使える部品・人が行う部分）を示す
  await expect(first.getByLabel('手順への反映')).toContainText('手順に反映できない')
  await expect(cards.nth(1).getByLabel('手順への反映')).toContainText('手順にできるひな形「月次売上集計」／処理：集計／品質ルール：2つの結果で合計が一致する')

  // まだ何も採用していない → 反映の計画は「採用した提案はありません」。改善提案に戻れる
  await page.getByRole('button', { name: '次へ：手順への反映を確かめる' }).click()
  await expect(page.getByRole('heading', { name: '採用した改善を手順に反映する' })).toBeVisible()
  await expect(page.getByLabel('採用した改善')).toContainText('採用した提案はありません（未判断4件は反映しません）')
  await expect(page.getByRole('button', { name: '手順の作り方を選ぶ' })).toBeVisible()
  await page.getByRole('button', { name: '改善提案に戻る' }).click()

  // 採用・保留・不採用（理由は任意）
  await page.getByRole('radiogroup', { name: '提案1の判断' }).getByRole('radio', { name: '採用しない' }).click()
  await page.getByRole('textbox', { name: '提案1の判断の理由' }).fill('監査で必要な資料のため')
  await page.getByRole('radiogroup', { name: '提案2の判断' }).getByRole('radio', { name: '採用する' }).click()
  await page.getByRole('radiogroup', { name: '提案3の判断' }).getByRole('radio', { name: '採用する' }).click()
  await expect(page.getByRole('status', { name: '判断の状況' })).toHaveText('採用2・保留0・採用しない1・未判断1')

  // 反映の計画：手順に反映できるもの／人が行う作業として残るもの（一部できるものは両方）
  await page.getByRole('button', { name: '次へ：手順への反映を確かめる' }).click()
  const buildable = page.getByRole('region', { name: '手順に反映できるもの' })
  const manual = page.getByRole('region', { name: '人が行う作業として残るもの' })
  await expect(buildable).toContainText('集計と確認を作業手順にする')
  await expect(buildable).toContainText('列名をそろえる')
  await expect(buildable).not.toContainText('役員会資料')
  await expect(manual).toContainText('列名の見本を配るのは人が行います。')
  await expect(manual).not.toContainText('集計と確認')
  await expect(page.getByLabel('手順の作り方')).toContainText('もとにするひな形：「月次売上集計」')
  await expect(page.getByLabel('手順の作り方')).toContainText('未判断1件の提案は反映しません。')

  // ひな形を選んだ状態で手順の画面へ（処理ステップは自動で組み立てず、ひな形の仮の手順を確かめる）
  await page.getByRole('button', { name: 'ひな形「月次売上集計」で手順を作る' }).click()
  await expect(page.getByRole('heading', { name: '作業手順', exact: true })).toBeVisible()
  const adopted = page.getByRole('region', { name: '採用した改善' })
  await expect(adopted).toContainText('AIの診断で採用した改善（2件）')
  await expect(adopted).toContainText('集計と確認を作業手順にする')
  await expect(adopted).toContainText('品質ルールは「② 何を満たせば完了？」で')
  await adopted.getByRole('button', { name: /AIの診断で採用した改善/ }).click()
  await expect(adopted).not.toContainText('列名をそろえる') // 閉じられる
})

test('ひな形のない改善だけを採用したら、処理部品で作る（データの読み込みへ進む）。採用した改善は手順の画面に出る', async ({ page }) => {
  await mockAi(page, (r) => r.fulfill({ json: QUESTIONS })) // 認証済みとして扱う
  await openAi(page)
  await page.getByRole('button', { name: 'この内容でAIに質問を作ってもらう' }).click()
  await page.getByRole('button', { name: '回答して改善案を作る' }).click()
  await page.getByRole('radiogroup', { name: '提案3の判断' }).getByRole('radio', { name: '採用する' }).click()
  await page.getByRole('button', { name: '次へ：手順への反映を確かめる' }).click()
  await expect(page.getByText('手順に反映できる改善と、人が行う作業を確かめて、手順を作ってください')).toBeVisible()
  await expect(page.getByLabel('手順の作り方')).toContainText('もとにできるひな形はありません。データを読み込んでから、処理部品を組み合わせて作ります。')
  await expect(page.getByRole('button', { name: 'ひな形を使わずに処理部品で作る' })).toHaveCount(0) // ひな形がないので出さない
  await page.getByRole('button', { name: '処理部品を組み合わせて手順を作る' }).click()
  await expect(page.getByTestId('file-input').first()).toBeAttached()
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
