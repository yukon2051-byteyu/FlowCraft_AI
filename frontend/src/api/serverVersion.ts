/*
 * 画面とサーバーの版の食い違いを見つける（デモ全面改善 §7：HTTP 404 の原因の切り分け）。
 * 2026-11-14 の調査：開発用サーバーが古い版のまま動き続け、デモの窓口がなく 404 になっていた。
 * 起動時に /api/health の api_revision を確かめ、古ければ原因と直し方を表示する（ダミーの結果には切り替えない）。
 * サーバー側の API_REVISION（backend/app/__init__.py）と同じ値にする（バックエンドのテストで確かめる）。
 */

export const EXPECTED_API_REVISION = 3

export type ServerCheck = { state: 'ok' } | { state: 'old'; revision: number | null } | { state: 'unreachable'; status: number | null }

export async function checkServer(): Promise<ServerCheck> {
  let res: Response
  try {
    res = await fetch('/api/health')
  } catch {
    return { state: 'unreachable', status: null }
  }
  if (!res.ok) return { state: 'unreachable', status: res.status }
  try {
    const body = (await res.json()) as { api_revision?: unknown }
    const revision = typeof body.api_revision === 'number' ? body.api_revision : null
    return revision !== null && revision >= EXPECTED_API_REVISION ? { state: 'ok' } : { state: 'old', revision }
  } catch {
    return { state: 'unreachable', status: res.status }
  }
}
