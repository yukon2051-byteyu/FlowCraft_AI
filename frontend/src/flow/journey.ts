/*
 * 作業の進め方（開始方法と段階）。画面から切り離した純粋な関数（単体テストで確かめる）。
 *
 * 内部では共通の段階ID（describe・procedure・data・run・output）を使い、開始方法によって**表示の順番だけ**を変える。
 * 処理エンジン・品質検証は開始方法によって分けない（どの開始方法でも、同じ作業手順・同じ実行・同じ検証を使う）。
 *
 *   WORK_FIRST（やりたい作業から始める）：作業を伝える → 手順を確認する → データを読み込む → 実行・品質確認 → 出力・保存
 *     ただし手順を「Excelを読み込んで列を確かめながら」作るときは、データを読み込む → 手順を確認する の順になる
 *   FILE_FIRST（Excelを読み込んで始める）：データを読み込む → 作業を伝える → 手順を確認する → 実行・品質確認 → 出力・保存
 *   SAVED_WORKFLOW（保存した手順を使う）：手順を確認する → データを読み込む → 実行・品質確認 → 出力・保存（作業を伝えるは不要）
 *
 * 段階の完了は、実際に終えた事実（facts）から1つずつ決める。未完了の段階を完了として表示しない。
 */

export type StepId = 'describe' | 'procedure' | 'data' | 'run' | 'output'
export type StartMode = 'WORK_FIRST' | 'FILE_FIRST' | 'SAVED_WORKFLOW'
/** 作業手順の作り方（作業起点）。ai は開発中 */
export type BuildMethod = 'parts_from_data' | 'template' | 'ai'
/** 改善診断（開始方法とは別に持つ）。AIで業務を改善する（AI改善診断）は開発中。AIを使わない簡易チェックは廃止（2026-11-16） */
export type DiagnosisState = 'unselected' | 'chosen' | 'done' | 'skipped'

export const STEP_LABEL: Record<StepId, string> = {
  describe: '作業を伝える',
  procedure: '手順を確認する',
  data: 'データを読み込む',
  run: '実行・品質確認',
  output: '出力・保存',
}

/** URL の ?start= の値 */
export const START_PARAM: Record<StartMode, string> = { WORK_FIRST: 'work', FILE_FIRST: 'file', SAVED_WORKFLOW: 'saved' }

export function modeFromParam(v: string | null): StartMode | null {
  const hit = (Object.keys(START_PARAM) as StartMode[]).find((m) => START_PARAM[m] === v)
  return hit ?? null
}

export function stepOrder(mode: StartMode, method: BuildMethod | null = null): StepId[] {
  if (mode === 'FILE_FIRST') return ['data', 'describe', 'procedure', 'run', 'output']
  if (mode === 'SAVED_WORKFLOW') return ['describe', 'procedure', 'data', 'run', 'output']
  return method === 'parts_from_data' ? ['describe', 'data', 'procedure', 'run', 'output'] : ['describe', 'procedure', 'data', 'run', 'output']
}

/** 画面（WorkspacePage の Screen）→ その画面で行っている段階 */
export type Screen = 'start' | 'describe' | 'data' | 'define' | 'assign' | 'edit' | 'result' | 'output' | 'demo_intro' | 'demo_improve' | 'demo_data'

export function stepOfScreen(screen: Screen): StepId | null {
  switch (screen) {
    case 'start':
      return null
    case 'describe':
    case 'demo_intro':
      return 'describe'
    case 'demo_improve':
      return 'procedure'
    case 'demo_data':
      return 'data'
    case 'data':
    case 'define':
    case 'assign': // 保存した手順に今回のファイルを割り当て、列を照合する（読込後の最終確認）
      return 'data'
    case 'edit':
      return 'procedure'
    case 'result':
      return 'run'
    case 'output': // STEP 5：Excelの出力・作業手順の保存（STEP 4 の実行結果を使う。再実行しない）
      return 'output'
  }
}

