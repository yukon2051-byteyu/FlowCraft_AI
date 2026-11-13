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
      url: 'http://127.0.0.1:8001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      env: { FLOWCRAFT_API_TARGET: 'http://127.0.0.1:8001' },
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
