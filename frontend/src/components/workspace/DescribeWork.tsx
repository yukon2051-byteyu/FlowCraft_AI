import { ArrowDown, ArrowLeft, ArrowRight, CircleCheck, Info } from 'lucide-react'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTemplates } from '../../api/templates'
import { DevBadge } from '../ui/DevBadge'
import { Button } from '../ui/Button'
import { isAvailable } from '../../content/featureStatus'
import type { BuildMethod, DiagnosisState } from '../../flow/journey'

/*
 * 作業起点の「作業を伝える」。
 * 入力した案件名・作業の説明は、作業手順の名前と説明（flow_name・description）として後の画面へ引き継ぐ。
 *
 * 画面の順番：① やりたい作業を入力する → ② 改善診断を受けるか選ぶ → ③ 作業手順のひな形を選ぶ → ④ 次へ進む
 * 2026-11-16 改修（1366×768 で、ひな形の一覧が画面の外に隠れ、次の操作に気づけなかった）：
 * - 開発中の機能（AI改善診断・簡易チェック・AIで手順を作る）は、選べない小さな印にまとめる（使えるように見せない）
 * - 「診断せずに進む」を選んだら、「次に、作業手順のひな形を選んでください」と示し、ひな形の一覧へ動かす（利用者が選んだときだけ）
 * - 下部の操作：ひな形を選ぶ前は「ひな形を選ぶ ↓」（一覧へ動かす）、選んだら「このひな形で進む →」
 * 「改善診断を受けない」と「AIを使わない」は別のこと。AIを使う操作のときだけ、その直前にAI使用パスワードを求める。
 */

type Props = {
  initialName: string
  initialDescription: string
  onBack: () => void
  onNext: (v: { name: string; description: string; diagnosis: DiagnosisState; method: BuildMethod; templateId: string | null }) => void
  busy?: boolean
}

const DEFAULT_NAME = '無題の作業手順'

