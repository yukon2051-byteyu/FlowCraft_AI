import { defineConfig } from '@playwright/test'

/**
 * E2Eテスト（実際のブラウザで画面を操作するテスト）の設定。
 * テスト専用のバックエンド（8001）と画面の開発サーバー（5174）を毎回起動する。
 * 普段の開発用サーバー（8000／5173）を使い回すと、古いコードのままテストしてしまうことがあるため。
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    // PC専用（docs/pc-only.md）：主要な確認解像度のノートPC（1366×768）で動かす。1920×1080 は pc-only.spec.ts で確かめる
    viewport: { width: 1366, height: 768 },
    locale: 'ja-JP',
  },
  webServer: [
    {
      command: '.venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8001',
      cwd: '../backend',
      // テストでは実際のAIを決して呼ばない（backend/.env にAPIキーがあっても、環境変数が優先されるので使わない）。
      // AIの画面は、テストの中で応答を差し替えて確かめる
      env: { AI_MODE: 'off', ANTHROPIC_API_KEY: '', AI_PASSWORD_HASH: '' },
      url: 'http://127.0.0.1:8001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // 組み立て済みの画面（vite build → vite preview）で動かす。開発用サーバー（vite）は画面を開くたびにプログラムを変換するため、
      // 並べて実行すると重くなり、画面を開く・ファイルを選ぶところで時間切れになりやすかった（2026-11-17 に比べて確認）。
      // 組み立ては毎回行うので、テストは常に最新のコードで動く。/api の中継先は server.proxy と同じ設定を使う
      command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 5174 --strictPort',
      env: { FLOWCRAFT_API_TARGET: 'http://127.0.0.1:8001' },
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
