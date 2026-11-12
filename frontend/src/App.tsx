import { useEffect, useState } from 'react'

// バックエンドの /api/health が返す形（backend/app/api/health.py の HealthResponse と同じ）
type Health = {
  status: string
  engine_version: string
  ai_mode: 'live' | 'fixed'
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string }

/**
 * タスク1-3時点の仮画面。
 * 配色が正しく効いているか、バックエンドと通信できるかを確認するためのもの。
 * タスク1-4・1-5でTOP画面・ワークスペース画面に置き換える。
 */
export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ kind: 'ok', health: (await res.json()) as Health })
      })
      .catch(() =>
        setState({
          kind: 'error',
          message: 'バックエンドに接続できません。backend フォルダでサーバーを起動してください。',
        }),
      )
  }, [])

  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-6 text-lg font-bold">
          FlowCraft AI
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <h1 className="text-2xl font-bold">そのExcel作業、次からはワンクリック。</h1>

        <section className="rounded-lg border border-line bg-card p-6">
          <h2 className="mb-3 font-bold">バックエンド接続確認</h2>
          {state.kind === 'loading' && <p className="text-muted">確認中…</p>}
          {state.kind === 'ok' && (
            <p className="text-success">
              ✔ 接続OK（エンジン v{state.health.engine_version}／AI：
              {state.health.ai_mode === 'live' ? '接続中' : '固定応答モード（AI未接続）'}）
            </p>
          )}
          {state.kind === 'error' && <p className="text-error">✖ {state.message}</p>}
        </section>

        <section className="rounded-lg border border-line bg-card p-6">
          <h2 className="mb-3 font-bold">ノード状態の色（仕様 9.3）</h2>
          <div className="flex gap-3">
            <StatusChip className="border-muted text-muted" icon="○" label="未設定" />
            <StatusChip className="border-accent bg-accent-soft text-accent" icon="✦" label="AI提案" />
            <StatusChip className="border-success text-success" icon="✔" label="確定" />
            <StatusChip className="border-warning text-warning" icon="!" label="警告" />
            <StatusChip className="border-error text-error" icon="✖" label="エラー" />
          </div>
        </section>
      </main>
    </div>
  )
}

function StatusChip({ className, icon, label }: { className: string; icon: string; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border-2 px-3 py-1 font-medium ${className}`}>
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  )
}
