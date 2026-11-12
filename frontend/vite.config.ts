/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 開発中、画面からの /api/... の呼び出しをバックエンド（FastAPI）へ中継する。
    // これにより、画面側のコードは本番（同じサーバーから配信）と同じURLのまま書ける。
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // 画面側の単体テスト（Vitest）。ブラウザを使うE2Eテスト（e2e/）とは分けて実行する
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
