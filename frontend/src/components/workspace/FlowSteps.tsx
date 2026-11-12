import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, CircleCheck, CornerDownRight, LoaderCircle, Play, Plus, ScanSearch, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { COLUMN_TYPE_LABEL } from '../../api/files'
import { ApiError } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { runFlow, stepIndexOf, validateFlow } from '../../api/flows'
import type { RunSummary } from '../../api/flows'
import { ErrorNotice } from '../ui/ErrorNotice'
import { inputSlotLabel, STEP_GROUPS, STEP_TYPES } from '../../flow/catalog'
import { dataChoices, describeInputs, snapshot, UNSELECTED, usedBy } from '../../flow/ops'
import { inferColumns, paramProblems, summarize } from '../../flow/params'
import type { FlowDoc } from '../../flow/types'
import { StepSettings } from './StepSettings'
import { useFlowStore } from '../../flow/store'
import type { FlowNode, NodeType } from '../../flow/types'
import { isAvailable } from '../../content/featureStatus'
import { Button } from '../ui/Button'
import { DevBadge } from '../ui/DevBadge'
import { StatusBadge } from '../ui/StatusBadge'

/**
 * タスク1-3：作業手順の処理ステップを、上から順に縦に並べて表示する。
 * 追加・削除・上下の移動ができ、各ステップの「使うデータ」と「この結果を使うステップ」を示す。
 * つながりを壊す操作は行わず、理由をそのステップのすぐ下に表示する。
 * 各ステップの細かい設定（列・条件など）はタスク1-4・1-5で作る。
 */
export function FlowSteps({ onBack, onRan }: { onBack: () => void; onRan: (run: RunSummary, snap: string) => void }) {
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
    mutationFn: () => runFlow(flow, Object.values(bindings)),
    onMutate: () => setRunError(null),
    onSuccess: (run) => onRan(run, snapshot(flow)),
    onError: (e) => setRunError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '実行できませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null }),
  })
  // 全体を実行できない理由（押せないボタンの近くに表示する）
  const notConfirmed = flow.nodes.filter((n) => n.confirmation_status !== 'confirmed').length
  const serverCount = Object.values(check.byIndex).flat().length + Object.values(check.byNode).flat().length + check.general.length
  const runBlocker =
    flow.nodes.length === 0
      ? '処理ステップがありません'
      : notConfirmed
        ? `確認済みでないステップが${notConfirmed}個あるため、まだ実行できません`
        : check.status !== 'done'
          ? '作業手順のチェックが終わるまでお待ちください'
          : serverCount
            ? '作業手順のチェックで見つかった問題を直してください'
            : null
  const selectedIndex = flow.nodes.findIndex((n) => n.node_id === selectedId)
  const selected = selectedIndex >= 0 ? flow.nodes[selectedIndex] : null
  const stepName = (ref: string) => {
    const at = flow.nodes.findIndex((n) => n.output_reference === ref)
    return at >= 0 ? `ステップ${at + 1}の結果：${flow.nodes[at].node_name}` : '（まだ選んでいません）'
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] items-start gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_27rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[1.5rem] font-bold text-white">作業手順</h1>
              <p className="mt-1 text-subtle">処理ステップは上から順に実行されます。各ステップは、それより上のステップの結果だけを使えます。</p>
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
                  definitionColumns={flow.input_definitions.find((d) => d.input_id === node.parameters.input_id)?.columns}
                  summary={summarize(node)}
                  problemCount={problems[node.node_id].length + serverProblems(node, i).length}
                  selected={node.node_id === selectedId}
                  onSelect={() => selectNode(node.node_id)}
                  onAddBelow={() => setAddAt(addAt === node.node_id ? null : node.node_id)}
                  canAddBelow={node.node_type !== 'output'}
                />
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

        {/* 選んだステップの設定 */}
        {/* 設定が長いときは、この欄の中だけをスクロールする（画面の上下の帯の高さを除く） */}
        <div className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:rounded-2xl">
          {selected ? (
            <StepSettings
              key={selected.node_id}
              node={selected}
              index={selectedIndex}
              inputs={inputsOf(selected)}
              inputNames={selected.input_references.map(stepName)}
              problems={problems[selected.node_id]}
              serverProblems={serverProblems(selected, selectedIndex)}
              definitionColumns={flow.input_definitions.find((d) => d.input_id === selected.parameters.input_id)?.columns}
            />
          ) : (
            <p className="rounded-2xl bg-panel px-6 py-10 text-center text-subtle ring-1 ring-edge">ステップを選ぶと、ここで設定できます。</p>
          )}
        </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          使う列と形式の設定に戻る
        </Button>
        <CheckSummary check={check} nodes={flow.nodes} problems={problems} />
        <div className="flex items-center gap-3">
          {runBlocker && <span className="text-[0.82rem] text-subtle">{runBlocker}</span>}
          <Button variant="primary" size="sm" disabled={runBlocker !== null || runMutation.isPending} onClick={() => runMutation.mutate()} title={runBlocker ?? undefined}>
            {runMutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
            作業手順全体を実行する
          </Button>
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
  definitionColumns?: { name: string; type: keyof typeof COLUMN_TYPE_LABEL; required?: boolean }[]
  summary: string | null
  problemCount: number
  selected: boolean
  onSelect: () => void
  onAddBelow: () => void
  canAddBelow: boolean
}

