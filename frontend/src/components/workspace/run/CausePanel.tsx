import { ChevronDown, CircleX, OctagonX, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CauseGroup, OutputState } from '../../../flow/outputState'

/*
 * 結果画面の上部（レビュー指摘 1・2）：正式な出力を止めたことを先頭で示し、その下に原因と対応、再実行の操作を置く。
 * 値はすべて実行結果から（flow/outputState.ts）。
 */

/** 先頭の見出し：正式な出力を止めた（例：照合漏れ6行・正式出力停止） */
export function StopBanner({ state }: { state: OutputState }) {
  if (state.mode !== 'stopped' || !state.headline) return null
  return (
    <section className="rounded-2xl bg-error/12 px-5 py-4 ring-1 ring-error/45" role="alert" aria-label="正式出力停止">
      <h2 className="flex items-center gap-2 text-[1.4rem] font-bold text-error">
        <OctagonX className="size-6 shrink-0" aria-hidden />
        {state.headline}
      </h2>
      {state.reasons.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-9 text-[0.92rem] text-white/90" aria-label="停止の理由">
          {state.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 pl-8 text-[0.85rem] text-subtle">
        {state.completed ? '実行と品質検証は最後まで完了しました。' : '処理が途中で止まったため、品質検証も完了していません。'}
        正式な結果は出力できません。原因を調べるための調査用レポート（「確認結果」と「処理の記録」）だけを出力できます。
      </p>
    </section>
  )
}

/** 原因と対応：原因ごとの行数・直し方。該当する例と判定の根拠は、その場で開いて見られる */
export function CausePanel({ groups, actions, highlight = '', openTop = 0 }: { groups: CauseGroup[]; actions?: ReactNode; highlight?: string; openTop?: number }) {
  if (!groups.length) return null
  return (
    <section id="run-causes" className={`light-panel scroll-mt-4 rounded-2xl p-5 ${highlight}`} aria-label="原因と対応">
      <h2 className="font-bold">原因と対応</h2>
      <p className="mt-0.5 text-[0.85rem] text-muted">実行結果から、満たさなかった確認ごとに、原因と直し方をまとめています（AIは使っていません）。</p>
      <ol className="mt-3 space-y-3">
        {groups.map((g, i) => (
          <CauseCard key={g.id} g={g} openTick={i === 0 ? openTop : 0} />
        ))}
      </ol>
      {actions && <div className="mt-4 border-t border-line pt-4">{actions}</div>}
    </section>
  )
}

function CauseCard({ g, openTick }: { g: CauseGroup; openTick: number }) {
  const Icon = g.severity === 'critical' ? CircleX : TriangleAlert
  const tone = g.severity === 'critical' ? 'text-error-ink' : 'text-warning-ink'
  const evidence = Object.entries(g.evidence).filter(([k]) => !k.startsWith('原因：')) // 原因の内訳は下の表で示す
  return (
    <li className="rounded-xl bg-paper px-4 py-3 ring-1 ring-line" aria-label={`原因：${g.title}`}>
      <p className={`flex items-center gap-1.5 font-bold ${tone}`}>
        <Icon className="size-4.5 shrink-0" aria-hidden />
        {g.title}
        <span className="text-[0.8rem] font-normal text-muted">{g.severity === 'critical' ? '（重大）' : '（注意）'}</span>
      </p>
      <p className="mt-0.5 text-[0.92rem] text-ink/85">{g.summary}</p>
      {g.items.length > 0 ? (
        <table className="mt-2 w-full text-[0.88rem]" aria-label="原因の内訳">
          <thead className="text-left text-[0.8rem] text-muted">
            <tr>
              <th className="border-b border-line whitespace-nowrap py-1 pr-3 font-bold">原因</th>
              <th className="border-b border-line whitespace-nowrap py-1 pr-3 font-bold">行数</th>
              <th className="border-b border-line whitespace-nowrap py-1 pr-3 font-bold">直し方</th>
              <th className="border-b border-line whitespace-nowrap py-1 font-bold">該当する例</th>
            </tr>
          </thead>
          <tbody>
            {g.items.map((it) => (
              <tr key={it.label} className="border-b border-line/60 align-top last:border-0">
                <td className="py-1.5 pr-3 font-bold whitespace-nowrap">{it.label}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{it.rows === null ? '—' : `${it.rows.toLocaleString()}行`}</td>
                <td className="py-1.5 pr-3">{it.fix ?? '—'}</td>
                <td className="py-1.5">
                  {/* 空白の違いが見えるよう、かぎかっこで囲む */}
                  {it.examples.length ? it.examples.map((e) => `「${e}」`).join('、') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        g.fix && <p className="mt-1.5 text-[0.88rem] text-ink/85">対応：{g.fix}</p>
      )}
      {(g.examples.length > 0 || evidence.length > 0) && <Details g={g} evidence={evidence} openTick={openTick} />}
    </li>
  )
}

/** 該当する行の例と判定の根拠（原因のすぐ下で開く）。例の数に上限があるときは、全件数と表示件数を示す */
function Details({ g, evidence, openTick }: { g: CauseGroup; evidence: [string, string][]; openTick: number }) {
  // 画面下部の「異常の詳細を確認する」で移動してきたら（openTick が新しくなったら）、いちばん上の原因の例を開く
  const [state, setState] = useState({ open: false, tick: 0 })
  const open = openTick !== 0 && openTick !== state.tick ? true : state.open
  const setOpen = (v: boolean) => setState({ open: v, tick: openTick })
  const count = g.examples.length
  const label =
    g.total !== null && g.total > count
      ? `該当する例と判定の根拠（${g.total.toLocaleString()}${g.unit}中${count}${g.unit}を表示）`
      : `該当する例と判定の根拠（${count}${g.unit}）`
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-[0.82rem] font-bold text-forest hover:underline">
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        {label}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded-lg bg-ink/4 px-3 py-2">
          {evidence.length > 0 && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[0.82rem]" aria-label="判定の根拠">
              {evidence.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {count > 0 && (
            <ul className="space-y-0.5 text-[0.82rem] text-ink/80" aria-label="該当する例">
              {g.examples.map((e, i) => (
                <li key={i}>
                  {Object.entries(e)
                    .map(([k, v]) => `${k}：${String(v)}`)
                    .join(' ／ ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
