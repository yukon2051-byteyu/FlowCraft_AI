import { describe, expect, it } from 'vitest'
import type { CriterionResult, RunSummary, StepRun, Verdict } from '../api/flows'
import { createFlow } from './ops'
import { causeGroups, outputState, OFFICIAL_EXPORT_LABEL, REPORT_EXPORT_LABEL } from './outputState'

const verdict = (v: Verdict['verdict'], exp: Verdict['export'], reasons: string[] = []): Verdict => ({ verdict: v, standard_only: false, headline: '', reasons, export: exp, counts: {} })
const node = (id: string, name: string, status = 'ok', issues: StepRun['issues'] = []): StepRun => ({
  node_id: id, node_type: 'join', node_name: name, status, input_rows: [], output_rows: 1, added_columns: [], removed_columns: [], issues, duration_ms: 1,
})
const crit = (over: Partial<CriterionResult>): CriterionResult => ({
  criterion_id: 'c1', name: '照合できない商品コードが0件', kind: 'all_matched', on_fail: 'critical', status: 'failed', summary: '照合できない行が6行あります（許容 0行）。',
  evidence: {}, examples: [], how_to_fix: null, ...over,
})
const run = (over: Partial<RunSummary>): RunSummary => ({
  run_id: 'r', status: 'warning', can_export: false, engine_version: '', flow_hash: '', executed_at: '', duration_ms: 1, nodes: [], flow_issues: [], outputs: [],
  fingerprints: {}, criteria: [], run_parameters: {}, verdict: verdict('normal', 'allowed'), ...over,
})

// 商品マスタ照合の異常デモの実際の結果（2026-11-17 にサーバーで実行して確認した値）
const unmatched = {
  code: 'UNMATCHED_RECORDS', severity: 'warning', message: '元の表に照合できなかった行があります', cause: null, how_to_fix: null,
  details: {
    unmatched_rows: 6, blank_key_rows: 0,
    unmatched_keys: ['P-1099', 'P-2001', 'P-1026 ', 'P-1019 ', 'Ｐ－１０２３', 'Ｐ－１００２'],
    cause_candidates: [
      { code: 'TRIM', label: '前後の空白を取り除けば一致', rows: 2, count: 2, examples: ['P-1026 ', 'P-1019 '], how_to_fix: '前後の空白を取り除いてください。' },
      { code: 'WIDTH', label: '全角・半角をそろえれば一致', rows: 2, count: 2, examples: ['Ｐ－１０２３', 'Ｐ－１００２'], how_to_fix: '全角・半角をそろえてください。' },
    ],
  },
}
const productMatch = run({
  verdict: verdict('critical', 'report_only', ['重大とした完了基準を満たしていません：「照合できない商品コードが0件」']),
  nodes: [node('n3', '商品マスタと照合して商品名・カテゴリを付け加える', 'warning', [unmatched])],
  criteria: [
    crit({
      evidence: { 照合できない行: '6', 許容件数: '0', '原因：前後の空白（取り除けば一致）': '2行', '原因：全角・半角の違い（そろえれば一致）': '2行', '原因：相手の表（マスタ）にない値': '2行' },
      examples: [1, 2, 3, 4, 5].map((i) => ({ 照合できないキー: `「k${i}」` })),
      how_to_fix: '原因ごとに直してください。',
    }),
  ],
})
const flow = (() => {
  const f = createFlow('架空の照合')
  f.nodes = [{ node_id: 'n3', node_type: 'join', node_name: '照合', parameters: {}, input_references: [], output_reference: 'joined', confirmation_status: 'confirmed', open_questions: [] }]
  f.completion_criteria.items = [{ criterion_id: 'c1', rule_id: 'r1', rule_version: 1, name: '照合できない商品コードが0件', kind: 'all_matched', target: { ref: 'joined' }, on_fail: 'critical' }]
  return f
})()

