/*
 * デモで読み込んだファイルの記録（このタブの sessionStorage。読み込み直しても分かるように）。
 *
 * 2026-11-16 の不具合：デモを動かした後に「自分のExcelで試す」で作業の画面を開くと、
 * デモの作業手順（画面のメモリ上の状態）とデモのファイル（サーバーのセッション）が残ったまま表示されていた。
 * デモを始めたときにファイルを記録し、デモ以外の入口で開いたときに、デモのものだけを後片付けする
 * （利用者が自分で読み込んだファイルは消さない）。
 */

const KEY = 'flowcraft.demo.files'

export function markDemoSession(fileIds: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(fileIds))
  } catch {
    // 保存できない環境でも、デモの動きは止めない
  }
}

/** デモの後片付けが必要か（デモで読み込んだファイルの記録があるか） */
export function hasDemoSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

/** デモで読み込んだファイルを返し、記録を消す */
export function takeDemoSession(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
