import { Monitor } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { AppHeader } from '../components/workspace/AppHeader'
import { SampleWorkspace } from '../components/workspace/SampleWorkspace'
import { Stepper } from '../components/workspace/Stepper'
import { UploadStart } from '../components/workspace/UploadStart'

/**
 * ワークスペース（フロー編集画面）。
 * ?view=sample のときはサンプルフローを表示する（URLで状態を持つので、再読み込みしても同じ表示になる）。
 * PC専用：幅1024px未満では案内のみ表示する。
 */
export default function WorkspacePage() {
  const [params, setParams] = useSearchParams()
  const sample = params.get('view') === 'sample'
  const [fileCount, setFileCount] = useState(0)

  return (
    <>
      <div className="hidden h-screen min-h-[640px] flex-col bg-canvas lg:flex">
        <AppHeader flowName={sample ? '月次売上集計' : '無題のフロー'} unsaved={sample} canExport={false} />
        {sample ? (
          <>
            <Stepper current={3} hint="AIの提案を確認し、すべてのステップを確定してください" />
            <SampleWorkspace onClose={() => setParams({})} />
          </>
        ) : (
          <>
            <Stepper
              current={1}
              hint={
                fileCount === 0
                  ? '処理に使うExcel・CSVファイルを読み込んでください'
                  : '列名と型、先頭の行を確認してください（必要なファイルはすべて読み込みましたか？）'
              }
            />
            <UploadStart onShowSample={() => setParams({ view: 'sample' })} onFileCountChange={setFileCount} />
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
          フローの編集画面は、画面幅の広いPC（1280px以上を推奨）でのご利用を想定しています。PCのブラウザで開いてください。
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
