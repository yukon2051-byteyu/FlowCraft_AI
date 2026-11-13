import { beforeEach, describe, expect, it } from 'vitest'
import { clearKaizenState, handedFlow, handOffFlow, resumeState } from './handoff'

const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  globalThis.sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  } as unknown as Storage
})

describe('業務改善デモ ⇄ 作業手順の画面 の受け渡し', () => {
  it('作業手順と、戻ったときの状態を受け渡す。消すと残らない', () => {
    expect(handOffFlow({ flow_id: 'f' }, { step: 3, decisions: { A: { status: 'adopt', reason: '', confirm: 'none' } }, improvement: null })).toBe(true)
    expect(handedFlow()).toEqual({ flow_id: 'f' })
    expect(resumeState()?.step).toBe(3)
    clearKaizenState()
    expect(handedFlow()).toBeNull()
    expect(resumeState()).toBeNull()
  })

  it('壊れた内容・形の違う内容は戻さない。保存できない環境では false', () => {
    mem.set('flowcraft.kaizen.state', '{')
    expect(resumeState()).toBeNull()
    mem.set('flowcraft.kaizen.state', '{"step":"x"}')
    expect(resumeState()).toBeNull()
    globalThis.sessionStorage = {
      setItem: () => {
        throw new Error('quota')
      },
    } as unknown as Storage
    expect(handOffFlow({}, { step: 3, decisions: {}, improvement: null })).toBe(false)
  })
})
