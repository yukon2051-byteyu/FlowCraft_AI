import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { NODE_STATUS } from '../components/ui/nodeStatus'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { NodeStatus } from '../components/ui/nodeStatus'

// バックエンドの /api/health が返す形（backend/app/api/health.py の HealthResponse と同じ）
type Health = {
  status: string
  engine_version: string
  ai_mode: 'live' | 'fixed'
}

type State = { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string }

/**
 * 開発者向けの診断画面（/dev/diagnostics）。
 * TOPから撤去した「バックエンド接続確認」と「ノード状態の色見本」をここに移した。
 */
export default function DiagnosticsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ kind: 'ok', health: (await res.json()) as Health })
      })
      .catch(() =>
        setState({ kind: 'error', message: 'バックエンドに接続できません。backend フォルダでサーバーを起動してください。' }),
      )
  }, [])

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-[1.5rem] font-bold text-navy">システム状態（開発者向け）</h1>
        <Link to="/" className="text-accent hover:underline">
          トップへ戻る
        </Link>
      </div>

      <section className="rounded-xl bg-white p-6 ring-1 ring-line">
        <h2 className="mb-3 font-bold">バックエンド接続</h2>
        {state.kind === 'loading' && <p className="text-muted">確認中…</p>}
        {state.kind === 'ok' && (
          <p className="text-success">
            ✔ 接続OK（エンジン v{state.health.engine_version}／AI：
            {state.health.ai_mode === 'live' ? '接続中' : '固定応答モード（AI未接続）'}）
          </p>
        )}
        {state.kind === 'error' && <p className="text-error">✖ {state.message}</p>}
      </section>

      <section className="rounded-xl bg-white p-6 ring-1 ring-line">
        <h2 className="mb-3 font-bold">ノード状態の表示（仕様 9.3）</h2>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(NODE_STATUS) as NodeStatus[]).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </section>
    </main>
  )
}
