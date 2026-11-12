import { ArrowLeft, Plus } from 'lucide-react'
import { COLUMN_TYPE_LABEL } from '../../api/files'
import { describeInputs } from '../../flow/ops'
import { useFlowStore } from '../../flow/store'
import { Button } from '../ui/Button'
import { DevBadge } from '../ui/DevBadge'
import { StatusBadge } from '../ui/StatusBadge'

/**
 * 作業手順の処理ステップを、上から順に縦に並べて表示する。
 * タスク1-2の時点では、読み込みステップの確認まで。処理ステップの追加・設定はタスク1-3で作る。
 */
export function FlowSteps({ onBack }: { onBack: () => void }) {
  const flow = useFlowStore((s) => s.flow)
  const labels = Object.fromEntries(flow.input_definitions.map((d) => [d.input_id, d.label]))

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
          <div>
            <h1 className="text-[1.5rem] font-bold text-white">作業手順</h1>
            <p className="mt-1 text-subtle">処理ステップは上から順に実行されます。</p>
          </div>

          <ol className="space-y-3" aria-label="処理ステップ">
            {flow.nodes.map((node, i) => {
              const def = node.node_type === 'load' ? flow.input_definitions.find((d) => d.input_id === node.parameters.input_id) : undefined
              return (
                <li key={node.node_id} className="light-panel rounded-2xl px-5 py-4 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-full bg-ink text-[0.85rem] font-bold text-white">{i + 1}</span>
                    <h2 className="font-bold text-ink">{node.node_name}</h2>
                    <StatusBadge status={node.confirmation_status === 'confirmed' ? 'confirmed' : 'unset'} className="ml-auto" />
                  </div>
                  <p className="mt-1.5 text-[0.9rem] text-muted">{describeInputs(flow.nodes, i, labels).join('、')}</p>
                  {def && (
                    <p className="mt-2 text-[0.88rem] text-ink/85">
                      <span className="font-bold">使う列（{def.columns.length}列）：</span>
                      {def.columns.map((c) => `${c.name}（${COLUMN_TYPE_LABEL[c.type]}${c.required ? '・必ずある' : ''}）`).join('、')}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>

          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-edge px-5 py-4">
            <Button variant="outlineDark" size="sm" disabled title="処理ステップを追加する機能は開発中です">
              <Plus className="size-4" aria-hidden />
              処理ステップを追加する
            </Button>
            <DevBadge feature="processing" />
          </div>
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
