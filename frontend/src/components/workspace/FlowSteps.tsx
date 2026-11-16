import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleCheck, CornerDownRight, LoaderCircle, Play, Plus, ScanSearch, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { fieldOf, runAndRecord, stepIndexOf, validateFlow } from '../../api/flows'
import type { RunSummary } from '../../api/flows'
import { ErrorNotice } from '../ui/ErrorNotice'
import { inputSlotLabel, STEP_GROUPS, STEP_TYPES } from '../../flow/catalog'
import { contentSnapshot, dataChoices, snapshot, UNSELECTED, usedBy } from '../../flow/ops'
import { inferColumns, paramProblems, summarize } from '../../flow/params'
import type { FlowDoc } from '../../flow/types'
import { StepSettings } from './StepSettings'
import { CriteriaPanel } from './CriteriaPanel'
import { criterionProblems } from '../../flow/criteria'
import { useFlowStore } from '../../flow/store'
import type { FlowNode, NodeType } from '../../flow/types'
import { isAvailable } from '../../content/featureStatus'
import { Button } from '../ui/Button'
import { DevBadge } from '../ui/DevBadge'
import { ItemActionButton, ItemStatusBadge } from '../ui/ItemStatusBadge'
import { countStatus, deriveStatus, statusStripe } from '../../flow/stepStatus'
import type { ItemStatus } from '../../flow/stepStatus'

/**
 * タスク1-3：作業手順の処理ステップを、上から順に縦に並べて表示する。
 * 追加・削除・上下の移動ができ、各ステップの「使うデータ」と「この結果を使うステップ」を示す。
 * つながりを壊す操作は行わず、理由をそのステップのすぐ下に表示する。
 * 各ステップの細かい設定（列・条件など）はタスク1-4・1-5で作る。
 */
const RUN_PARAM_PLACEHOLDER: Record<string, string> = { month: '2026-10', date: '2026-10-01', integer: '例 1000', decimal: '例 12.5', string: '' }

