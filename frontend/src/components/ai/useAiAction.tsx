import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../../api/client'
import type { ApiErrorBody } from '../../api/client'
import { AiAuthDialog } from './AiAuthDialog'

/**
 * AIを使う操作の共通の部品（docs/ai-auth-design.md §5）。すべての AI のボタンで使う。
 *   まず AI の API を呼ぶ → サーバーが「認証が必要」（AI_AUTH_REQUIRED）を返したら、やろうとした操作を覚えたまま
 *   パスワード入力を開く → 認証に成功したら、同じ操作を自動でもう一度呼ぶ（利用者はボタンを押し直さない）
 *   キャンセル：入力を閉じるだけ（画面の入力はそのまま）
 * そのほかのエラー（AIを使えない・上限・応答を確かめられない）は error に入れ、画面が理由とAIなしの道を示す
 */
export function useAiAction<T>(action: () => Promise<T>, onDone: (result: T) => void): { run: () => void; busy: boolean; error: ApiErrorBody | null; dialog: ReactNode } {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const run = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      onDone(await action())
    } catch (e) {
      if (e instanceof ApiError && e.body.code === 'AI_AUTH_REQUIRED') setAsking(true)
      else setError(e instanceof ApiError ? e.body : { code: 'UNKNOWN', message: 'AIの操作に失敗しました。', cause: null, how_to_fix: 'もう一度お試しください。', node_id: null })
    } finally {
      setBusy(false)
    }
  }, [action, onDone])
  const dialog = asking ? (
    <AiAuthDialog
      onCancel={() => setAsking(false)}
      onAuthed={() => {
        setAsking(false)
        void run()
      }}
    />
  ) : null
  return { run: () => void run(), busy, error, dialog }
}
