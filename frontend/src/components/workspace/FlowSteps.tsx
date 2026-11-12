import { ArrowDown, ArrowLeft, ArrowUp, CornerDownRight, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { COLUMN_TYPE_LABEL } from '../../api/files'
import { inputSlotLabel, STEP_GROUPS, STEP_TYPES } from '../../flow/catalog'
import { dataChoices, describeInputs, UNSELECTED, usedBy } from '../../flow/ops'
import { useFlowStore } from '../../flow/store'
import type { FlowNode, NodeType } from '../../flow/types'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'

/**
 * タスク1-3：作業手順の処理ステップを、上から順に縦に並べて表示する。
 * 追加・削除・上下の移動ができ、各ステップの「使うデータ」と「この結果を使うステップ」を示す。
 * つながりを壊す操作は行わず、理由をそのステップのすぐ下に表示する。
 * 各ステップの細かい設定（列・条件など）はタスク1-4・1-5で作る。
 */
export function FlowSteps({ onBack }: { onBack: () => void }) {
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

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
          <div>
            <h1 className="text-[1.5rem] font-bold text-white">作業手順</h1>
            <p className="mt-1 text-subtle">処理ステップは上から順に実行されます。各ステップは、それより上のステップの結果だけを使えます。</p>
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
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          使う列と形式の設定に戻る
        </Button>
      </div>
    </>
  )
}

type CardProps = {
  node: FlowNode
  index: number
  nodes: FlowNode[]
  labels: Record<string, string>
  definitionColumns?: { name: string; type: keyof typeof COLUMN_TYPE_LABEL; required?: boolean }[]
  selected: boolean
  onSelect: () => void
  onAddBelow: () => void
  canAddBelow: boolean
}

function StepCard({ node, index, nodes, labels, definitionColumns, selected, onSelect, onAddBelow, canAddBelow }: CardProps) {
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
