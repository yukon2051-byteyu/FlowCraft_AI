import { overflow } from '../flow/history'
import type { RunRecord } from '../flow/history'

/*
 * 実行の履歴の保存先：このブラウザの IndexedDB（src/flow/history.ts の方針）。
 * 置き場は2つ：runs（通常の履歴）／demo_runs（デモの記録。デモを始めるたびに入れ替える）。
 * IndexedDB が使えないとき（プライベートブラウズなど）は保存しない（画面の動きは止めない。available() で知らせる）。
 */

type Scope = 'normal' | 'demo'
const DB_NAME = 'flowcraft-history'
const STORE: Record<Scope, string> = { normal: 'runs', demo: 'demo_runs' }

let scope: Scope = 'normal'
/** 今の実行がデモか（デモの記録は別の置き場に入れる）。ワークスペースの画面が切り替える */
export function setHistoryScope(s: Scope): void {
  scope = s
}
export function historyScope(): Scope {
  return scope
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB を使えません'))
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const d = req.result
        for (const name of Object.values(STORE)) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'run_id' }).createIndex('flow_id', 'flow_id')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => (dbPromise = null))
  }
  return dbPromise
}

function tx<T>(s: Scope, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(STORE[s], mode)
        const r = run(t.objectStore(STORE[s]))
        t.oncomplete = () => resolve(r ? r.result : undefined)
        t.onerror = () => reject(t.error)
      }),
  )
}

export async function available(): Promise<boolean> {
  try {
    await db()
    return true
  } catch {
    return false
  }
}

export async function listRecords(s: Scope = scope): Promise<RunRecord[]> {
  try {
    return ((await tx<RunRecord[]>(s, 'readonly', (st) => st.getAll())) ?? []) as RunRecord[]
  } catch {
    return []
  }
}

/** 記録を保存し、作業手順ごとに最新200件を超えた分を消す。消した件数を返す */
export async function saveRecord(rec: RunRecord, s: Scope = scope): Promise<number> {
  try {
    await tx(s, 'readwrite', (st) => st.put(rec))
    const extra = overflow(await listRecords(s))
    for (const id of extra) await tx(s, 'readwrite', (st) => st.delete(id))
    return extra.length
  } catch {
    return 0
  }
}

export async function putRecords(recs: RunRecord[], s: Scope = 'normal'): Promise<void> {
  for (const r of recs) await tx(s, 'readwrite', (st) => st.put(r))
}

export async function deleteRecord(runId: string, s: Scope = 'normal'): Promise<void> {
  await tx(s, 'readwrite', (st) => st.delete(runId))
}

export async function clearRecords(s: Scope, flowId?: string): Promise<void> {
  if (!flowId) {
    await tx(s, 'readwrite', (st) => st.clear())
    return
  }
  for (const r of await listRecords(s)) if (r.flow_id === flowId) await deleteRecord(r.run_id, s)
}

/** 正式な出力を行った記録に印を付ける（前回比較の「業務の数値」の相手になる） */
export async function markPerformed(runId: string, s: Scope = scope, at: Date = new Date()): Promise<void> {
  try {
    const rec = (await tx<RunRecord>(s, 'readonly', (st) => st.get(runId))) as RunRecord | undefined
    if (!rec) return
    await tx(s, 'readwrite', (st) => st.put({ ...rec, official_output: { ...rec.official_output, performed: true, performed_at: at.toISOString() } }))
  } catch {
    // 保存できなくても、出力そのものは終わっている
  }
}

/** 保存を消されにくくするよう、ブラウザに永続化を求める（できなければ false） */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