function StepCard({ node, index, nodes, labels, definitionColumns, summary, problemCount, selected, onSelect, onAddBelow, canAddBelow }: CardProps) {
  const moveNode = useFlowStore((s) => s.moveNode)
  const removeNode = useFlowStore((s) => s.removeNode)
  const setNodeInputs = useFlowStore((s) => s.setNodeInputs)
  const updateNode = useFlowStore((s) => s.updateNode)
  // 失敗した操作の理由。ステップが変わったら（番号がずれる可能性があるので）表示しない
  const [failure, setFailure] = useState<{ message: string; nodes: FlowNode[] } | null>(null)
  const error = failure && failure.nodes === nodes ? failure.message : null
  const setError = (message: string | null) => setFailure(message ? { message, nodes } : null)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      onClick={onSelect}
      aria-label={`ステップ${n}：${node.node_name}`}
      className={`light-panel rounded-2xl px-5 py-4 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] ${selected ? 'ring-2 ring-mint' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-ink text-[0.85rem] font-bold text-white">{n}</span>
        <h2 className="font-bold text-ink">{node.node_name}</h2>
        {node.node_name !== info.name && <span className="text-[0.82rem] text-muted">{info.name}</span>}
        <StatusBadge status={node.confirmation_status === 'confirmed' ? 'confirmed' : 'unset'} className="ml-auto" />
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`ステップ${n}を上へ移動`} disabled={index === 0} onClick={() => run(moveNode(node.node_id, index - 1))}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label={`ステップ${n}を下へ移動`} disabled={index === nodes.length - 1} onClick={() => run(moveNode(node.node_id, index + 1))}>
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
      </div>

      {/* 使うデータ */}
      <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
        {node.node_type === 'load' ? (
          <p className="text-[0.9rem] text-muted">{describeInputs(nodes, index, labels)[0]}</p>
        ) : (
          <InputSelectors node={node} index={index} nodes={nodes} onChange={changeInputs} />
        )}
      </div>

      {definitionColumns && (
        <p className="mt-2 text-[0.88rem] text-ink/85">
          <span className="font-bold">使う列（{definitionColumns.length}列）：</span>
          {definitionColumns.map((c) => `${c.name}（${COLUMN_TYPE_LABEL[c.type]}${c.required ? '・必ずある' : ''}）`).join('、')}
        </p>
      )}

      {summary && (
        <p className="mt-2 text-[0.9rem] text-ink">
          <span className="font-bold">処理内容：</span>
          {summary}
        </p>
      )}
      {problemCount > 0 && node.confirmation_status !== 'confirmed' && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.85rem] text-warning-ink">
          <TriangleAlert className="size-4" aria-hidden />
          設定が必要なことが{problemCount}件あります（選ぶと右側に表示）
        </p>
      )}

      {node.node_type !== 'output' && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.85rem] text-muted">
          <CornerDownRight className="size-4" aria-hidden />
          {users.length ? `この結果を使うステップ：${users.map((u) => `ステップ${u}`).join('・')}` : 'この結果は、まだどのステップでも使っていません'}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-[0.9rem] text-error-ink ring-1 ring-error/30">
          {error}
        </p>
      )}

      {confirmDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-3 py-2 ring-1 ring-warning/30" onClick={(e) => e.stopPropagation()}>
          <span className="text-[0.9rem] text-ink">ステップ{n}「{node.node_name}」を削除しますか？</span>
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
      )}

    </article>
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

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
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
    else (byIndex[i] ??= []).push(`作業手順のチェック：${e.message}（${e.location.split('.').slice(2).join('.') || '設定'}）`)
  }
  for (const issue of q.data?.issues ?? []) {
    if (issue.severity !== 'error') continue
    if (issue.node_id) (byNode[issue.node_id] ??= []).push(`作業手順のチェック：${issue.message}`)
    else general.push(issue.message)
  }
  const status = q.isError ? 'failed' : q.isFetching || settled !== flow ? 'checking' : 'done'
  return { status, byIndex, byNode, general }
}

function CheckSummary({ check, nodes, problems }: { check: ServerCheck; nodes: FlowNode[]; problems: Record<string, string[]> }) {
  const needSetting = nodes.filter((n) => problems[n.node_id].length > 0).length
  const unconfirmed = nodes.filter((n) => n.confirmation_status !== 'confirmed').length
  const serverCount = Object.values(check.byIndex).flat().length + Object.values(check.byNode).flat().length + check.general.length
  let tone = 'text-subtle'
  let icon = <LoaderCircle className="size-4 animate-spin" aria-hidden />
  let text = '作業手順をチェックしています…'
  if (check.status === 'failed') {
    tone = 'text-error'
    icon = <TriangleAlert className="size-4" aria-hidden />
    text = '作業手順のチェックができませんでした。時間をおいて、もう一度お試しください'
  } else if (check.status === 'done') {
    if (needSetting > 0) {
      tone = 'text-warning'
      icon = <TriangleAlert className="size-4" aria-hidden />
      text = `設定が必要なステップが${needSetting}個あります`
    } else if (serverCount > 0) {
      tone = 'text-error'
      icon = <TriangleAlert className="size-4" aria-hidden />
      text = `作業手順のチェックで問題が${serverCount}件見つかりました${check.general.length ? `：${check.general[0]}` : ''}`
    } else {
      tone = 'text-success'
      icon = <CircleCheck className="size-4" aria-hidden />
      text = unconfirmed ? `作業手順の形に問題はありません（確認済みでないステップ：${unconfirmed}個）` : '作業手順の形に問題はありません。すべてのステップが確認済みです'
    }
  }
  return (
    <p className={`ml-auto flex items-center gap-1.5 text-[0.88rem] ${tone}`} role="status" aria-label="作業手順のチェック">
      {icon}
      {text}
    </p>
  )
}
