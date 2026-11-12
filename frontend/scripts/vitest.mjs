// Vitest の起動用。Windows でドライブ名が小文字（c:\）の作業フォルダから実行すると、
// 同じ部品が2回読み込まれて「テストの実行役が見つからない」エラーになるため、大文字にそろえて起動する。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase())
const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase())
const r = spawnSync(process.execPath, [cli, 'run', ...process.argv.slice(2)], { cwd, stdio: 'inherit' })
process.exit(r.status ?? 1)
