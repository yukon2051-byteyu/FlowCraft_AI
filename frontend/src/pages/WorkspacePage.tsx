import { Monitor } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { AppHeader } from '../components/workspace/AppHeader'
import { SampleWorkspace } from '../components/workspace/SampleWorkspace'
import { Stepper } from '../components/workspace/Stepper'
import { UploadStart } from '../components/workspace/UploadStart'
import type { DefineSource } from '../components/workspace/UploadStart'
import { DefineInputs } from '../components/workspace/DefineInputs'
import { FlowSteps } from '../components/workspace/FlowSteps'
import { buildFromChoices } from '../flow/define'
import type { InputChoice } from '../flow/define'
import { useFlowStore } from '../flow/store'

/** 作る画面の中の表示：ファイルの確認 → 使う列と形式を決める → 作業手順 */
type Screen = 'data' | 'define' | 'edit'

const SKIP_AI = [{ step: 2, reason: 'AIで作業手順を作る機能は開発中のため、今回は自分で作ります' }]

/** 選んだファイル・シート・見出し行が同じなら、決めた内容を残す（変わったら最初から決め直す） */
const sourcesKey = (sources: DefineSource[]) => sources.map((s) => `${s.summary.file_id}:${s.detail.sheet}:${s.detail.header_row}`).join('|')

/**
 * ワークスペース（フロー編集画面）。
 * ?view=sample のときはサンプルフローを表示する（URLで状態を持つので、再読み込みしても同じ表示になる）。
 * PC専用：幅1024px未満では案内のみ表示する。
 */
export default function WorkspacePage() {
  const [params, setParams] = useSearchParams()
  const sample = params.get('view') === 'sample'
  const [fileCount, setFileCount] = useState(0)
  const [sampleHint, setSampleHint] = useState('')
  const [screen, setScreen] = useState<Screen>('data')
  const [sources, setSources] = useState<DefineSource[] | null>(null)
  const startFromInputs = useFlowStore((s) => s.startFromInputs)

  const start = (choices: InputChoice[]) => {
    const built = buildFromChoices(choices)
    startFromInputs(built.definitions, built.bindings, built.loadNodes)
    setScreen('edit')
  }

  return (
    <>
      <div className="hidden h-screen min-h-[640px] flex-col bg-canvas lg:flex">
        <AppHeader flowName={sample ? '月次売上集計' : '無題の作業手順'} unsaved={sample} canExport={false} />
        {sample ? (
          <>
            <Stepper current={3} hint={sampleHint} />
            <SampleWorkspace onClose={() => setParams({})} onHintChange={setSampleHint} />
          </>
        ) : (
          <>
            <Stepper
              current={screen === 'edit' ? 3 : 1}
              skipped={screen === 'data' ? [] : SKIP_AI}
              hint={
                screen === 'edit'
                  ? '読み込みのステップができました。続けて処理ステップを追加します（開発中）'
                  : screen === 'define'
                    ? '作業手順で使う列と、データの形式を決めてください'
                    : fileCount === 0
                      ? '処理に使うExcel・CSVファイルを読み込んでください'
                      : '列名とデータの形式、先頭の行を確認してください（必要なファイルはすべて読み込みましたか？）'
              }
            />
            {/* 戻ったときに選んだ内容が消えないよう、画面を切り替えても部品は残しておく */}
            <div className={screen === 'data' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <UploadStart
                onShowSample={() => setParams({ view: 'sample' })}
                onFileCountChange={setFileCount}
                onDefine={(s) => {
                  setSources((prev) => (prev && sourcesKey(prev) === sourcesKey(s) ? prev : s))
                  setScreen('define')
                }}
              />
            </div>
            {sources && (
              <div className={screen === 'define' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                <DefineInputs key={sourcesKey(sources)} sources={sources} onBack={() => setScreen('data')} onStart={start} />
              </div>
            )}
            {screen === 'edit' && <FlowSteps onBack={() => setScreen('define')} />}
          </>
        )}
      </div>
      <PcOnlyNotice />
    </>
  )
}

function PcOnlyNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 lg:hidden">
      <div className="light-panel max-w-sm rounded-2xl p-7 text-center shadow-xl">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-mint-soft text-forest">
          <Monitor className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-[1.25rem] font-bold">この画面はPC向けです</h1>
        <p className="mt-2 leading-relaxed text-ink/80">
          作業手順の編集画面は、画面幅の広いPC（1280px以上を推奨）でのご利用を想定しています。PCのブラウザで開いてください。
        </p>
        <div className="mt-5">
          <Button to="/" variant="secondary">
            トップへ戻る
          </Button>
        </div>
      </div>
    </div>
  )
}
