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
/** 改善診断（開始方法とは別に持つ）。AI改善診断・簡易チェックはどちらも開発中 */
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
export type Screen = 'start' | 'describe' | 'data' | 'define' | 'assign' | 'edit' | 'result'

export function stepOfScreen(screen: Screen): StepId | null {
  switch (screen) {
    case 'start':
      return null
    case 'describe':
      return 'describe'
    case 'data':
    case 'define':
    case 'assign': // 保存した手順に今回のファイルを割り当て、列を照合する（読込後の最終確認）
      return 'data'
    case 'edit':
      return 'procedure'
    case 'result':
      return 'run'
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
  const current = stepOfScreen(screen)
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