/** 実際に終えたこと（段階の完了を決める事実） */
export type Facts = {
  /** 作業の説明（案件名）を入れた */
  described: boolean
  /** 作業手順の入力に、今回のファイルを割り当てた（読込後の確認まで終えた） */
  dataReady: boolean
  /** 処理ステップがあり、すべて確認済み */
  procedureReady: boolean
  /** 全体を実行した（結果がある） */
  ran: boolean
  /** Excelに出力した、または保存した */
  outputDone: boolean
}

export type StepView = { id: StepId; label: string; state: 'done' | 'current' | 'todo' | 'skipped'; reason?: string }

/** 段階ごとの表示（順番は開始方法で決まる。完了は事実から1つずつ決める） */
export function stepViews(mode: StartMode, screen: Screen, facts: Facts, method: BuildMethod | null = null): StepView[] {
  // 手順の画面は、データを読み込み済みで全ステップが設定完了なら「実行・品質確認」を行う画面になる（実行ボタンがある）
  const current = screen === 'edit' && facts.dataReady && facts.procedureReady ? 'run' : stepOfScreen(screen)
  return stepOrder(mode, method).map((id) => {
    const label = STEP_LABEL[id]
    if (id === 'describe' && mode === 'SAVED_WORKFLOW') return { id, label, state: 'skipped', reason: '保存した手順を使うため、作業の説明は不要です' }
    if (id === 'describe' && mode === 'FILE_FIRST' && !facts.described && current !== 'describe') {
      return { id, label, state: 'skipped', reason: '作業の名前・目的は入力していません（任意。AIで作業を伝える機能は開発中です）' }
    }
    if (id === current) return { id, label, state: 'current' }
    const done = { describe: facts.described, data: facts.dataReady, procedure: facts.procedureReady, run: facts.ran, output: facts.outputDone }[id]
    return { id, label, state: done ? 'done' : 'todo' }
  })
}

/** 現在の段階の位置（例：「STEP 2 / 5」）。現在の段階がなければ undefined */
export function positionOf(views: StepView[]): string | undefined {
  const at = views.findIndex((v) => v.state === 'current')
  return at >= 0 ? `STEP ${at + 1} / ${views.length}` : undefined
}

/*
 * デモの段階（デモ全面改善指示書）。デモは「業務を知る」から始め、決まった順番で進む：
 *   作業を知る → 手順と改善を確認 → データを確認 → 実行・品質確認 → 結果を確認
 * 画面は、作業を知る（demo_intro）・手順と改善（demo_improve）・データ（demo_data）だけがデモ専用で、
 * 実行・品質確認（edit）と結果（result）は通常の作業手順の画面をそのまま使う（処理エンジン・品質検証は共通）。
 * 通常の利用の段階の名前・順番は変えない（stepViews）。
 */
export const DEMO_STEP_ORDER: StepId[] = ['describe', 'procedure', 'data', 'run', 'output']
export const DEMO_STEP_LABEL: Record<StepId, string> = {
  describe: '作業を知る',
  procedure: '手順と改善を確認',
  data: 'データを確認',
  run: '実行・品質確認',
  output: '結果を確認',
}

/** デモの画面 → 段階の位置（0〜4）。デモで使わない画面は null */
export function demoStepIndex(screen: Screen): number | null {
  const at: Partial<Record<Screen, number>> = { demo_intro: 0, demo_improve: 1, demo_data: 2, edit: 3, result: 4 }
  return at[screen] ?? null
}

/**
 * デモの段階の表示。visited は、これまでに進んだ最も先の段階の位置。
 * 前の段階へ戻っても、進んだことのある段階は「完了」のまま（戻っても状態を初期化しない）。
 */
export function demoStepViews(screen: Screen, visited: number): StepView[] {
  const cur = demoStepIndex(screen) ?? 0
  return DEMO_STEP_ORDER.map((id, i) => ({
    id,
    label: DEMO_STEP_LABEL[id],
    state: i === cur ? 'current' : i < cur || i <= visited ? 'done' : 'todo',
  }))
}
