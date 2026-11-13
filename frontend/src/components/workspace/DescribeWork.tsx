import { ArrowLeft, ArrowRight, Info } from 'lucide-react'
import { useState } from 'react'
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
 * 改善診断（任意）：AI改善診断と簡易チェック（K1）は別の機能。どちらも開発中のため選べない（見せかけの画面は作らない）。
 * 手順の作り方：AIで作る（開発中）／処理部品を組み合わせて作る（Excelを読み込んで列を確かめながら）。
 * 「改善診断を受けない」と「AIを使わない」は別のこと。AIを使う操作のときだけ、その直前にAI使用パスワードを求める。
 * 品質検証は、どの作り方でも省略しない。
 */

type Props = {
  initialName: string
  initialDescription: string
  onBack: () => void
  onNext: (v: { name: string; description: string; diagnosis: DiagnosisState; method: BuildMethod; templateId: string | null }) => void
  busy?: boolean
}

const DEFAULT_NAME = '無題の作業手順'

export function DescribeWork({ initialName, initialDescription, onBack, onNext, busy = false }: Props) {
  const [name, setName] = useState(initialName === DEFAULT_NAME ? '' : initialName)
  const [description, setDescription] = useState(initialDescription)
  const aiDiagnosis = isAvailable('kaizen')
  const quickCheck = isAvailable('kaizenCheck')
  const aiBuild = isAvailable('aiFlow')
  const [method, setMethod] = useState<BuildMethod>('template')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const templates = useQuery({ queryKey: ['templates'], queryFn: listTemplates })
  const trimmed = name.trim()
  const problem = !trimmed
    ? '案件名を入れてください'
    : trimmed.length > 100
      ? '案件名は100文字以内にしてください'
      : method === 'template' && !templateId
        ? 'もとにするひな形を選んでください'
        : null

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1000px] space-y-5 px-6 py-6">
          <section className="light-panel space-y-4 rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)] p-7" aria-label="作業を伝える">
            <div>
              <p className="text-[0.85rem] font-bold text-forest">やりたい作業から始める</p>
              <h1 className="mt-0.5 text-[1.6rem] leading-tight font-bold">やりたい作業を伝える</h1>
              <p className="mt-1.5 text-ink/80">入力した内容は、作業手順の名前と目的として保存され、次の画面にも引き継がれます。Excelはまだ必要ありません。</p>
            </div>
            <label className="block">
              <span className="text-[0.88rem] font-bold">案件名（作業の名前）</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：月次売上集計"
                maxLength={120}
                aria-label="案件名"
                className="mt-1 h-11 w-full rounded-lg bg-card px-3 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[0.88rem] font-bold">やりたい作業・目的</span>
              <span className="ml-2 text-[0.8rem] text-muted">任意</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="例：毎月、各部署から届く売上Excelをまとめ、商品マスタと結合し、部署別の売上を集計したい。営業会議で使う。"
                aria-label="やりたい作業・目的"
                className="mt-1 w-full rounded-lg bg-card px-3 py-2 leading-relaxed ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              />
            </label>
          </section>

          <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="この作業を見直しますか">
            <h2 className="font-bold text-white">この作業を見直しますか？（任意）</h2>
            <p className="mt-1 text-[0.88rem] text-subtle">どちらを選んでも、手順の作成と実行に進めます。実行するときの品質の確認は、必ず行います。</p>
            <div className="mt-3 grid gap-2.5 grid-cols-3" role="radiogroup" aria-label="改善診断">
              <Choice selected={false} disabled={!aiDiagnosis} title="AI改善診断を受ける" body="不要な作業や重複した工程を見つけ、より簡単な手順を検討します。" feature="kaizen" />
              <Choice selected={false} disabled={!quickCheck} title="簡易チェックで見直す" body="決まった6つの質問で、廃止・簡素化・標準化・自動化の方向を確かめます（AIを使いません）。" feature="kaizenCheck" />
              <Choice selected title="診断せずに進む" body="今の作業内容をもとに、処理手順の作成へ進みます。" />
            </div>
          </section>

          <section className="rounded-2xl bg-panel p-5 ring-1 ring-edge" aria-label="手順の作り方">
            <h2 className="font-bold text-white">手順の作り方</h2>
            <div className="mt-3 grid gap-2.5 grid-cols-3" role="radiogroup" aria-label="手順の作り方">
              <Choice selected={false} disabled={!aiBuild} title="AIで手順を作る" body="作業の説明から、AIが処理手順を提案します（開発中。使うときにはAI使用パスワードが必要になります）。" feature="aiFlow" />
              <Choice
                selected={method === 'template'}
                onSelect={() => setMethod('template')}
                title="ひな形から作る"
                body="よくある業務の手順をもとに、仮の手順を作ります。Excelを読み込んだ後に、列を照合して確定します。"
              />
              <Choice
                selected={method === 'parts_from_data'}
                onSelect={() => setMethod('parts_from_data')}
                title="処理部品を組み合わせて作る"
                body="Excelを読み込み、実際の列を確かめながら、加工・集計の部品を組み合わせます。ひな形にない業務にも使えます。"
              />
            </div>
            {method === 'template' && (
              <div className="mt-3" role="radiogroup" aria-label="もとにするひな形">
                {templates.isPending && <p className="text-[0.85rem] text-subtle">ひな形を読み込んでいます…</p>}
                <div className="grid gap-2 grid-cols-3">
                  {(templates.data ?? []).map((t) => (
                    <Choice
                      key={t.template_id}
                      selected={templateId === t.template_id}
                      onSelect={() => setTemplateId(t.template_id)}
                      title={t.title}
                      body={`${t.summary}（使うファイル：${t.inputs.join('・')}）`}
                    />
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[0.82rem] text-subtle">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              「改善診断を受けない」と「AIを使わない」は別のことです。AIを使う操作を選んだときだけ、その直前にパスワードの入力を求めます。
            </p>
          </section>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-edge bg-nav px-6 py-3">
        <Button variant="ghostDark" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          開始方法を選び直す
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {problem && <span className="text-[0.85rem] text-warning">{problem}</span>}
          <Button
            variant="primary"
            disabled={problem !== null || busy}
            onClick={() => onNext({ name: trimmed, description: description.trim(), diagnosis: 'skipped', method, templateId: method === 'template' ? templateId : null })}
          >
            {method === 'template' ? '次へ：手順を確認する' : '次へ：データを読み込む'}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </>
  )
}

/** 選択肢の表示。開発中のものは押せない（選んだように見せない）。onSelect があるものだけ選べる */
function Choice({
  selected,
  disabled = false,
  title,
  body,
  feature,
  onSelect,
}: {
  selected: boolean
  disabled?: boolean
  title: string
  body: string
  feature?: Parameters<typeof DevBadge>[0]['feature']
  onSelect?: () => void
}) {
  const selectable = !!onSelect && !disabled
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-label={title}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      title={disabled ? 'この機能は開発中のため、まだ選べません' : undefined}
      className={`rounded-xl p-3.5 ring-1 ${selected ? 'bg-mint/10 ring-2 ring-mint/60' : disabled ? 'bg-white/3 ring-edge' : 'bg-white/5 ring-edge'} ${
        selectable ? 'cursor-pointer hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-mint' : ''
      }`}
    >
      <p className={`flex flex-wrap items-center gap-2 font-bold ${selected ? 'text-mint' : disabled ? 'text-white/55' : 'text-white'}`}>
        {title}
        {feature && <DevBadge feature={feature} />}
      </p>
      <p className={`mt-1 text-[0.84rem] leading-relaxed ${disabled ? 'text-subtle/80' : 'text-white/80'}`}>{body}</p>
    </div>
  )
}
