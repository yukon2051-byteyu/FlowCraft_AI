import { ArrowRight, CircleAlert, Info, Link2, Undo2 } from 'lucide-react'
import type { InputCheck } from '../../api/flows'
import { Button } from '../ui/Button'

/*
 * Phase 3-2：列の対応付けの確認（割当画面）。
 *
 * 前回の列が今回のファイルに見つからないとき、候補と理由を示して利用者に確かめる。
 *   「前回使っていた『売上金額』列が見つかりません。今回のファイルにある『金額』列を使いますか？」
 * **自動では対応付けない**（似た名前の列が2つあるときなど、取り違えると誤った集計になるため）。
 * 承認した対応付けは、今回の実行の割当にだけ記録する。保存した作業手順は変えない（P-4）。
 *
 * 列の順番の変化・必須の列の空欄は、お知らせだけ（実行は止めない。P-2・P-3）。
 */

type Props = {
  label: string
  check: InputCheck
  mapping: Record<string, string>
  onChange: (mapping: Record<string, string>) => void
}

export function ColumnMapping({ label, check, mapping, onChange }: Props) {
  const approve = (actual: string, defined: string) => onChange({ ...mapping, [actual]: defined })
  const undo = (actual: string) => onChange(Object.fromEntries(Object.entries(mapping).filter(([a]) => a !== actual)))
  // 前回の列のうち、まだ見つかっていないもの（必須を先に）
  const missing = [...check.missing].sort((a, b) => Number(b.required) - Number(a.required))
  const approved = Object.entries(mapping)

  if (!missing.length && !approved.length && !check.mapping_errors.length && !check.order_changed && !check.blank_required.length) return null

  return (
    <div className="mt-3 space-y-2.5" aria-label={`「${label}」の前回との違い`} role="region">
      {missing.map((m) => {
        const [top, ...others] = m.candidates
        const rest = check.added.filter((c) => c !== top?.column && !others.some((o) => o.column === c))
        return (
          <div
            key={m.name}
            role="group"
            aria-label={`前回の列「${m.name}」の対応付け`}
            className={`rounded-xl px-4 py-3 ring-1 ${m.required ? 'bg-warning-soft/60 ring-warning/40' : 'bg-card ring-line'}`}
          >
            <p className="font-bold">
              前回使っていた「{m.name}」列が見つかりません。
              {!m.required && <span className="ml-1 text-[0.85rem] font-normal text-muted">（任意の列。対応付けなければ空欄で読み込みます）</span>}
            </p>
            {top ? (
              <>
                <p className="mt-1">今回のファイルにある「{top.column}」列を使いますか？</p>
                <ul className="mt-1 list-disc pl-5 text-[0.85rem] text-muted" aria-label={`「${top.column}」を候補にした理由`}>
                  {top.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="dark" size="sm" onClick={() => approve(top.column, m.name)}>
                    <Link2 className="size-4" aria-hidden />「{top.column}」を使う
                  </Button>
                  {others.map((o) => (
                    <Button key={o.column} variant="secondary" size="sm" onClick={() => approve(o.column, m.name)} title={o.reasons.join('\n')}>
                      「{o.column}」を使う
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-[0.9rem] text-muted">似た列は見つかりませんでした。今回のファイルの列から選ぶか、正しいファイル・シート・見出しの行かを確かめてください。</p>
            )}
            {rest.length > 0 && (
              <label className="mt-2 flex flex-wrap items-center gap-2 text-[0.85rem] text-muted">
                ほかの列を選ぶ
                <select
                  value=""
                  onChange={(e) => e.target.value && approve(e.target.value, m.name)}
                  aria-label={`前回の「${m.name}」に使う、今回のファイルの列`}
                  className="h-9 rounded-lg bg-card px-2 text-ink ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
                >
                  <option value="">（選ぶ）</option>
                  {rest.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )
      })}

      {approved.length > 0 && (
        <div className="rounded-xl bg-mint-soft/60 px-4 py-3 ring-1 ring-forest/30" role="group" aria-label="承認した列の対応付け">
          <ul className="space-y-1.5">
            {approved.map(([actual, defined]) => (
              <li key={actual} className="flex flex-wrap items-center gap-2">
                <Link2 className="size-4 text-forest" aria-hidden />
                <span>
                  今回の「<b>{actual}</b>」
                  <ArrowRight className="mx-1 inline size-3.5" aria-hidden />
                  前回の「<b>{defined}</b>」として使います
                </span>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => undo(actual)}>
                  <Undo2 className="size-3.5" aria-hidden />
                  取り消す
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.82rem] text-muted">対応付けは今回の実行にだけ使い、処理の記録に残します。保存した作業手順は変わりません。</p>
        </div>
      )}

      {check.mapping_errors.map((e) => (
        <p key={e} className="flex items-start gap-1.5 text-[0.88rem] text-error-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {e}
        </p>
      ))}

      {check.order_changed && (
        <p className="flex items-start gap-1.5 text-[0.85rem] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          列の順番が前回と変わっています。列名で読み込むため、結果には影響しません。
        </p>
      )}
      {check.blank_required.map((b) => (
        <p key={b.name} className="flex items-start gap-1.5 text-[0.85rem] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          必須の列「{b.name}」に空欄が{b.count.toLocaleString()}件あります（Excelの行：{b.rows.join('、')}
          {b.count > b.rows.length ? ' など' : ''}）。空欄のまま読み込みます。
        </p>
      ))}
    </div>
  )
}
