import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Columns3,
  FileOutput,
  FileSpreadsheet,
  GitMerge,
  Info,
  Play,
  Plus,
  Sigma,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { NODE_STATUS } from '../ui/nodeStatus'
import { StatusBadge } from '../ui/StatusBadge'
import { NODE_TYPE_LABEL, SAMPLE_INPUTS, SAMPLE_NODES, SAMPLE_PREVIEW } from './sampleFlow'
import type { NodeType, SampleNode } from './sampleFlow'

const NODE_ICON: Record<NodeType, LucideIcon> = {
  load: FileSpreadsheet,
  select_columns: Columns3,
  join: GitMerge,
  aggregate: Sigma,
  output: FileOutput,
}

/**
 * フロー編集画面の骨格（サンプルデータ表示）。
 * ノードの選択・確定、タブ切替などの画面操作は動くが、実行・保存は未実装。
 * Phase 3 で左側のフロー表示を React Flow に置き換える。
 */
export function SampleWorkspace({ onClose }: { onClose: () => void }) {
  const [nodes, setNodes] = useState<SampleNode[]>(SAMPLE_NODES)
  const [selectedId, setSelectedId] = useState('n3')
  const selected = nodes.find((n) => n.node_id === selectedId) ?? nodes[0]

  const unconfirmed = nodes.filter((n) => n.status !== 'confirmed').length
  const questions = nodes.filter((n) => n.status === 'pending').length

  const confirm = (id: string) =>
    setNodes((prev) => prev.map((n) => (n.node_id === id ? { ...n, status: 'confirmed', question: undefined } : n)))

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-mint/20 bg-mint/10 px-5 py-1.5 text-[0.85rem] text-mint">
        <Info className="size-4" aria-hidden />
        <span>
          <span className="font-bold">サンプル表示中</span>
          ：画面の操作を試せます。実行・保存はまだ動作しません。
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold hover:bg-mint/10 focus-visible:outline-2 focus-visible:outline-mint"
        >
          <X className="size-4" aria-hidden />
          ファイル読込に戻る
        </button>
      </div>

      <AiBar questions={questions} unconfirmed={unconfirmed} />

      <div className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
        <FlowPanel nodes={nodes} selectedId={selected.node_id} onSelect={setSelectedId} />
        <DetailPanel node={selected} index={nodes.indexOf(selected)} onConfirm={() => confirm(selected.node_id)} />
      </div>

      <ResultsPanel unconfirmed={unconfirmed} />
    </>
  )
}

/* ---------- AI指示バー ---------- */

function AiBar({ questions, unconfirmed }: { questions: number; unconfirmed: number }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-nav px-5 py-3">
      <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-panel px-3.5 py-2 ring-1 ring-edge focus-within:ring-2 focus-within:ring-mint">
        <Sparkles className="size-5 shrink-0 text-mint" aria-hidden />
        <span className="sr-only">AIへの指示</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[0.98rem] outline-none text-white placeholder:text-subtle"
          defaultValue="売上実績を商品マスタ・部署マスタと結合して、部署別に今月の売上を合計して"
        />
      </label>
      <Button variant="light" disabled title="AIによるフロー作成は Phase 2 で実装します">
        <Sparkles className="size-4" aria-hidden />
        フローを作成
      </Button>
      {questions > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/10 px-3 py-1.5 text-[0.88rem] font-bold text-mint ring-1 ring-mint/35">
          <CircleHelp className="size-4" aria-hidden />
          AIからの確認 {questions}件
        </span>
      )}
      <span className="mx-1 h-8 w-px bg-edge" aria-hidden />
      <div className="flex flex-col items-end">
        <Button variant="primary" disabled title={`未確定のノードが${unconfirmed}件あります`}>
          <Play className="size-4" aria-hidden />
          実行する
        </Button>
      </div>
    </div>
  )
}

/* ---------- 左：入力ファイルと処理フロー ---------- */

