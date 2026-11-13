import { CircleCheck, Info, LoaderCircle, Save, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, saveBlob } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { stepIndexOf, validateFlow } from '../../api/flows'
import { flowFileName, flowFileText, saveToLibrary } from '../../flow/library'
import { inferColumns, paramProblems } from '../../flow/params'
import { selectIsDirty, useFlowStore } from '../../flow/store'
import { Button } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'

/*
 * タスク1-8：作業手順を保存する画面（ダイアログ）。
 *
 * 処理の流れ：
 *   1. 名前と説明を入力し、保存先（ブラウザの一覧／ファイル）を選ぶ
 *   2. サーバーで「形の決まり」を検証する（決まりに合わない内容は保存しない＝後で開けないファイルを作らない）
 *   3. 版数を決めて保存済みにする（初めては版1、変更があれば1つ上げる）
 *   4. ブラウザの一覧に保存し、ファイル（.json）をダウンロードする
 * 保存するのは作業手順（処理の手順と使う列の定義）だけ。Excelの中身や、どのファイルを割り当てたかは保存しない。
 */

const NAME_MAX = 100

type Done = { version: number; library: string | null; libraryError: string | null; fileName: string | null; executable: boolean }

export function SaveDialog({ onClose }: { onClose: () => void }) {
  const flow = useFlowStore((s) => s.flow)
  const neverSaved = useFlowStore((s) => s.savedSnapshot === null)
  const commitSave = useFlowStore((s) => s.commitSave)
  const [name, setName] = useState(flow.flow_name)
  const [description, setDescription] = useState(flow.description)
  // 保存済みの手順を開いているとき：上書き（新しい版）か、別名で保存（複製：新しい手順として版1から）か
  const [asCopy, setAsCopy] = useState(false)
  const duplicateAsNew = useFlowStore((s) => s.duplicateAsNew)
  const [toLibrary, setToLibrary] = useState(true)
  const [toFile, setToFile] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.select()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  const meta = { flow_name: trimmed, description: description.trim() }
  // 保存したときの版：初めては今の版のまま、変更があれば1つ上がる
  const changed = selectIsDirty({ ...useFlowStore.getState(), flow: { ...flow, ...meta } })
  const nextVersion = neverSaved || !changed ? flow.flow_version : flow.flow_version + 1

  const nameError = trimmed === '' ? '作業手順の名前を入力してください。' : trimmed.length > NAME_MAX ? `名前は${NAME_MAX}文字以内にしてください。` : null
  const placeError = !toLibrary && !toFile ? '保存先を1つ以上選んでください。' : null

  const save = async () => {
    if (nameError || placeError) return
    setBusy(true)
    setProblems([])
    setError(null)
    try {
      // 2. 形の決まりの検証（保存する内容そのもので確かめる）
      const result = await validateFlow({ ...flow, ...meta })
      if (!result.valid) {
        // ステップごとに、画面の判定（分かりやすい日本語）があればそれを、なければサーバーの指摘を示す
        const columns = inferColumns(flow)
        const local = flow.nodes.map((n) => paramProblems(n, n.input_references.map((r) => columns[r] ?? null)))
        const label = (i: number) => `ステップ${i + 1}「${flow.nodes[i]?.node_name ?? ''}」`
        const fromServer = result.schema_errors.flatMap((e) => {
          const i = stepIndexOf(e.location)
          if (i === null) return [e.message]
          return local[i]?.length ? [] : [`${label(i)}：${e.message}`]
        })
        const fromLocal = local.flatMap((ps, i) => (result.schema_errors.some((e) => stepIndexOf(e.location) === i) ? ps.map((p) => `${label(i)}：${p}`) : []))
        // 項目どうしのつながりの誤り（例：完了基準が存在しないステップを指している）
        const structural = result.issues
          .filter((x) => x.severity === 'error')
          .map((x) => {
            const i = flow.nodes.findIndex((n) => n.node_id === x.node_id)
            return i >= 0 ? `${label(i)}：${x.message}` : x.message
          })
        setProblems([...new Set([...fromLocal, ...fromServer, ...structural])])
        return
      }
      // 3〜4. 保存（別名で保存するときは、先に新しい手順IDの写しにする。複製元は品質ルールごとに記録される）
      if (asCopy && !neverSaved) duplicateAsNew({ name: meta.flow_name, description: meta.description })
      const saved = commitSave(meta)
      const lib = toLibrary ? saveToLibrary(saved) : null
      let fileName: string | null = null
      if (toFile) {
        fileName = flowFileName(saved)
        saveBlob(fileName, new Blob([flowFileText(saved)], { type: 'application/json' }))
      }
      setDone({
        version: saved.flow_version,
        library: lib?.ok ? 'このブラウザの「保存した作業手順」' : null,
        libraryError: lib && !lib.ok ? lib.error : null,
        fileName,
        executable: result.executable,
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: '保存できませんでした。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="light-panel max-h-[calc(100vh-3rem)] w-full max-w-[560px] overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-[1.2rem] font-bold">
            <Save className="size-5 text-forest" aria-hidden />
            作業手順を保存
          </h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-muted hover:bg-ink/6 hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {done ? (
          <div className="mt-4 space-y-3" role="status">
            <p className="flex items-center gap-2 font-bold text-success-ink">
              <CircleCheck className="size-5" aria-hidden />
              「{meta.flow_name}」を版{done.version}として保存しました
            </p>
            <ul className="list-disc space-y-1 pl-6 text-[0.92rem]">
              {done.library && <li>保存先：{done.library}</li>}
              {done.fileName && <li>ファイル：「{done.fileName}」（ブラウザのダウンロード先をご確認ください）</li>}
            </ul>
            {done.libraryError && (
              <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-[0.88rem] text-warning-ink ring-1 ring-warning/40">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {done.libraryError}
              </p>
            )}
            {!done.executable && (
              <p className="flex items-start gap-1.5 text-[0.88rem] text-ink/80">
                <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                まだ設定が終わっていないステップがあります。作りかけのまま保存したので、開いたあとに続きを設定してください。
              </p>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="dark" onClick={onClose}>
                閉じる
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className="block">
              <span className="text-[0.9rem] font-bold">作業手順の名前</span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX + 20}
                aria-invalid={!!nameError}
                className="mt-1 h-10 w-full rounded-lg bg-paper px-3 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              />
              {nameError && <span className="mt-1 block text-[0.85rem] text-error-ink">{nameError}</span>}
            </label>
            <label className="block">
              <span className="text-[0.9rem] font-bold">説明（任意）</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="例：毎月5営業日目に、前月の売上を部署別に集計する"
                className="mt-1 w-full rounded-lg bg-paper px-3 py-2 ring-1 ring-line focus:ring-2 focus:ring-forest focus:outline-none"
              />
            </label>

            {!neverSaved && (
              <fieldset>
                <legend className="text-[0.9rem] font-bold">保存のしかた</legend>
                <label className="mt-1.5 flex items-start gap-2">
                  <input type="radio" name="save-mode" checked={!asCopy} onChange={() => setAsCopy(false)} className="mt-1 size-4 accent-forest" />
                  <span>
                    この作業手順を更新する（上書き）
                    <span className="block text-[0.82rem] text-muted">同じ作業手順の新しい版として保存します。</span>
                  </span>
                </label>
                <label className="mt-1.5 flex items-start gap-2">
                  <input
                    type="radio"
                    name="save-mode"
                    checked={asCopy}
                    onChange={() => {
                      setAsCopy(true)
                      // 同じ名前の手順が2つにならないよう、名前を変えていなければ「（コピー）」を付ける
                      if (name.trim() === flow.flow_name) setName(`${flow.flow_name}（コピー）`)
                    }}
                    className="mt-1 size-4 accent-forest"
                  />
                  <span>
                    別名で保存（複製して新しい作業手順にする）
                    <span className="block text-[0.82rem] text-muted">
                      新しい手順として版1から保存し、もとの手順はそのまま残します。品質ルールは写しますが、対象の列・期間・基準値を確かめるまで「未確認」になります。実行の記録と前回比較の基準は引き継ぎません。
                    </span>
                  </span>
                </label>
              </fieldset>
            )}

            <fieldset>
              <legend className="text-[0.9rem] font-bold">保存先</legend>
              <label className="mt-1.5 flex items-start gap-2">
                <input type="checkbox" checked={toLibrary} onChange={(e) => setToLibrary(e.target.checked)} className="mt-1 size-4 accent-forest" />
                <span>
                  このブラウザの「保存した作業手順」
                  <span className="block text-[0.82rem] text-muted">このPCのこのブラウザでだけ開けます。ブラウザのデータを消すと消えます。</span>
                </span>
              </label>
              <label className="mt-1.5 flex items-start gap-2">
                <input type="checkbox" checked={toFile} onChange={(e) => setToFile(e.target.checked)} className="mt-1 size-4 accent-forest" />
                <span>
                  ファイル（.json）としてダウンロード
                  <span className="block text-[0.82rem] text-muted">ほかのPCで開いたり、共有フォルダで管理したりできます。</span>
                </span>
              </label>
              {placeError && <span className="mt-1 block text-[0.85rem] text-error-ink">{placeError}</span>}
            </fieldset>

            <p className="rounded-lg bg-ink/5 px-3 py-2 text-[0.85rem] text-ink/80">
              {neverSaved ? '初めての保存です。版1として保存します。' : asCopy ? '新しい作業手順として、版1で保存します。' : changed ? `変更があるため、版${nextVersion}として保存します（前の版：${flow.flow_version}）。` : `変更はありません。版${nextVersion}のまま、もう一度保存します。`}
              <br />
              保存するのは処理の手順と使う列の定義だけです。Excelの中身（業務データ）は保存しません。
            </p>

            {problems.length > 0 && (
              <div className="rounded-lg bg-error-soft px-3 py-2 text-[0.88rem] text-error-ink ring-1 ring-error/40" role="alert">
                <p className="font-bold">このままでは、保存したファイルを後で開けません。次の点を直してから保存してください。</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[0.82rem]">設定が終わっていないステップは、設定するか削除すれば保存できます（ほかのステップは作りかけでも保存できます）。</p>
              </div>
            )}
            {error && <ErrorNotice error={error} />}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>
                やめる
              </Button>
              <Button type="submit" variant="primary" disabled={busy || !!nameError || !!placeError}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                保存する
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
