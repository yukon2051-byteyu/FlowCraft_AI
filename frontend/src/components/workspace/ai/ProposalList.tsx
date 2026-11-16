import { ChevronDown, Database, MessageSquareText, ShieldAlert, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { Proposal, ProposalEvidence } from '../../../api/ai'
import type { Decision } from '../../../flow/aiPlan'

/*
 * AI業務改善診断の改善提案（A-4）。長い報告書にせず、判断しやすいカードにする。
 * - 重要な順に初めは3件まで。ほかは「ほかの提案を見る」で開く
 * - 根拠は「データで確認」（材料で照らし合わせた事実）・「あなたの回答」・「AIの推測」を分けて示す
 * - 効果の数値は「推定」「仮定」の印をつける（根拠のない数値は出さない。実測はまだない）
 * - 採用・保留・不採用（理由は任意）。AIの提案を利用者の確認なしに確定しない
 */

type ProposalDecision = Decision

const DIRECTION_LABEL: Record<Proposal['direction'], string> = { eliminate: '廃止', simplify: '簡素化', standardize: '標準化', automate: '自動化' }
const DECISION_LABEL = { adopt: '採用する', hold: '保留する', reject: '採用しない' } as const
const SOURCE = {
  data: { label: 'データで確認', icon: Database, cls: 'bg-mint-soft text-forest ring-forest/25' },
  answer: { label: 'あなたの回答', icon: MessageSquareText, cls: 'bg-ink/6 text-ink/80 ring-ink/15' },
  inference: { label: 'AIの推測', icon: Sparkles, cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
} as const

export function ProposalList({
  proposals,
  shownFirst,
  decisions,
  onDecide,
}: {
  proposals: Proposal[]
  shownFirst: number
  decisions: Record<string, ProposalDecision>
  onDecide: (id: string, d: ProposalDecision) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? proposals : proposals.slice(0, shownFirst)
  const rest = proposals.length - shownFirst
  return (
    <>
      <ol className="space-y-3" aria-label="改善提案">
        {shown.map((p, i) => (
          <ProposalCard key={p.proposal_id} p={p} rank={i + 1} decision={decisions[p.proposal_id] ?? { status: null, reason: '' }} onDecide={(d) => onDecide(p.proposal_id, d)} />
        ))}
      </ol>
      {rest > 0 && (
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="flex items-center gap-1 text-[0.9rem] font-bold text-mint hover:underline">
          <ChevronDown className={`size-4 transition ${all ? 'rotate-180' : ''}`} aria-hidden />
          {all ? 'ほかの提案を閉じる' : `ほかの提案を見る（${rest}件）`}
        </button>
      )}
    </>
  )
}

function ProposalCard({ p, rank, decision, onDecide }: { p: Proposal; rank: number; decision: ProposalDecision; onDecide: (d: ProposalDecision) => void }) {
  return (
    <li className="light-panel rounded-2xl px-5 py-4" aria-label={`提案${rank}：${p.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-[0.78rem] font-bold text-white">{DIRECTION_LABEL[p.direction]}</span>
        <h3 className="font-bold">
          提案{rank}：{p.title}
        </h3>
        <span className="text-[0.82rem] text-muted">対象：{p.target}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[0.9rem]">
        <dt className="font-bold text-muted">今の問題</dt>
        <dd>{p.problem}</dd>
        <dt className="font-bold text-muted">改善の内容</dt>
        <dd className="font-bold">{p.change}</dd>
        <dt className="font-bold text-muted">根拠</dt>
        <dd>
          <ul className="space-y-1" aria-label="根拠">
            {p.evidence.map((e, i) => (
              <EvidenceItem key={i} e={e} />
            ))}
          </ul>
        </dd>
        <dt className="font-bold text-muted">期待できる効果</dt>
        <dd>
          {p.effect}
          {p.estimate && (
            <span className="ml-2 inline-flex items-center gap-1 text-[0.85rem]">
              <span className="rounded bg-ink/6 px-1.5 py-0.5 text-[0.75rem] font-bold text-ink/80 ring-1 ring-ink/15">{p.estimate.kind === 'estimated' ? '推定' : '仮定'}</span>
              {p.estimate.text}
            </span>
          )}
        </dd>
        {p.risks.length > 0 && (
          <>
            <dt className="flex items-start gap-1 font-bold text-kaizen-ink">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              リスク
            </dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 text-ink/85">
                {p.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt className="font-bold text-muted">推奨する対応</dt>
        <dd>{p.recommendation}</dd>
        <dt className="font-bold text-muted">手順への反映</dt>
        <dd aria-label="手順への反映">
          <BuildLine b={p.build} />
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-[0.85rem] font-bold text-muted">判断</span>
        <div className="flex gap-1" role="radiogroup" aria-label={`提案${rank}の判断`}>
          {(Object.keys(DECISION_LABEL) as (keyof typeof DECISION_LABEL)[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={decision.status === k}
              onClick={() => onDecide({ ...decision, status: k })}
              className={`h-8 rounded-lg px-3 text-[0.85rem] font-bold ring-1 focus-visible:outline-2 focus-visible:outline-forest ${
                decision.status === k ? (k === 'adopt' ? 'bg-forest text-white ring-forest' : 'bg-ink text-white ring-ink') : 'bg-paper text-ink ring-line hover:ring-forest/50'
              }`}
            >
              {DECISION_LABEL[k]}
            </button>
          ))}
        </div>
        {decision.status && (
          <input
            value={decision.reason}
            onChange={(e) => onDecide({ ...decision, reason: e.target.value })}
            maxLength={300}
            aria-label={`提案${rank}の判断の理由`}
            placeholder={decision.status === 'reject' ? '理由（任意）：例 監査で必要な資料のため' : '理由（任意）'}
            className="h-8 min-w-0 flex-1 rounded-lg bg-paper px-2 text-[0.88rem] ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
          />
        )}
      </div>
    </li>
  )
}

const FIT = {
  yes: { label: '手順にできる', cls: 'bg-mint-soft text-forest ring-forest/25' },
  partial: { label: '一部を手順にできる', cls: 'bg-warning-soft text-warning-ink ring-warning/40' },
  no: { label: '手順に反映できない', cls: 'bg-ink/6 text-muted ring-ink/15' },
} as const

/** 手順への反映：使う部品（ひな形・処理・品質ルール）と、人が行う部分 */
export function BuildLine({ b }: { b: Proposal['build'] }) {
  const parts = [b.template_title && `ひな形「${b.template_title}」`, b.step_labels.length && `処理：${b.step_labels.join('・')}`, b.criteria_labels.length && `品質ルール：${b.criteria_labels.join('・')}`].filter(Boolean)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className={`rounded px-1.5 py-0.5 text-[0.75rem] font-bold ring-1 ring-inset ${FIT[b.fit].cls}`}>{FIT[b.fit].label}</span>
      {parts.length > 0 && <span>{parts.join('／')}</span>}
      {b.note && <span className="text-[0.85rem] text-muted">{b.note}</span>}
    </span>
  )
}

function EvidenceItem({ e }: { e: ProposalEvidence }) {
  const s = SOURCE[e.source]
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.72rem] font-bold ring-1 ring-inset ${s.cls}`}>
        <s.icon className="size-3" aria-hidden />
        {s.label}
      </span>
      <span>
        {e.text}
        {e.downgraded && <span className="ml-1 text-[0.8rem] text-warning-ink">（データで確かめられなかったため、推測として表示）</span>}
      </span>
    </li>
  )
}