export function FlowSteps({
  onBack,
  onNext,
  position,
  onRan,
  backLabel = '使う列と形式の設定に戻る',
  onShowResult,
}: {
  /** 前の画面へ戻る（補助操作）。手順の確認だけを行う画面（onNext あり）では渡さない */
  onBack?: () => void
  /**
   * 手順の確認だけを行う画面（データをまだ読み込んでいない STEP 2）で、次のデータの読み込みへ進む。
   * 渡したときは、主要ボタンを「次へ：データを読み込む」だけにし、実行ボタンは出さない（実行は STEP 4 で行う）
   */
  onNext?: () => void
  /** 現在の位置（例：STEP 2 / 5）。主要ボタンの横に小さく出す */
  position?: string
  onRan: (run: RunSummary, snap: string) => void
  /** 戻るボタンの文言（保存した作業手順を開いたときは「ファイルの割当に戻る」） */
  backLabel?: string
  /** 前回の実行結果を、実行し直さずに見る（実行結果があるときだけ渡す） */
  onShowResult?: () => void
}) {
  const flow = useFlowStore((s) => s.flow)
  const selectedId = useFlowStore((s) => s.selectedNodeId)
  const selectNode = useFlowStore((s) => s.selectNode)
  const addStep = useFlowStore((s) => s.addStep)
  // どこに追加するか（ステップのID＝その下、'end'＝最後、null＝閉じている）
  const [addAt, setAddAt] = useState<string | 'end' | null>(null)
  const labels = Object.fromEntries(flow.input_definitions.map((d) => [d.input_id, d.label]))
  const hasOutput = flow.nodes.some((n) => n.node_type === 'output')

  const add = (type: NodeType) => {
    addStep(type, addAt === 'end' ? null : addAt)
    setAddAt(null)
  }

  // 各ステップで使える列と、設定の不足（画面ですぐに判定）
  const columns = inferColumns(flow)
  const inputsOf = (node: FlowNode) => node.input_references.map((r) => columns[r] ?? null)
  const problems = Object.fromEntries(flow.nodes.map((n) => [n.node_id, paramProblems(n, inputsOf(n))]))
  const check = useServerCheck(flow)
  // サーバーの指摘は、画面の判定で不足がないステップにだけ表示する（設定途中の「項目がありません」を並べないため）
  const serverProblems = (node: FlowNode, i: number) =>
    problems[node.node_id].length ? [] : [...(check.byIndex[i] ?? []), ...(check.byNode[node.node_id] ?? [])]
  const bindings = useFlowStore((s) => s.bindings)
  const [runError, setRunError] = useState<ApiErrorBody | null>(null)
  const runMutation = useMutation({
    mutationFn: () => runAndRecord(flow, Object.values(bindings), runValues),
    onMutate: () => setRunError(null),
    onSuccess: (run) => onRan(run, contentSnapshot(flow)),
    onError: (e) => setRunError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '実行できませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }),
  })
  const [view, setView] = useState<'steps' | 'criteria'>('steps')
  const runValues = useFlowStore((s) => s.runValues)
  const setRunValues = useFlowStore((s) => s.setRunValues)
  // 開いている完了基準（画面下部の「修正箇所を見る」からも開けるように、ここで持つ）
  const [openCriterion, setOpenCriterion] = useState<string | null>(null)
  // 「修正箇所を見る」で移動したカードを、少しの間だけ強調する
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1800)
    return () => clearTimeout(t)
  }, [flashId])
  const goStep = (id: string) => {
    setView('steps')
    selectNode(id)
    setFlashId(id)
  }
  const goCriterion = (id: string) => {
    setView('criteria')
    setOpenCriterion(id)
    setFlashId(id)
  }

  // 処理ステップの状態（カードの表示と同じ判定）
  const reasonsOf = (n: FlowNode, i: number) => [...problems[n.node_id], ...serverProblems(n, i)]
  const statuses = flow.nodes.map((n, i) => deriveStatus(problems[n.node_id], serverProblems(n, i), n.confirmation_status === 'confirmed'))
  const counts = countStatus(statuses)
  const stepLine = `${flow.nodes.length}ステップ中${counts.ready}ステップ設定完了`
  // 直す必要があるステップ（未設定・エラーを先に、要確認を後に）
  const stepBlockers: Blocker[] = [
    ...flow.nodes.flatMap((n, i) =>
      statuses[i] === 'needs_setting' || statuses[i] === 'error' ? [{ label: `ステップ${i + 1}「${n.node_name}」`, reason: `不足：${reasonsOf(n, i)[0]}`, go: () => goStep(n.node_id) }] : [],
    ),
    ...flow.nodes.flatMap((n, i) =>
      statuses[i] === 'needs_review' ? [{ label: `ステップ${i + 1}「${n.node_name}」`, reason: '内容を確かめて、設定完了にしてください', go: () => goStep(n.node_id) }] : [],
    ),
  ]
  // 完了基準の設定が終わっていない（サーバーも実行を止める）。重大の基準を先に直してもらう
  const rank = { critical: 0, caution: 1, record: 2 } as const
  const criteriaBlockers: Blocker[] = flow.completion_criteria.items
    .map((c) => ({ c, problems: criterionProblems(c, flow) }))
    .filter((x) => x.problems.length > 0)
    .sort((a, b) => rank[a.c.on_fail] - rank[b.c.on_fail])
    .map(({ c, problems: ps }) => ({ label: `完了基準「${c.name}」`, reason: `不足：${ps[0]}`, go: () => goCriterion(c.criterion_id) }))
  const missingValues = flow.run_parameters.filter((p) => p.required !== false && !(runValues[p.param_id] ?? '').trim())
  // ファイルを割り当てていない入力（保存した作業手順を、割り当てずに開いたとき）
  const unassigned = flow.input_definitions.filter((d) => !bindings[d.input_id]).length
  // 実行を止めている理由。直す順（ファイル → 完了基準 → 処理ステップ → 実行時の値 → 全体のチェック）
  const blockers: Blocker[] = [
    ...(unassigned
      ? [{ label: 'ファイルの割当', reason: `ファイルを割り当てていない入力が${unassigned}つあります（「${backLabel.replace(/に戻る$/, '')}」で割り当てます）`, go: onBack ?? null }]
      : []),
    ...criteriaBlockers,
    ...stepBlockers,
    ...missingValues.map((p) => ({
      label: `実行時に指定する値「${p.label}」`,
      reason: '画面右下の入力欄に入力してください',
      go: () => document.getElementById(`run-param-${p.param_id}`)?.focus(),
    })),
    ...(check.status === 'done' ? check.general.map((g) => ({ label: '作業手順のチェック', reason: g, go: null })) : []),
  ]
  const runBlocker =
    flow.nodes.length === 0
      ? '処理ステップがありません'
      : blockers.length
        ? `${blockers[0].label}　${blockers[0].reason}`
        : check.status !== 'done'
          ? '作業手順のチェックが終わるまでお待ちください'
          : null
  const footer = footerStatus({ procedureOnly: !!onNext, check, nodeCount: flow.nodes.length, counts, stepLine, unassigned, blockers, stepBlockers })
  const stepName = (ref: string) => {
    const at = flow.nodes.findIndex((n) => n.output_reference === ref)
    return at >= 0 ? `ステップ${at + 1}の結果：${flow.nodes[at].node_name}` : '（まだ選んでいません）'
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 「何をする？」（処理ステップ）と「何を満たせば完了？」（完了基準）は別の欄（docs/completion-criteria.md §1） */}
        <div className="mx-auto flex max-w-[1100px] gap-1 px-6 pt-5" role="tablist" aria-label="作業手順の内容">
          {(
            [
              ['steps', `何をする？（処理ステップ ${flow.nodes.length}）`],
              ['criteria', `何を満たせば完了？（完了基準 ${flow.completion_criteria.items.length}）`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-[0.9rem] font-bold ring-1 ${view === v ? 'bg-mint text-on-mint ring-mint' : 'text-subtle ring-edge hover:text-white'}`}
            >
              {label}
            </button>
          ))}
          <p className="ml-3 self-center text-[0.88rem] text-subtle">
            {view === 'steps' ? 'Excel・CSVに対して行う処理を、上から順に設定します' : '処理結果が業務上正しいかを判断する基準です。実行のたびに自動で確かめます'}
          </p>
        </div>
        {view === 'criteria' ? (
          <div className="pt-5">
            <CriteriaPanel openId={openCriterion} onOpen={setOpenCriterion} flashId={flashId} />
          </div>
        ) : (
        <div className="mx-auto max-w-[1100px] px-6 pt-6 pb-12">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[1.5rem] font-bold text-white">作業手順</h1>
              <p className="mt-1 text-[0.9rem] text-subtle">各ステップは、それより上のステップの結果だけを使えます。</p>
            </div>
            {/* 自動化の途中から、作業の見直し（AI業務改善診断）へ切り替える入口。作った手順はそのまま残す */}
            <div className="flex items-center gap-2">
              <Button
                variant="outlineDark"
                size="sm"
                disabled={!isAvailable('kaizen')}
                title={isAvailable('kaizen') ? undefined : 'AI業務改善診断は開発中です。使えるようになっても、作った手順はそのまま残ります'}
              >
                <ScanSearch className="size-4" aria-hidden />
                この作業を見直す
              </Button>
              <DevBadge feature="kaizen" />
            </div>
          </div>

          <ol className="space-y-3" aria-label="処理ステップ">
            {flow.nodes.map((node, i) => (
              <li key={node.node_id}>
                <StepCard
                  node={node}
                  index={i}
                  nodes={flow.nodes}
                  labels={labels}
                  summary={summarize(node)}
                  reasons={reasonsOf(node, i)}
                  status={statuses[i]}
                  flash={flashId === node.node_id}
                  onJump={goStep}
                  selected={node.node_id === selectedId}
                  onSelect={() => selectNode(node.node_id)}
                  onCollapse={() => selectNode(null)}
                  onAddBelow={() => setAddAt(addAt === node.node_id ? null : node.node_id)}
                  canAddBelow={node.node_type !== 'output'}
                />
                {/* 選んだステップだけ、カードの真下に設定を開く（20〜30ステップでも一覧が長くなりすぎないように） */}
                {node.node_id === selectedId && (
                  <StepSettings
                    key={node.node_id}
                    node={node}
                    index={i}
                    inputs={inputsOf(node)}
                    inputNames={node.input_references.map(stepName)}
                    problems={problems[node.node_id]}
                    serverProblems={serverProblems(node, i)}
                    definitionColumns={flow.input_definitions.find((d) => d.input_id === node.parameters.input_id)?.columns}
                  />
                )}
                {addAt === node.node_id && <AddMenu hasOutput={hasOutput} onPick={add} onClose={() => setAddAt(null)} />}
              </li>
            ))}
          </ol>

          {addAt === 'end' ? (
            <AddMenu hasOutput={hasOutput} onPick={add} onClose={() => setAddAt(null)} />
          ) : (
            <div className="rounded-2xl border border-dashed border-edge px-5 py-4">
              <Button variant="outlineDark" size="sm" onClick={() => setAddAt('end')}>
                <Plus className="size-4" aria-hidden />
                処理ステップを追加する
              </Button>
            </div>
          )}
        </div>

        </div>
        )}
      </div>

      {/* 画面下部：左に今の状態、右に主要ボタン（1画面につき主要な操作は1つ） */}
      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-2.5">
        {onBack && (
          <Button variant="ghostDark" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="size-4" aria-hidden />
            {backLabel}
          </Button>
        )}
        <FooterStatus {...footer} />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {onNext ? (
            <>
              {position && <span className="text-[0.82rem] text-subtle">{position}</span>}
              <Button variant="primary" onClick={onNext}>
                次へ：データを読み込む
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              {/* 実行するたびに指定する値（例：対象月）。完了基準の評価に使う */}
              {flow.run_parameters.map((p) => (
                <label key={p.param_id} className="flex items-center gap-1.5 text-[0.85rem] whitespace-nowrap text-subtle">
                  {p.label}
                  <input
                    value={runValues[p.param_id] ?? ''}
                    onChange={(e) => setRunValues({ ...runValues, [p.param_id]: e.target.value })}
                    placeholder={RUN_PARAM_PLACEHOLDER[p.type]}
                    id={`run-param-${p.param_id}`}
                    aria-label={`実行時に指定する値：${p.label}`}
                    className="h-8 w-32 rounded-lg bg-panel-hi px-2 text-white ring-1 ring-edge focus:ring-2 focus:ring-mint focus:outline-none"
                  />
                </label>
              ))}
              {onShowResult && (
                <Button variant="ghostDark" size="sm" onClick={onShowResult} title="実行し直さずに、前回の実行結果を表示します">
                  結果を見る（再実行しない）
                </Button>
              )}
              <Button variant="primary" disabled={runBlocker !== null || runMutation.isPending} onClick={() => runMutation.mutate()} title={runBlocker ?? undefined}>
                {runMutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                作業手順全体を実行する
              </Button>
            </>
          )}
        </div>
      </div>
      {runError && (
        <div className="shrink-0 border-t border-edge bg-nav px-6 pb-3">
          <ErrorNotice error={runError} onDismiss={() => setRunError(null)} />
        </div>
      )}
    </>
  )
}

type CardProps = {
  node: FlowNode
  index: number
  nodes: FlowNode[]
  labels: Record<string, string>
  summary: string | null
  /** 設定の不足・チェックの指摘（閉じたカードには1つ目だけを短く出す） */
  reasons: string[]
  status: ItemStatus
  /** 「修正箇所を見る」で移動してきた直後（少しの間だけ強調する） */
  flash: boolean
  /** データの流れの行から、ほかのステップへ移動する（開いて強調する） */
  onJump: (nodeId: string) => void
  selected: boolean
  onSelect: () => void
  onCollapse: () => void
  onAddBelow: () => void
  canAddBelow: boolean
}

function StepCard({ node, index, nodes, labels, summary, reasons, status, flash, onJump, selected, onSelect, onCollapse, onAddBelow, canAddBelow }: CardProps) {
  const moveNode = useFlowStore((s) => s.moveNode)
  const removeNode = useFlowStore((s) => s.removeNode)
  const setNodeInputs = useFlowStore((s) => s.setNodeInputs)
  const updateNode = useFlowStore((s) => s.updateNode)
  // 失敗した操作の理由。ステップが変わったら（番号がずれる可能性があるので）表示しない
  const [failure, setFailure] = useState<{ message: string; nodes: FlowNode[] } | null>(null)
  const error = failure && failure.nodes === nodes ? failure.message : null
  const setError = (message: string | null) => setFailure(message ? { message, nodes } : null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 開いたときは、カードの頭から設定欄が見えるように動かす
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [selected])

  const info = STEP_TYPES[node.node_type]
  const users = usedBy(nodes, index)
  const n = index + 1
  const run = (r: { ok: true } | { ok: false; error: string }) => setError(r.ok ? null : r.error)

  const changeInputs = (refs: string[]) => {
    run(setNodeInputs(node.node_id, refs))
    // 使うデータを変えたら、設定を確かめ直す必要がある
    if (node.confirmation_status === 'confirmed') updateNode(node.node_id, { confirmation_status: 'unset' })
  }

  return (
    <article
      ref={ref}
      onClick={selected ? undefined : onSelect}
      aria-label={`ステップ${n}：${node.node_name}`}
      aria-expanded={selected}
      className={`light-panel scroll-mt-3 pr-4 pl-4 ${statusStripe(status)} ${flash ? 'flash-ring' : ''} ${selected ? 'rounded-t-2xl py-3.5 ring-2 ring-mint' : 'cursor-pointer rounded-2xl py-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] hover:ring-1 hover:ring-mint/60'}`}
    >
      {/* 見出しの行：押すと開閉する（移動・追加・削除のボタンは開閉しない） */}
      <div className={`flex items-center gap-3 ${selected ? 'cursor-pointer' : ''}`} onClick={selected ? onCollapse : undefined}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[0.85rem] font-bold text-white">{n}</span>
        <h2 className="min-w-0 truncate font-bold text-ink">{node.node_name}</h2>
        {node.node_name !== info.name && <span className="shrink-0 text-[0.82rem] text-muted">{info.name}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`ステップ${n}を上へ移動`} disabled={index === 0} reason="いちばん上のステップのため、上へは動かせません" onClick={() => run(moveNode(node.node_id, index - 1))}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label={`ステップ${n}を下へ移動`} disabled={index === nodes.length - 1} reason="いちばん下のステップのため、下へは動かせません" onClick={() => run(moveNode(node.node_id, index + 1))}>
            <ArrowDown className="size-4" />
          </IconButton>
          {canAddBelow && (
            <IconButton label={`ステップ${n}の下にステップを追加`} onClick={onAddBelow}>
              <Plus className="size-4" />
            </IconButton>
          )}
          <IconButton label={`ステップ${n}を削除`} onClick={() => (setError(null), setConfirmDelete(true))}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
        <ItemStatusBadge status={status} className="ml-2 w-[5.4rem] justify-center" />
        <ItemActionButton status={status} expanded={selected} onClick={selected ? onCollapse : onSelect} name={`ステップ${n}`} />
      </div>

      {/* 閉じているときは概要だけ（処理内容・データの流れ・直すことを1行ずつ） */}
      {!selected && (
        <div className="pl-10">
          {summary && (
            <p className="mt-1 truncate text-[0.9rem] text-ink" title={summary}>
              <span className="font-bold">処理内容：</span>
              {summary}
            </p>
          )}
          <DataFlowLine nodes={nodes} index={index} labels={labels} onJump={onJump} />
          {status !== 'ready' && (
            <p className={`mt-1 truncate text-[0.85rem] font-bold ${status === 'needs_review' ? 'text-warning-ink' : status === 'error' ? 'text-error-ink' : 'text-todo-ink'}`}>
              {status === 'needs_review' ? '設定に不足はありません。内容を確かめて、設定完了にしてください' : `不足：${reasons[0]}${reasons.length > 1 ? `（ほか${reasons.length - 1}件）` : ''}`}
            </p>
          )}
        </div>
      )}
      {selected && (
        <div className="pl-10">
      {/* 使うデータ */}
      <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
        {node.node_type === 'load' ? (
          <p className="text-[0.9rem] text-muted">入力：ファイル「{labels[String(node.parameters.input_id ?? '')] ?? String(node.parameters.input_id ?? '')}」</p>
        ) : (
          <InputSelectors node={node} index={index} nodes={nodes} onChange={changeInputs} />
        )}
      </div>

      {summary && (
        <p className="mt-2 text-[0.9rem] text-ink">
          <span className="font-bold">処理内容：</span>
          {summary}
        </p>
      )}

      {node.node_type !== 'output' && (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[0.85rem] text-muted">
          <CornerDownRight className="size-4 shrink-0" aria-hidden />
          <UsedByLinks nodes={nodes} index={index} onJump={onJump} />
        </p>
      )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-[0.9rem] text-error-ink ring-1 ring-error/30">
          {error}
        </p>
      )}

      {confirmDelete &&
        (users.length ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-error-soft px-3 py-2 ring-1 ring-error/30" onClick={(e) => e.stopPropagation()}>
            <span className="text-[0.9rem] text-error-ink">
              この結果を{users.map((u) => `ステップ${u}`).join('・')}が使っているため、削除できません。先にそちらの「使うデータ」を変更してください。
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirmDelete(false)
                  onJump(nodes[users[0] - 1].node_id)
                }}
              >
                ステップ{users[0]}を開く
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                閉じる
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-3 py-2 ring-1 ring-warning/30" onClick={(e) => e.stopPropagation()}>
            <span className="text-[0.9rem] text-ink">
              ステップ{n}「{node.node_name}」を削除しますか？
              <span className="ml-1 text-[0.85rem] text-muted">このステップの設定は元に戻せません（ほかのステップへの影響はありません）。</span>
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmDelete(false)
                  run(removeNode(node.node_id))
                }}
              >
                削除する
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                やめる
              </Button>
            </div>
          </div>
        ))}

    </article>
  )
}

/**
 * データの流れを1行で：どこから受け取り（入力）、結果をどこで使うか（結果の使用先）。
 * ステップの名前を押すと、そのステップへ移動する（開いて強調する）
 */
function DataFlowLine({ nodes, index, labels, onJump }: { nodes: FlowNode[]; index: number; labels: Record<string, string>; onJump: (id: string) => void }) {
  const node = nodes[index]
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.85rem] text-muted" aria-label="データの流れ">
      <span className="flex min-w-0 shrink items-center gap-1 truncate">
        入力：
        {node.node_type === 'load' ? (
          <span>ファイル「{labels[String(node.parameters.input_id ?? '')] ?? String(node.parameters.input_id ?? '')}」</span>
        ) : (
          node.input_references.map((ref, i) => {
            const at = nodes.findIndex((x) => x.output_reference === ref)
            return (
              <span key={i} className="truncate">
                {i > 0 && '・'}
                {at >= 0 ? <StepLink n={at + 1} name={nodes[at].node_name} onClick={() => onJump(nodes[at].node_id)} /> : <span className="text-todo-ink">（未選択）</span>}
              </span>
            )
          })
        )}
      </span>
      {node.node_type !== 'output' && (
        <>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          <UsedByLinks nodes={nodes} index={index} onJump={onJump} />
        </>
      )}
    </p>
  )
}

function UsedByLinks({ nodes, index, onJump }: { nodes: FlowNode[]; index: number; onJump: (id: string) => void }) {
  const users = usedBy(nodes, index)
  if (!users.length) return <span className="truncate">結果の使用先：まだありません</span>
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      結果の使用先：
      {users.map((u, i) => (
        <span key={u} className="truncate">
          {i > 0 && '・'}
          <StepLink n={u} name={nodes[u - 1].node_name} onClick={() => onJump(nodes[u - 1].node_id)} />
        </span>
      ))}
    </span>
  )
}

function StepLink({ n, name, onClick }: { n: number; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`ステップ${n}「${name}」へ移動する`}
      className="rounded font-bold text-forest underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-forest"
    >
      ステップ{n}「{name}」
    </button>
  )
}

/** 使うデータの選択。結合は2つ、縦にまとめる・出力は2つ以上／1つ以上を選ぶ */
function InputSelectors({ node, index, nodes, onChange }: { node: FlowNode; index: number; nodes: FlowNode[]; onChange: (refs: string[]) => void }) {
  const choices = dataChoices(nodes, index)
  const [min, max] = STEP_TYPES[node.node_type].inputs
  const refs = node.input_references
  return (
    <div className="space-y-1.5">
      {refs.map((ref, slot) => (
        <div key={slot} className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[0.9rem]">
            <span className="w-28 shrink-0 font-bold text-muted">{inputSlotLabel(node.node_type, slot)}</span>
            <select
              value={ref}
              onChange={(e) => onChange(refs.map((r, i) => (i === slot ? e.target.value : r)))}
              aria-label={`ステップ${index + 1}の${inputSlotLabel(node.node_type, slot)}`}
              className={`h-8 min-w-72 rounded-lg px-2 ring-1 focus:ring-2 focus:ring-forest focus:outline-none ${ref === UNSELECTED ? 'bg-warning-soft ring-warning/50' : 'bg-card ring-line'}`}
            >
              <option value={UNSELECTED}>（選んでください）</option>
              {choices.map((c) => (
                <option key={c.ref} value={c.ref}>
                  ステップ{c.step}の結果：{c.name}
                </option>
              ))}
            </select>
          </label>
          {refs.length > min && (
            <IconButton label={`${inputSlotLabel(node.node_type, slot)}を外す`} onClick={() => onChange(refs.filter((_, i) => i !== slot))}>
              <X className="size-4" />
            </IconButton>
          )}
        </div>
      ))}
      {max > 1 && node.node_type !== 'join' && refs.length < max && (
        <Button variant="ghost" size="sm" onClick={() => onChange([...refs, UNSELECTED])}>
          <Plus className="size-4" aria-hidden />
          表を追加
        </Button>
      )}
    </div>
  )
}

function AddMenu({ hasOutput, onPick, onClose }: { hasOutput: boolean; onPick: (t: NodeType) => void; onClose: () => void }) {
  return (
    <section className="mt-3 rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="追加する処理を選ぶ">
      <div className="flex items-center">
        <h2 className="font-bold text-white">追加する処理を選んでください</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="ml-auto rounded-md p-1 text-subtle hover:text-white focus-visible:outline-2 focus-visible:outline-mint">
          <X className="size-5" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
        {STEP_GROUPS.map(({ group, label }) => (
          <div key={group}>
            <p className="mb-1.5 text-[0.8rem] font-bold tracking-wide text-subtle">{label}</p>
            <ul className="space-y-1">
              {(Object.keys(STEP_TYPES) as NodeType[])
                .filter((t) => t !== 'load' && STEP_TYPES[t].group === group)
                .map((t) => {
                  const blocked = t === 'output' && hasOutput
                  return (
                    <li key={t}>
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() => onPick(t)}
                        title={blocked ? '「Excelに出力する」は1つの作業手順に1つだけです' : undefined}
                        className="w-full rounded-lg px-3 py-1.5 text-left hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-mint disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="block font-bold text-white">{STEP_TYPES[t].name}</span>
                        <span className="block text-[0.82rem] text-subtle">例：{STEP_TYPES[t].example}</span>
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[0.82rem] text-subtle">ファイルを追加するときは、「使う列と形式の設定に戻る」から読み込んでください。</p>
    </section>
  )
}

function IconButton({ label, disabled, reason, onClick, children }: { label: string; disabled?: boolean; reason?: string; onClick: () => void; children: ReactNode }) {
  // 押せないボタンはマウスを重ねても説明が出ないことがあるため、外側の要素に理由を付ける
  if (disabled && reason) {
    return (
      <span title={reason} className="inline-flex">
        <IconButton label={label} disabled onClick={onClick}>
          {children}
        </IconButton>
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/* ---------- 作業手順のチェック（サーバー） ---------- */

type ServerCheck = {
  status: 'checking' | 'done' | 'failed'
  /** 形の誤り（ステップの番号ごと） */
  byIndex: Record<number, string[]>
  /** つながりの誤り（ステップのIDごと） */
  byNode: Record<string, string[]>
  /** ステップに結び付かない誤り */
  general: string[]
}

/** 入力が落ち着いてから（0.4秒）サーバーで作業手順をチェックする */
function useServerCheck(flow: FlowDoc): ServerCheck {
  const [settled, setSettled] = useState(flow)
  useEffect(() => {
    const t = setTimeout(() => setSettled(flow), 400)
    return () => clearTimeout(t)
  }, [flow])
  const q = useQuery({ queryKey: ['validate', snapshot(settled)], queryFn: () => validateFlow(settled) })
  const byIndex: Record<number, string[]> = {}
  const byNode: Record<string, string[]> = {}
  const general: string[] = []
  for (const e of q.data?.schema_errors ?? []) {
    const i = stepIndexOf(e.location)
    if (i === null) general.push(e.message)
    else (byIndex[i] ??= []).push(`作業手順のチェック：${e.message}（${fieldOf(e.location) || '設定'}）`)
  }
  for (const issue of q.data?.issues ?? []) {
    if (issue.severity !== 'error') continue
    if (issue.node_id) (byNode[issue.node_id] ??= []).push(`作業手順のチェック：${issue.message}`)
    else general.push(issue.message)
  }
  const status = q.isError ? 'failed' : q.isFetching || settled !== flow ? 'checking' : 'done'
  return { status, byIndex, byNode, general }
}

type Tone = 'success' | 'warning' | 'error' | 'busy'
/** 実行（または次へ進むこと）を止めている理由1件と、その場所へ移動する操作 */
type Blocker = { label: string; reason: string; go: (() => void) | null }
type FooterInfo = { tone: Tone; title: string; sub: string; onFix: (() => void) | null }

/**
 * 画面下部に出す今の状態（見出し1行＋補足1行）。補足には、いちばん先に直すこと1件だけを短く出す。
 * 手順の確認だけの画面（procedureOnly）では、不足があっても次のデータの読み込みへ進める（読み込んだ後でも直せるため）。
 */
function footerStatus({
  procedureOnly,
  check,
  nodeCount,
  counts,
  stepLine,
  unassigned,
  blockers,
  stepBlockers,
}: {
  procedureOnly: boolean
  check: ServerCheck
  nodeCount: number
  counts: Record<ItemStatus, number>
  stepLine: string
  unassigned: number
  blockers: Blocker[]
  stepBlockers: Blocker[]
}): FooterInfo {
  if (nodeCount === 0) return { tone: 'warning', title: '処理ステップがありません', sub: '「処理ステップを追加する」から追加してください', onFix: null }
  if (check.status === 'failed') return { tone: 'error', title: '作業手順のチェックができませんでした', sub: '時間をおいて、もう一度お試しください', onFix: null }
  const first = (list: Blocker[]) => `${list[0].label}　${list[0].reason}`
  if (procedureOnly) {
    const needSetting = counts.needs_setting + counts.error
    if (needSetting) return { tone: 'warning', title: `設定が必要なステップが${needSetting}件あります`, sub: `${first(stepBlockers)}（データを読み込んだ後でも設定できます）`, onFix: stepBlockers[0].go }
    if (check.status === 'done' && check.general.length) return { tone: 'error', title: '作業手順のチェックで問題があります', sub: check.general[0], onFix: null }
    if (counts.needs_review) return { tone: 'warning', title: `確認が必要なステップが${counts.needs_review}件あります`, sub: `${stepLine}。データを読み込んだ後でも確認できます`, onFix: stepBlockers[0].go }
    if (check.status !== 'done') return { tone: 'busy', title: '作業手順をチェックしています…', sub: stepLine, onFix: null }
    return { tone: 'success', title: '手順の設定は完了しました', sub: `次に、処理するExcel・CSVを割り当てます（未割り当て：${unassigned}件）`, onFix: null }
  }
  if (blockers.length) return { tone: 'warning', title: `実行するには、あと${blockers.length}件の設定が必要です`, sub: first(blockers), onFix: blockers[0].go }
  if (check.status !== 'done') return { tone: 'busy', title: '作業手順をチェックしています…', sub: stepLine, onFix: null }
  return { tone: 'success', title: '実行の準備ができました', sub: `${nodeCount}ステップすべて設定完了。作業手順のチェックに問題はありません`, onFix: null }
}

const TONE_STYLE: Record<Tone, { cls: string; icon: ReactNode }> = {
  success: { cls: 'text-mint', icon: <CircleCheck className="size-4.5" aria-hidden /> },
  warning: { cls: 'text-warning', icon: <TriangleAlert className="size-4.5" aria-hidden /> },
  error: { cls: 'text-error', icon: <TriangleAlert className="size-4.5" aria-hidden /> },
  busy: { cls: 'text-subtle', icon: <LoaderCircle className="size-4.5 animate-spin" aria-hidden /> },
}

function FooterStatus({ tone, title, sub, onFix }: FooterInfo) {
  const t = TONE_STYLE[tone]
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2" role="status" aria-label="作業手順のチェック">
      <span className={`mt-0.5 shrink-0 ${t.cls}`}>{t.icon}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-3 font-bold text-white">
          <span className="truncate">{title}</span>
          {onFix && (
            <button
              type="button"
              onClick={onFix}
              className="shrink-0 rounded text-[0.85rem] font-bold text-mint underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-mint"
            >
              修正箇所を見る →
            </button>
          )}
        </p>
        <p className="truncate text-[0.82rem] text-subtle" title={sub}>
          {sub}
        </p>
      </div>
    </div>
  )
}