function FlowPanel({ nodes, selectedId, onSelect }: { nodes: SampleNode[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-edge bg-nav">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <PanelTitle title="入力ファイル" aside={`${SAMPLE_INPUTS.length}件 割当済み`} />
        <ul className="mb-5 space-y-1.5">
          {SAMPLE_INPUTS.map((f) => (
            <li key={f.label} className="flex items-center gap-2.5 rounded-lg bg-panel px-3 py-2 ring-1 ring-edge">
              <FileSpreadsheet className="size-4.5 shrink-0 text-mint" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.88rem] font-bold">{f.label}</p>
                <p className="truncate text-[0.78rem] text-subtle">{f.file}</p>
              </div>
              <span className="shrink-0 text-[0.78rem] text-subtle tabular-nums">{f.rows}</span>
            </li>
          ))}
        </ul>

        <PanelTitle title="処理フロー" aside={`${nodes.length}ステップ`} />
        <ol className="relative">
          {nodes.map((n, i) => {
            const Icon = NODE_ICON[n.node_type]
            const active = n.node_id === selectedId
            const def = NODE_STATUS[n.status]
            return (
              <li key={n.node_id} className="relative pb-2.5 last:pb-0">
                {i < nodes.length - 1 && <span className="absolute top-12 bottom-0 left-[1.6rem] w-0.5 bg-mint/30" aria-hidden />}
                <button
                  type="button"
                  onClick={() => onSelect(n.node_id)}
                  aria-current={active ? 'true' : undefined}
                  className={
                    'relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-card py-2.5 pr-3 pl-4 text-left text-ink transition-shadow focus-visible:outline-2 focus-visible:outline-mint ' +
                    (active ? 'shadow-[0_0_0_2px_#38D9AD,0_0_28px_-4px_rgba(56,217,173,0.55)]' : 'ring-1 ring-black/10 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.35)]')
                  }
                >
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${def.stripe}`} aria-hidden />
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper ring-1 ring-line">
                    <Icon className="size-4.5 text-forest" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.75rem] text-muted">
                      {i + 1}．{NODE_TYPE_LABEL[n.node_type]}
                    </span>
                    <span className="block truncate font-bold">{n.node_name}</span>
                    <span className="block truncate text-[0.82rem] text-muted">{n.summary}</span>
                  </span>
                  <StatusBadge status={n.status} className="shrink-0" />
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-edge bg-nav px-3 py-2">
        <Button variant="ghostDark" size="sm" disabled title="ノードの追加は Phase 3 で実装します">
          <Plus className="size-4" aria-hidden />
          処理を追加
        </Button>
        <span className="ml-auto" />
        <IconButton icon={ArrowUp} label="上へ移動" />
        <IconButton icon={ArrowDown} label="下へ移動" />
        <IconButton icon={Trash2} label="削除" />
      </div>
    </aside>
  )
}

function IconButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      disabled
      title={`${label}（Phase 3 で実装します）`}
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg text-subtle hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-4.5" aria-hidden />
    </button>
  )
}

function PanelTitle({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h2 className="text-[0.85rem] font-bold tracking-wide text-subtle">{title}</h2>
      {aside && <span className="text-[0.78rem] text-subtle">{aside}</span>}
    </div>
  )
}

/* ---------- 右：選択ノードの設定・プレビュー・差分 ---------- */

type Tab = 'settings' | 'preview' | 'diff'
const TABS: { id: Tab; label: string }[] = [
  { id: 'settings', label: '設定' },
  { id: 'preview', label: 'プレビュー' },
  { id: 'diff', label: '処理前後の差分' },
]

function DetailPanel({ node, index, onConfirm }: { node: SampleNode; index: number; onConfirm: () => void }) {
  const [tab, setTab] = useState<Tab>('settings')
  const Icon = NODE_ICON[node.node_type]
  const needsConfirm = node.status === 'ai_proposed' || node.status === 'pending'

  return (
    <section className="light-panel flex min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-6 pt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-mint-soft ring-1 ring-forest/20">
            <Icon className="size-5 text-forest" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[0.8rem] text-muted">
              ステップ {index + 1} ・ {NODE_TYPE_LABEL[node.node_type]}
            </p>
            <h2 className="truncate text-[1.2rem] font-bold text-ink">{node.node_name}</h2>
          </div>
          <StatusBadge status={node.status} className="ml-2" />
        </div>
        <div className="mt-3 flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={
                '-mb-px border-b-2 px-4 py-2 text-[0.92rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-forest ' +
                (tab === t.id ? 'border-mint text-forest' : 'border-transparent text-muted hover:text-ink')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'settings' && <SettingsTab node={node} needsConfirm={needsConfirm} onConfirm={onConfirm} />}
        {tab === 'preview' && <PreviewTab node={node} />}
        {tab === 'diff' && <DiffTab node={node} />}
      </div>
    </section>
  )
}

function SettingsTab({ node, needsConfirm, onConfirm }: { node: SampleNode; needsConfirm: boolean; onConfirm: () => void }) {
  return (
    <div className="max-w-3xl space-y-5">
      {needsConfirm && (
        <div className="rounded-xl bg-mint-soft p-4 ring-1 ring-forest/25">
          <p className="flex items-center gap-2 font-bold text-forest">
            <Sparkles className="size-4.5" aria-hidden />
            AIの提案です。内容を確認して確定してください。
          </p>
          {node.question && (
            <div className="mt-3 rounded-lg bg-paper p-3.5 ring-1 ring-forest/20">
              <p className="flex gap-2 text-[0.95rem]">
                <CircleHelp className="mt-0.5 size-4.5 shrink-0 text-forest" aria-hidden />
                {node.question.text}
              </p>
              <div className="mt-3 flex gap-2 pl-6">
                <Button variant="primary" size="sm" onClick={onConfirm}>
                  {node.question.yes}
                </Button>
                <Button variant="secondary" size="sm" disabled title="設定の変更は Phase 3 で実装します">
                  {node.question.no}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {node.status === 'unset' && (
        <p className="rounded-xl bg-paper p-4 text-[0.95rem] ring-1 ring-line">
          <span className="font-bold">未設定の項目があります。</span>必要な項目を入力すると、このステップを確定できます。
        </p>
      )}

      <dl className="divide-y divide-line rounded-xl ring-1 ring-line">
        {node.params.map((p) => (
          <div key={p.label} className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-4 px-4 py-3">
            <dt className="text-[0.9rem] font-bold text-muted">{p.label}</dt>
            <dd className="flex items-center gap-2">
              <span className={`flex-1 rounded-lg px-3 py-1.5 ring-1 ${p.ai && needsConfirm ? 'bg-mint-soft ring-forest/30' : 'bg-paper ring-line'}`}>
                {p.value}
              </span>
              {p.ai && needsConfirm && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[0.78rem] font-bold text-forest">
                  <Sparkles className="size-3.5" aria-hidden />
                  AI提案
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {node.counts && <CountsBox counts={node.counts} />}

      {needsConfirm && !node.question && (
        <div className="flex gap-2">
          <Button variant="primary" onClick={onConfirm}>
            <CircleCheck className="size-4.5" aria-hidden />
            この内容で確定
          </Button>
        </div>
      )}
    </div>
  )
}

function CountsBox({ counts }: { counts: NonNullable<SampleNode['counts']> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-paper px-4 py-3 ring-1 ring-line">
      <span className="text-[0.88rem] font-bold text-muted">件数の変化</span>
      <span className="text-[1.05rem] font-bold tabular-nums">
        {counts.before} <span className="text-muted">→</span> {counts.after}
      </span>
      {counts.note && (
        <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[0.85rem] font-bold text-warning-ink ring-1 ring-warning/30">
          {counts.note}
        </span>
      )}
    </div>
  )
}

function PreviewTab({ node }: { node: SampleNode }) {
  if (node.node_type !== 'join') {
    return <EmptyNote text="このステップのプレビューはサンプルでは用意していません。「商品マスタと結合」を選ぶと表示例を確認できます。" />
  }
  const p = SAMPLE_PREVIEW
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[0.9rem]">
        <span className="font-bold">出力データ</span>
        <span className="text-muted">
          表示：先頭{p.shown}行 ／ 全{p.total}行
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[0.85rem] text-forest">
          <span className="size-2.5 rounded-sm bg-mint" aria-hidden />
          追加された列
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-[0.92rem]">
          <thead>
            <tr className="bg-card">
              {p.columns.map((c) => (
                <th
                  key={c.name}
                  className={`border-b border-line px-3 py-2 text-left font-bold whitespace-nowrap ${c.added ? 'bg-mint-soft text-forest' : 'text-muted'} ${c.numeric ? 'text-right' : ''}`}
                >
                  {c.added && '＋ '}
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, ri) => {
              const unmatched = r.some((v) => v === null)
              return (
                <tr key={ri} className={`border-t border-line ${unmatched ? 'bg-warning-soft/60' : ''}`}>
                  {r.map((v, ci) => (
                    <td key={ci} className={`px-3 py-2 whitespace-nowrap ${p.columns[ci].numeric ? 'text-right tabular-nums' : ''}`}>
                      {v === null ? <span className="text-[0.85rem] font-bold text-warning-ink">未照合</span> : <span className="whitespace-pre">{v}</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="flex gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-[0.9rem] text-warning-ink ring-1 ring-warning/25">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          未照合の行は削除せず残しています。「C-3300 」のように<span className="font-bold">末尾に空白</span>
          があるコードは、空白を除くとマスタと一致します。
        </span>
      </p>
    </div>
  )
}

function DiffTab({ node }: { node: SampleNode }) {
  if (!node.counts) return <EmptyNote text="このステップでは件数・列の変化はありません。" />
  const items = [
    { k: '件数', v: `${node.counts.before} → ${node.counts.after}` },
    { k: '追加された列', v: node.node_type === 'join' ? '商品名、カテゴリ（2列）' : 'なし' },
    { k: '削除された列', v: node.node_type === 'select_columns' ? '担当者、備考、入力日時（3列）' : 'なし' },
    { k: '型変換の失敗', v: '0件' },
  ]
  return (
    <dl className="grid max-w-3xl grid-cols-2 gap-3">
      {items.map((it) => (
        <div key={it.k} className="rounded-xl bg-paper px-4 py-3 ring-1 ring-line">
          <dt className="text-[0.85rem] font-bold text-muted">{it.k}</dt>
          <dd className="mt-1 text-[1.02rem] font-bold">{it.v}</dd>
        </div>
      ))}
    </dl>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <p className="max-w-2xl rounded-xl bg-paper px-4 py-6 text-center text-muted ring-1 ring-line">{text}</p>
}

/* ---------- 下：検証結果・処理ログ ---------- */

function ResultsPanel({ unconfirmed }: { unconfirmed: number }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'checks' | 'log'>('checks')
  return (
    <section className="shrink-0 border-t border-edge bg-nav">
      <div className="flex h-12 items-center gap-4 px-5">
        <div className="flex gap-1" role="tablist">
          {(
            [
              ['checks', '検証結果'],
              ['log', '処理ログ'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id)
                setOpen(true)
              }}
              className={
                'rounded-md px-3 py-1.5 text-[0.9rem] font-bold focus-visible:outline-2 focus-visible:outline-mint ' +
                (tab === id ? 'bg-panel text-white' : 'text-subtle hover:text-white')
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[0.9rem] text-subtle">
          まだ実行していません。未確定のステップ（{unconfirmed}件）をすべて確定すると実行できます。
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.88rem] font-bold text-mint hover:bg-mint/10 focus-visible:outline-2 focus-visible:outline-mint"
        >
          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
          {open ? '閉じる' : '詳細を開く'}
        </button>
      </div>
      {open && (
        <div className="border-t border-edge px-5 py-4 text-[0.92rem] text-subtle">
          {tab === 'checks'
            ? '実行すると、ここに「結論 → 重要な検証結果 → 詳細」の順で結果を表示します（件数・重複・欠損・結合漏れ・金額の差異）。'
            : '実行すると、各ステップの処理件数と所要時間をここに記録します。'}
        </div>
      )}
    </section>
  )
}
