import { describe, expect, it } from 'vitest'
import { demoStepIndex, demoStepViews, modeFromParam, positionOf, START_PARAM, stepOrder, stepViews } from './journey'
import type { Facts } from './journey'

const none: Facts = { described: false, dataReady: false, procedureReady: false, ran: false, outputDone: false }
const states = (v: ReturnType<typeof stepViews>) => v.map((s) => `${s.label}:${s.state}`)

describe('開始方法と段階の順番', () => {
  it('作業起点・Excel起点・保存した手順で、表示の順番が変わる（段階のIDは共通）', () => {
    expect(stepOrder('WORK_FIRST')).toEqual(['describe', 'procedure', 'data', 'run', 'output'])
    expect(stepOrder('WORK_FIRST', 'parts_from_data')).toEqual(['describe', 'data', 'procedure', 'run', 'output'])
    expect(stepOrder('FILE_FIRST')).toEqual(['data', 'describe', 'procedure', 'run', 'output'])
    expect(stepOrder('SAVED_WORKFLOW')).toEqual(['describe', 'procedure', 'data', 'run', 'output'])
    for (const m of ['WORK_FIRST', 'FILE_FIRST', 'SAVED_WORKFLOW'] as const) expect([...stepOrder(m)].sort()).toEqual(['data', 'describe', 'output', 'procedure', 'run'])
  })

  it('URL の ?start= と開始方法を行き来できる。知らない値は開始方法なし（開始画面）', () => {
    for (const m of ['WORK_FIRST', 'FILE_FIRST', 'SAVED_WORKFLOW'] as const) expect(modeFromParam(START_PARAM[m])).toBe(m)
    expect(modeFromParam(null)).toBeNull()
    expect(modeFromParam('other')).toBeNull()
  })
})

describe('段階の表示', () => {
  it('作業起点：説明を入れるまで「作業を伝える」は今の段階で、ほかは未完了', () => {
    expect(states(stepViews('WORK_FIRST', 'describe', none))).toEqual(['作業を伝える:current', '手順を確認する:todo', 'データを読み込む:todo', '実行・品質確認:todo', '出力・保存:todo'])
  })

  it('作業起点で「Excelを読み込んで作る」：説明は完了、データを読み込む段階が今', () => {
    const v = stepViews('WORK_FIRST', 'data', { ...none, described: true }, 'parts_from_data')
    expect(states(v)).toEqual(['作業を伝える:done', 'データを読み込む:current', '手順を確認する:todo', '実行・品質確認:todo', '出力・保存:todo'])
  })

  it('未完了の段階を、完了として表示しない（今より前でも、終えていなければ未完了）', () => {
    // 作業の説明をしていないのに、手順の画面にいる（例：段階を飛ばした）
    const v = stepViews('WORK_FIRST', 'edit', none)
    expect(v.find((s) => s.id === 'describe')?.state).toBe('todo')
    expect(v.find((s) => s.id === 'procedure')?.state).toBe('current')
  })

  it('保存した手順：作業の説明は不要（理由つき）。割当の画面はデータを読み込む段階', () => {
    const v = stepViews('SAVED_WORKFLOW', 'assign', { ...none, procedureReady: true })
    expect(v[0]).toMatchObject({ id: 'describe', state: 'skipped' })
    expect(v[0].reason).toContain('保存した手順を使う')
    expect(states(v).slice(1)).toEqual(['手順を確認する:done', 'データを読み込む:current', '実行・品質確認:todo', '出力・保存:todo'])
  })

  it('Excel起点：作業の説明をしないまま手順に進んだら「省略」（AIが開発中のため）と示す', () => {
    const v = stepViews('FILE_FIRST', 'edit', { ...none, dataReady: true })
    expect(v.map((s) => s.state)).toEqual(['done', 'skipped', 'current', 'todo', 'todo'])
    expect(v[1].reason).toContain('開発中')
  })

  it('手順の画面：データを読み込み済みで全ステップが設定完了なら、今の段階は「実行・品質確認」', () => {
    const ready = { ...none, described: true, dataReady: true, procedureReady: true }
    expect(states(stepViews('WORK_FIRST', 'edit', ready))).toEqual(['作業を伝える:done', '手順を確認する:done', 'データを読み込む:done', '実行・品質確認:current', '出力・保存:todo'])
    // データを読み込む前（STEP 2）は「手順を確認する」のまま
    expect(stepViews('WORK_FIRST', 'edit', { ...ready, dataReady: false }).find((s) => s.state === 'current')?.id).toBe('procedure')
  })

  it('現在の位置を「STEP n / 5」で示す。今の段階がなければ出さない', () => {
    expect(positionOf(stepViews('WORK_FIRST', 'edit', { ...none, described: true }))).toBe('STEP 2 / 5')
    expect(positionOf([])).toBeUndefined()
  })

  it('STEP 5（出力・保存）の画面は「出力・保存」の段階。実行を終えていれば、実行・品質確認は完了', () => {
    const v = stepViews('WORK_FIRST', 'output', { described: true, dataReady: true, procedureReady: true, ran: true, outputDone: false })
    expect(states(v)).toEqual(['作業を伝える:done', '手順を確認する:done', 'データを読み込む:done', '実行・品質確認:done', '出力・保存:current'])
  })

  it('実行・出力を終えたら完了になる', () => {
    const v = stepViews('FILE_FIRST', 'result', { described: true, dataReady: true, procedureReady: true, ran: true, outputDone: true })
    expect(v.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'done'])
  })
})

describe('デモの段階（業務を知るところから始める）', () => {
  it('最初は「作業を知る」。名前はデモ用、順番は固定', () => {
    const v = demoStepViews('demo_intro', 0)
    expect(v.map((x) => x.label)).toEqual(['作業を知る', '手順と改善を確認', 'データを確認', '実行・品質確認', '結果を確認'])
    expect(v.map((x) => x.state)).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
  })

  it('実行・品質確認は作業手順の画面、結果は結果の画面', () => {
    expect(demoStepIndex('edit')).toBe(3)
    expect(demoStepIndex('result')).toBe(4)
    expect(demoStepIndex('data')).toBeNull()
  })

  it('前の段階へ戻っても、進んだことのある段階は完了のまま', () => {
    expect(demoStepViews('demo_improve', 4).map((x) => x.state)).toEqual(['done', 'current', 'done', 'done', 'done'])
  })
})