describe('出力可否（どの入口でも同じ判定）', () => {
  it('重大な基準1つ：実際の数を使った見出し・調査用レポートのボタン名。実行と検証は最後まで終わった', () => {
    expect(outputState(productMatch)).toEqual({
      mode: 'stopped', exportLabel: REPORT_EXPORT_LABEL, headline: '照合漏れ6行・正式出力停止', reasons: ['照合できない行が6行あります（許容 0行）。'], completed: true,
    })
  })

  it('重大な基準が複数：共通の見出しと、直下に理由を並べる', () => {
    const s = outputState(run({
      verdict: verdict('critical', 'report_only'),
      criteria: [crit({}), crit({ criterion_id: 'c2', name: '伝票番号が重複しない', kind: 'unique', summary: '重複が4行あります。', evidence: { 重複している行: '4行' } })],
    }))
    expect(s.headline).toBe('重大な品質異常を検出・正式出力停止')
    expect(s.reasons).toEqual(['照合できない商品コードが0件：照合できない行が6行あります（許容 0行）。', '伝票番号が重複しない：重複が4行あります。'])
  })

  it('重複・対象期間外も、実際の数で短く示す', () => {
    const one = (c: Partial<CriterionResult>) => outputState(run({ verdict: verdict('critical', 'report_only'), criteria: [crit(c)] })).headline
    expect(one({ kind: 'unique', evidence: { 重複している行: '4行' } })).toBe('重複4行・正式出力停止')
    expect(one({ kind: 'period', evidence: { 期間外の件数: '3' } })).toBe('対象期間外3件・正式出力停止')
    expect(one({ kind: 'no_blank', name: '金額に空欄がない', evidence: {} })).toBe('「金額に空欄がない」を満たしていない・正式出力停止')
  })

  it('処理が止まったとき・必要な確認ができないときも止める（実行と検証は終わっていない／終わった）', () => {
    const failed = outputState(run({ status: 'failed', verdict: verdict('critical', 'report_only'), nodes: [node('n1', '読み込む'), node('n2', '照合', 'error')] }))
    expect(failed).toMatchObject({ mode: 'stopped', headline: '処理が途中で止まりました・正式出力停止', reasons: ['ステップ2「照合」で止まりました'], completed: false })
    expect(outputState(run({ verdict: verdict('unverified', 'report_only', ['必須の基準を確かめられませんでした']) }))).toMatchObject({ mode: 'stopped', headline: '必要な確認ができず・正式出力停止' })
  })

  it('正常・注意（確認したうえで出力）は、通常の「Excelに出力」に戻す', () => {
    expect(outputState(run({ status: 'success' }))).toEqual({ mode: 'allowed', exportLabel: OFFICIAL_EXPORT_LABEL, headline: null, reasons: [], completed: true })
    expect(outputState(run({ verdict: verdict('caution', 'needs_confirmation') }))).toMatchObject({ mode: 'confirm', exportLabel: OFFICIAL_EXPORT_LABEL, headline: null })
  })
})

describe('原因と対応（実行結果から作る）', () => {
  it('照合漏れ6行を、前後の空白2行・全角半角2行・マスタ未登録2行に分け、原因ごとに例と直し方を付ける', () => {
    const [g] = causeGroups(productMatch, flow)
    expect(g).toMatchObject({ title: '照合できない商品コードが0件', severity: 'critical', total: 6, unit: '行' })
    expect(g.items).toEqual([
      { label: '前後の空白', rows: 2, fix: '前後の空白を取り除いてください。', examples: ['P-1026 ', 'P-1019 '] },
      { label: '全角・半角の違い', rows: 2, fix: '全角・半角をそろえてください。', examples: ['Ｐ－１０２３', 'Ｐ－１００２'] },
      { label: 'マスタ未登録（相手の表にない値）', rows: 2, fix: 'マスタへの登録漏れか、コードの誤りを確認してください。', examples: ['P-1099', 'P-2001'] },
    ])
    expect(g.items.reduce((s, i) => s + (i.rows ?? 0), 0)).toBe(g.total) // 内訳の合計は全体と一致する
    expect(g.examples).toHaveLength(5) // 例は6行中5行（全件数と表示件数を画面で分けて示す）
  })

  it('照合以外の基準は、要約・直し方・例・全件数をそのまま使う。注意は重大の後ろ。満たした基準は出さない', () => {
    const groups = causeGroups(run({
      verdict: verdict('critical', 'report_only'),
      criteria: [
        crit({ criterion_id: 'a', kind: 'row_count', on_fail: 'caution', name: '件数', summary: '件数が範囲外です。' }),
        crit({ criterion_id: 'b', kind: 'unique', name: '伝票番号が重複しない', summary: '重複が4行あります。', evidence: { 重複している行: '4行' }, examples: [{ キー: 'M-1' }], how_to_fix: '重複を確かめてください。' }),
        crit({ criterion_id: 'c', kind: 'no_blank', status: 'passed' }),
      ],
    }), createFlow('架空'))
    expect(groups.map((g) => [g.title, g.severity, g.total])).toEqual([['伝票番号が重複しない', 'critical', 4], ['件数', 'caution', null]])
    expect(groups[0]).toMatchObject({ fix: '重複を確かめてください。', items: [] })
  })

  it('処理が止まったときは、止まったステップのお知らせと直し方を先に示す', () => {
    const groups = causeGroups(run({
      status: 'failed',
      nodes: [node('n1', '読み込む'), node('n2', '合計する', 'error', [{ code: 'X', severity: 'error', message: '列「金額」がありません', cause: null, how_to_fix: '列名を確かめてください。', details: {} }])],
    }), createFlow('架空'))
    expect(groups).toEqual([expect.objectContaining({ title: 'ステップ2「合計する」で止まりました', summary: '列「金額」がありません', fix: '列名を確かめてください。' })])
  })
})
