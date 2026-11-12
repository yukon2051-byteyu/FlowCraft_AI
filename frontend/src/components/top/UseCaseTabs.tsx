import { ArrowDown, ArrowRight, CircleMinus, CirclePlus, PencilLine, Sheet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { FeatureKey } from '../../content/featureStatus'
import { DevBadge } from '../ui/DevBadge'
import { UseCaseVisual } from './UseCaseVisual'

/*
 * 活用例（TOP改修 Ver.2.0 §6）。3つの例を1つの領域でタブ切り替えする（ページを長くしないため）。
 * 各タブで「説明文」と「処理前 → 処理後」の図の両方が切り替わる。
 */

type UseCase = {
  id: string
  tab: string
  title: string
  lead: string
  points: string[]
  feature: FeatureKey
  visual: () => ReactNode
}

const CASES: UseCase[] = [
  {
    id: 'merge',
    tab: 'Excel統合',
    title: '複数のExcelから必要な列だけを取り出し、1つの表にまとめる',
    lead: '支店や担当者ごとに列の並びや名前が違うファイルでも、使う列を対応付けて1つの表にできます。',
    points: ['列名の違いに対応', '列の並び順が違っても統合', 'どのファイルの行かを記録'],
    feature: 'processing',
    visual: () => <UseCaseVisual />,
  },
  {
    id: 'analysis',
    tab: '売上分析',
    title: '売上データをまとめ、部署別・商品別に集計してグラフにする',
    lead: '集計した数値から、前月比やランキング、グラフを作成。数値はすべてプログラムで計算します。',
    points: ['部署別・商品別の集計', '前月比', 'ランキング', 'グラフ'],
    feature: 'analysis',
    visual: () => <AnalysisVisual />,
  },
  {
    id: 'derive',
    tab: '別業務へ応用',
    title: '営業部Aの集計手順をもとに、営業部B向けの手順を作る',
    lead: '保存した作業手順を複製し、新しい業務との違いをAIが分析。変更内容を確認してから、別の手順として保存します。',
    points: ['元の手順はそのまま残る', 'AIが違いを分析', '変更内容を確認してから反映', '別の手順として保存'],
    feature: 'derive',
    visual: () => <DeriveVisual />,
  },
]

export function UseCaseTabs() {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const c = CASES[active]

  // 左右の矢印キーでタブを移動できるようにする（キーボード操作への対応）
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (active + (e.key === 'ArrowRight' ? 1 : CASES.length - 1)) % CASES.length
    setActive(next)
    tabs.current[next]?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label="活用例" onKeyDown={onKey} className="flex gap-1 overflow-x-auto rounded-xl bg-panel p-1 ring-1 ring-edge sm:inline-flex">
        {CASES.map((u, i) => (
          <button
            key={u.id}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`usecase-tab-${u.id}`}
            aria-selected={i === active}
            aria-controls={`usecase-panel-${u.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={
              'flex-1 rounded-lg px-4 py-2 text-[0.95rem] font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-mint sm:flex-none ' +
              (i === active ? 'bg-mint text-on-mint' : 'text-subtle hover:bg-white/5 hover:text-white')
            }
          >
            {u.tab}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`usecase-panel-${c.id}`}
        aria-labelledby={`usecase-tab-${c.id}`}
        className="mt-6 grid items-center gap-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-12"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[1.3rem] leading-snug font-bold text-white">{c.title}</h3>
            <DevBadge feature={c.feature} />
          </div>
          <p className="mt-3 leading-relaxed text-subtle">{c.lead}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {c.points.map((p) => (
              <li key={p} className="rounded-full bg-panel px-3 py-1 text-[0.88rem] text-white/90 ring-1 ring-edge">
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">{c.visual()}</div>
      </div>
    </div>
  )
}

/* ---------- 売上分析：明細 → 集計・前月比・グラフ ---------- */

const DETAIL = [
  ['10/01', '営業1部', 'ノートPC', '128,000'],
  ['10/01', '営業2部', 'マウス', '3,200'],
  ['10/02', '営業1部', 'モニター', '42,800'],
  ['10/02', 'EC事業部', 'ノートPC', '128,000'],
]
const DEPTS = [
  { name: '営業1部', amount: '1,248万', diff: '+8.2%', bar: 92 },
  { name: 'EC事業部', amount: '1,103万', diff: '+15.1%', bar: 81 },
  { name: '営業2部', amount: '986万', diff: '−3.4%', bar: 72 },
]

function AnalysisVisual() {
  return (
    <BeforeAfter
      before={
        <MiniCard icon={Sheet} title="売上明細（10月・11月）" note="2か月分 3,214行">
          <table className="w-full text-[0.78rem]">
            <tbody>
              {DETAIL.map((r) => (
                <tr key={r.join()} className="border-t border-edge">
                  {r.map((v, i) => (
                    <td key={i} className={`px-2 py-1.5 whitespace-nowrap text-white/85 ${i === 3 ? 'text-right tabular-nums' : ''}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </MiniCard>
      }
      label="集計・比較・グラフ化"
      after={
        <div className="light-panel overflow-hidden rounded-xl shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-[0.88rem] font-bold">部署別売上（11月）</span>
            <span className="text-[0.72rem] text-muted">前月比</span>
          </div>
          <ul className="space-y-2.5 px-3.5 py-3">
            {DEPTS.map((d, i) => (
              <li key={d.name} className="grid grid-cols-[1.4rem_5rem_minmax(0,1fr)_4rem_3.6rem] items-center gap-2 text-[0.82rem]">
                <span className="font-bold text-muted">{i + 1}位</span>
                <span className="font-bold whitespace-nowrap">{d.name}</span>
                <span className="h-2.5 rounded-full bg-ink/8">
                  <span className={`block h-full rounded-full ${i === 0 ? 'bg-mint' : 'bg-forest/70'}`} style={{ width: `${d.bar}%` }} />
                </span>
                <span className="text-right tabular-nums">{d.amount}</span>
                <span className={`text-right font-bold tabular-nums ${d.diff.startsWith('+') ? 'text-forest' : 'text-error-ink'}`}>{d.diff}</span>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  )
}

/* ---------- 別業務へ応用：元の手順 → 変更後の手順 ---------- */

type Change = { label: string; kind: 'same' | 'changed' | 'added' }
const ORIGINAL: Change[] = [
  { label: '売上実績.xlsx を読み込む', kind: 'same' },
  { label: '返品の行を除く', kind: 'same' },
  { label: '部署ごとに合計する', kind: 'same' },
]
const DERIVED: Change[] = [
  { label: '営業部B売上.csv を読み込む', kind: 'changed' },
  { label: 'キャンセルの行を除く', kind: 'changed' },
  { label: '担当者ごとに合計する', kind: 'changed' },
  { label: 'グラフを作る', kind: 'added' },
]
const KIND_STYLE: Record<Change['kind'], { icon: LucideIcon; text: string; row: string }> = {
  same: { icon: CircleMinus, text: '変更なし', row: 'ring-edge text-white/85' },
  changed: { icon: PencilLine, text: '変更', row: 'ring-mint/50 bg-mint/8 text-white' },
  added: { icon: CirclePlus, text: '追加', row: 'ring-mint/50 bg-mint/8 text-white' },
}

function StepList({ title, items, note }: { title: string; items: Change[]; note: string }) {
  return (
    <div className="rounded-xl bg-panel p-3 ring-1 ring-edge">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[0.85rem] font-bold text-white">{title}</span>
        <span className="text-[0.75rem] text-subtle">{note}</span>
      </div>
      <ol className="space-y-1.5">
        {items.map((s, i) => {
          const k = KIND_STYLE[s.kind]
          return (
            <li key={s.label} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[0.82rem] ring-1 ${k.row}`}>
              <span className="w-4 text-[0.75rem] text-subtle tabular-nums">{i + 1}</span>
              <span className="flex-1">{s.label}</span>
              {s.kind !== 'same' && (
                <span className="inline-flex items-center gap-1 text-[0.72rem] font-bold text-mint">
                  <k.icon className="size-3.5" aria-hidden />
                  {k.text}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function DeriveVisual() {
  return (
    <BeforeAfter
      before={<StepList title="営業部A 月次売上集計" items={ORIGINAL} note="元の手順（そのまま残る）" />}
      label="AIが違いを分析・変更案を提示"
      after={<StepList title="営業部B 担当者別売上" items={DERIVED} note="新しい手順" />}
    />
  )
}

/* ---------- 共通 ---------- */

function BeforeAfter({ before, after, label }: { before: ReactNode; after: ReactNode; label: string }) {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      {before}
      <div className="flex flex-col items-center gap-1.5 text-center text-[0.8rem] font-bold text-mint">
        <span className="grid size-10 place-items-center rounded-full bg-mint text-on-mint shadow-[0_0_0_6px_rgba(56,217,173,0.15)]">
          <ArrowRight className="hidden size-5 lg:block" aria-hidden />
          <ArrowDown className="size-5 lg:hidden" aria-hidden />
        </span>
        <span className="max-w-[9rem] [word-break:auto-phrase]">{label}</span>
      </div>
      {after}
    </div>
  )
}

function MiniCard({ icon: Icon, title, note, children }: { icon: LucideIcon; title: string; note: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-panel p-3 ring-1 ring-edge">
      <div className="mb-2 flex items-center gap-1.5 text-[0.85rem] font-bold text-white">
        <Icon className="size-4 text-mint" aria-hidden />
        {title}
        <span className="ml-auto text-[0.75rem] font-normal text-subtle">{note}</span>
      </div>
      {children}
    </div>
  )
}

