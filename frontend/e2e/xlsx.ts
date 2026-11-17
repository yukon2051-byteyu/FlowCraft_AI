import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

/**
 * ダウンロードした Excel（.xlsx。中身は ZIP 形式）のシート名を、並び順のまま返す（E2E 用）。
 * 新しいライブラリを入れずに確かめるため、ZIP の目次から xl/workbook.xml だけを取り出して読む。
 */
export async function xlsxSheetNames(path: string): Promise<string[]> {
  const buf = await readFile(path)
  // ZIP の末尾にある「目次の終わり」から、目次の位置と数を読む
  let end = buf.length - 22
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('ZIP の形式ではありません')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (name === 'xl/workbook.xml') {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      const xml = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
      return [...xml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('xl/workbook.xml が見つかりません')
}