/** 要素の位置まで動かす（動きを減らす設定では、すぐに移動する） */
function scrollToEl(el: HTMLElement | null) {
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

export function DescribeWork({ initialName, initialDescription, onBack, onNext, busy = false }: Props) {
  const [name, setName] = useState(initialName === DEFAULT_NAME ? '' : initialName)
  const [description, setDescription] = useState(initialDescription)
  const aiDiagnosis = isAvailable('kaizen')
  const quickCheck = isAvailable('kaizenCheck')
  const aiBuild = isAvailable('aiFlow')
  const [skipChosen, setSkipChosen] = useState(false)
  const [method, setMethod] = useState<BuildMethod>('template')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const templates = useQuery({ queryKey: ['templates'], queryFn: listTemplates })
  const nameRef = useRef<HTMLInputElement>(null)
  const methodRef = useRef<HTMLElement>(null)
  const trimmed = name.trim()
  const nameProblem = !trimmed ? '案件名を入力してください' : trimmed.length > 100 ? '案件名は100文字以内にしてください' : null
  const needTemplate = method === 'template' && !templateId
  // 次へ進もうとした後だけ、案件名の不足を入力欄に示す（最初から赤枠にしない）。正しく入れると消える
  const [tried, setTried] = useState(false)
  const nameError = tried ? nameProblem : null

  const chooseSkip = () => {
    setSkipChosen(true)
    // 選んだ直後だけ、次の操作（ひな形を選ぶ）の位置へ動かす（再描画や入力中には動かさない）
    requestAnimationFrame(() => scrollToEl(methodRef.current))
  }
  const goName = () => {
    scrollToEl(nameRef.current)
    nameRef.current?.focus({ preventScroll: true })
  }
  const next = () => {
    if (nameProblem) {
      // 空欄・空白だけの案件名では進めない。理由を入力欄の直下に出し、入力欄へ移る
      setTried(true)
      goName()
      return
    }
    onNext({ name: trimmed, description: description.trim(), diagnosis: 'skipped', method, templateId: method === 'template' ? templateId : null })
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1000px] space-y-4 px-6 py-5">
          {/* ① やりたい作業を入力する */}
          <section className="light-panel space-y-3 rounded-2xl p-6 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]" aria-label="作業を伝える">
            <div>
              <p className="text-[0.85rem] font-bold text-forest">① やりたい作業を入力する</p>
              <h1 className="mt-0.5 text-[1.5rem] leading-tight font-bold">やりたい作業を伝える</h1>
              <p className="mt-1 text-[0.92rem] text-ink/80">作業手順の名前と目的として保存し、次の画面へ引き継ぎます。Excelはまだ必要ありません。</p>
            </div>
            <label className="block scroll-mt-4">
              <span className="flex items-center gap-2 text-[0.88rem] font-bold">
                案件名（作業の名前）
                <FieldBadge required />
              </span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：月次売上集計"
                maxLength={120}
                aria-label="案件名"
                aria-required
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'name-error' : undefined}
                className={`mt-1 h-10 w-full scroll-mt-4 rounded-lg bg-card px-3 focus:outline-none ${nameError ? 'ring-2 ring-error' : 'ring-1 ring-line focus:ring-2 focus:ring-forest'}`}
              />
              {nameError && (
                <span id="name-error" role="alert" className="mt-1 block text-[0.85rem] font-bold text-error-ink">
                  {nameError}
                </span>
              )}
            </label>
            <label className="block">
              <span className="flex items-center gap-2 text-[0.88rem] font-bold">
                やりたい作業・目的
                <FieldBadge />
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="例：毎月、各部署から届く売上Excelをまとめ、商品マスタと結合し、部署別の売上を集計したい。営業会議で使う。"
                aria-label="やりたい作業・目的"
                className="mt-1 w-full resize-y rounded-lg bg-card px-3 py-2 leading-relaxed ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              />
            </label>
          </section>

          {/* ② 改善診断を受けるか選ぶ。使えるのは「診断せずに進む」だけ。開発中の2つは小さな印にまとめる */}
          <section className="rounded-2xl bg-panel px-5 py-4 ring-1 ring-edge" aria-label="この作業を見直しますか">
            <h2 className="font-bold text-white">
              <span className="mr-1.5 text-[0.85rem] text-mint">②</span>この作業を見直しますか？<span className="ml-1.5 text-[0.82rem] font-normal text-subtle">任意</span>
            </h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2" role="radiogroup" aria-label="改善診断">
              <Choice selected={skipChosen} onSelect={chooseSkip} title="診断せずに進む" body="今の作業内容をもとに、作業手順の作成へ進みます。" />
              <div className="min-w-0 flex-1 rounded-lg bg-white/3 px-3 py-2 ring-1 ring-edge">
                <p className="text-[0.84rem] text-subtle">
                  <span className="font-bold text-white/70">改善診断機能は開発中です。</span>AI改善診断・簡易チェックは今後利用できるようになります。
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <DevChip title="AI改善診断を受ける" feature="kaizen" disabled={!aiDiagnosis} />
                  <DevChip title="簡易チェックで見直す" feature="kaizenCheck" disabled={!quickCheck} />
                </div>
              </div>
            </div>
          </section>

          {/* ③ 作業手順のひな形を選ぶ（ほかの作り方も、ここで選ぶ） */}
          <section ref={methodRef} className="scroll-mt-3 rounded-2xl bg-panel px-5 py-4 ring-1 ring-edge" aria-label="手順の作り方">
            {skipChosen && method === 'template' && !templateId && (
              <p role="status" className="mb-3 flex items-start gap-2 rounded-xl bg-mint/10 px-3.5 py-2.5 ring-1 ring-mint/40">
                <ArrowDown className="mt-0.5 size-4.5 shrink-0 text-mint" aria-hidden />
                <span>
                  <span className="font-bold text-mint">次に、作業手順のひな形を選んでください</span>
                  <span className="block text-[0.86rem] text-white/80">作業内容に近いひな形を選ぶと、処理手順の作成を始められます。</span>
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold text-white">
                <span className="mr-1.5 text-[0.85rem] text-mint">③</span>
                {method === 'template' ? '作業手順のひな形を選ぶ' : '手順の作り方'}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="手順の作り方">
                <Segment selected={method === 'template'} onSelect={() => setMethod('template')} title="ひな形から作る" />
                <Segment selected={method === 'parts_from_data'} onSelect={() => setMethod('parts_from_data')} title="処理部品を組み合わせて作る" />
                <DevChip title="AIで手順を作る" feature="aiFlow" disabled={!aiBuild} />
              </div>
            </div>
            {method === 'template' ? (
              <>
                <p className="mt-1 text-[0.86rem] text-subtle">やりたい作業に近いものを選んでください。内容は後から変更できます（Excelを読み込んだ後に、列を照合して確定します）。</p>
                <div className="mt-2.5 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="もとにするひな形">
                  {templates.isPending && <p className="text-[0.85rem] text-subtle">ひな形を読み込んでいます…</p>}
                  {(templates.data ?? []).map((t) => (
                    <TemplateCard key={t.template_id} selected={templateId === t.template_id} onSelect={() => setTemplateId(t.template_id)} title={t.title} summary={t.summary} inputs={t.inputs} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1.5 text-[0.88rem] text-white/80">
                Excelを読み込み、実際の列を確かめながら、加工・集計の部品を組み合わせます。ひな形にない業務にも使えます。
              </p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[0.8rem] text-subtle">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              「改善診断を受けない」と「AIを使わない」は別のことです。AIを使う操作を選んだときだけ、その直前にパスワードの入力を求めます。
            </p>
          </section>
        </div>
      </div>

      {/* ④ 次へ進む：いま必要な操作を、短い言葉とボタンで示す（長い説明は入れない） */}
      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          開始方法を選び直す
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {needTemplate ? (
            <Button variant="primary" onClick={() => scrollToEl(methodRef.current)}>
              ひな形を選ぶ
              <ArrowDown className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={next} title="案件名がないときは、押すと入力欄に理由を示します">
              {method === 'template' ? 'このひな形で進む' : '次へ：データを読み込む'}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/** 入力項目の必須・任意の印（大きさ・余白・角丸をそろえる。必須は落ち着いたコーラル、任意はグレー） */
function FieldBadge({ required = false }: { required?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded px-1.5 text-[0.72rem] leading-none font-bold ring-1 ring-inset ${
        required ? 'bg-kaizen-soft text-kaizen-ink ring-kaizen/35' : 'bg-ink/6 text-muted ring-ink/15'
      }`}
    >
      {required ? '必須' : '任意'}
    </span>
  )
}

/** 使える選択肢（ラジオ）。カード全体を押せ、Enter・Space でも選べる */
function Choice({ selected, title, body, onSelect }: { selected: boolean; title: string; body: string; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={title}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-2.5 ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-mint ${
        selected ? 'bg-mint/12 ring-2 ring-mint/70' : 'bg-white/5 ring-white/25 hover:bg-white/8 hover:ring-white/45'
      }`}
    >
      {selected ? <CircleCheck className="size-5 shrink-0 text-mint" aria-hidden /> : <span className="size-5 shrink-0 rounded-full ring-2 ring-white/40" aria-hidden />}
      <span>
        <span className={`block font-bold ${selected ? 'text-mint' : 'text-white'}`}>{title}</span>
        <span className="block text-[0.82rem] text-white/75">{body}</span>
      </span>
    </div>
  )
}

/** 手順の作り方の切り替え（小さめのラジオ） */
function Segment({ selected, title, onSelect }: { selected: boolean; title: string; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={title}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer rounded-full px-3 py-1 text-[0.84rem] font-bold ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-mint ${
        selected ? 'bg-mint/14 text-mint ring-mint/70' : 'text-white/80 ring-white/25 hover:bg-white/8'
      }`}
    >
      {title}
    </div>
  )
}

/** 開発中で選べない選択肢（小さな印。使えるように見せない） */
function DevChip({ title, feature, disabled }: { title: string; feature: Parameters<typeof DevBadge>[0]['feature']; disabled: boolean }) {
  return (
    <span
      role="radio"
      aria-checked={false}
      aria-disabled={disabled || undefined}
      aria-label={title}
      title={disabled ? 'この機能は開発中のため、まだ選べません' : undefined}
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8rem] text-white/50 ring-1 ring-edge"
    >
      {title}
      <DevBadge feature={feature} />
    </span>
  )
}

/** ひな形のカード（カード全体を押せる。選ぶとミントの枠） */
function TemplateCard({ selected, onSelect, title, summary, inputs }: { selected: boolean; onSelect: () => void; title: string; summary: string; inputs: string[] }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={title}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer rounded-xl px-3.5 py-3 ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-mint ${
        selected ? 'bg-mint/12 ring-2 ring-mint/70' : 'bg-white/5 ring-white/20 hover:bg-white/8 hover:ring-white/40'
      }`}
    >
      <p className={`flex items-center gap-1.5 font-bold ${selected ? 'text-mint' : 'text-white'}`}>
        {selected ? <CircleCheck className="size-4.5 shrink-0" aria-hidden /> : <span className="size-4 shrink-0 rounded-full ring-2 ring-white/40" aria-hidden />}
        {title}
      </p>
      <p className="mt-1 text-[0.84rem] leading-relaxed text-white/80">{summary}</p>
      <p className="mt-1 text-[0.78rem] text-subtle">使うファイル：{inputs.join('・')}</p>
    </div>
  )
}
