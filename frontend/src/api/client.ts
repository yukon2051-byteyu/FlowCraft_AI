/**
 * バックエンドとの通信の共通部品。
 * - セッション番号を自動で取得し、すべてのリクエストに X-Session-Id として付ける
 * - エラーはバックエンド共通形式（message / cause / how_to_fix）の ApiError にそろえる
 *
 * セッション番号はタブごとの sessionStorage に保存する（タブを閉じれば消える）。
 * 期限切れのときは、新しい番号を黙って取り直さない。データが消えたことを利用者に伝えるため。
 */

const SESSION_KEY = 'flowcraft.session'

export type ApiErrorBody = {
  code: string
  message: string
  cause: string | null
  how_to_fix: string | null
  node_id: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.status = status
    this.body = body
  }

  /** セッションが無効（時間切れなど）で、読み込んだデータが失われた状態か */
  get isSessionLost(): boolean {
    return this.status === 401
  }
}

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSession(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // 保存できない環境（プライベートモード等）でも動作は続ける
  }
}

let memorySession: string | null = readSession()
let creating: Promise<string> | null = null

async function ensureSession(): Promise<string> {
  if (memorySession) return memorySession
  // 同時に複数の通信が始まっても、セッションの作成は1回だけにする
  creating ??= (async () => {
    const res = await fetch('/api/session', { method: 'POST' })
    if (!res.ok) throw await toApiError(res, '/api/session')
    const body = (await res.json()) as { session_id: string }
    memorySession = body.session_id
    writeSession(memorySession)
    return memorySession
  })().finally(() => {
    creating = null
  })
  return creating
}

/** このタブでセッションを開始済みか（一覧の復元で、新しいセッションを無駄に作らないため） */
export function hasSession(): boolean {
  return memorySession !== null
}

/** セッションを破棄する（期限切れを検知したとき・作業終了時） */
export function forgetSession(): void {
  memorySession = null
  writeSession(null)
}

/**
 * サーバーが共通の形のエラーを返さなかったときの説明（HTTP の状態ごとに、原因と直し方を変える）。
 * 404 を一律に「通信できませんでした」としない：窓口がない（画面とサーバーの版の食い違い）ことが多いため（2026-11-14 の調査）。
 */
export function describeHttpFailure(status: number, path: string): ApiErrorBody {
  if (status === 404) {
    return {
      code: 'API_NOT_FOUND',
      message: 'サーバーに、この機能の窓口が見つかりません（HTTP 404）。',
      cause: `画面とサーバーの版が合っていない可能性があります（サーバーが古い版のまま動いている、など）。窓口：${path.split('?')[0]}`,
      how_to_fix: '開発環境では、サーバーを止めて起動し直してください（README「使い方」）。直らないときは、画面を再読み込みしてください。',
      node_id: null,
    }
  }
  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: `サーバーで問題が起きました（HTTP ${status}）。`,
      cause: 'サーバーが止まっている、再起動の途中である、または処理の途中で問題が起きた可能性があります。',
      how_to_fix: 'サーバーが起動しているかを確かめ、しばらく待ってから、もう一度お試しください。',
      node_id: null,
    }
  }
  return {
    code: 'NETWORK_ERROR',
    message: `サーバーから想定外の応答がありました（HTTP ${status}）。`,
    cause: null,
    how_to_fix: 'しばらく待ってから、もう一度お試しください。',
    node_id: null,
  }
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  try {
    const data = (await res.json()) as { error?: ApiErrorBody }
    if (data.error) return new ApiError(res.status, data.error)
  } catch {
    // JSONでない応答（サーバー停止中など）
  }
  return new ApiError(res.status, describeHttpFailure(res.status, path))
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await ensureSession()
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { ...init.headers, 'X-Session-Id': session } })
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'サーバーに接続できませんでした。',
      cause: null,
      how_to_fix: 'ネットワーク接続を確認し、もう一度お試しください。',
      node_id: null,
    })
  }
  if (!res.ok) {
    const err = await toApiError(res, path)
    if (err.isSessionLost) forgetSession()
    throw err
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** ファイルを受け取って保存する（Excel出力など）。ファイル名はサーバーが付けた名前（日本語可）を使う */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const session = await ensureSession()
  let res: Response
  try {
    res = await fetch(path, { headers: { 'X-Session-Id': session } })
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'サーバーに接続できませんでした。',
      cause: null,
      how_to_fix: 'ネットワーク接続を確認し、もう一度お試しください。',
      node_id: null,
    })
  }
  if (!res.ok) {
    const err = await toApiError(res, path)
    if (err.isSessionLost) forgetSession()
    throw err
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const name = encoded ? decodeURIComponent(encoded) : fallbackName
  saveBlob(name, await res.blob())
  return name
}

/** 画面の中で作った内容を、ブラウザのダウンロードとしてファイルに保存する */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
