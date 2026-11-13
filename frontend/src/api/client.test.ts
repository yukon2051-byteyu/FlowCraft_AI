import { describe, expect, it } from 'vitest'
import { describeHttpFailure } from './client'

describe('サーバーが共通の形で答えなかったときの説明（HTTP の状態ごと）', () => {
  it('404：窓口がない＝画面とサーバーの版の食い違いを疑い、起動し直す方法を示す', () => {
    const e = describeHttpFailure(404, '/api/demos/monthly_sales/start?x=1')
    expect(e.code).toBe('API_NOT_FOUND')
    expect(e.message).toContain('HTTP 404')
    expect(e.message).not.toContain('通信できませんでした')
    expect(e.cause).toContain('窓口：/api/demos/monthly_sales/start')
    expect(e.how_to_fix).toContain('起動し直して')
  })

  it('500番台：サーバーの停止・問題。それ以外：想定外の応答', () => {
    expect(describeHttpFailure(502, '/api/x')).toMatchObject({ code: 'SERVER_ERROR', message: 'サーバーで問題が起きました（HTTP 502）。' })
    expect(describeHttpFailure(418, '/api/x').code).toBe('NETWORK_ERROR')
  })
})
