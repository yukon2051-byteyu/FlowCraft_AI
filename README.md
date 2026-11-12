# FlowCraft AI

**そのExcel作業、自動化する前に、見直そう。**

Excel・CSVを使う業務について、作業の必要性の見直しから、処理の実行・結果の確認・継続的な改善までを支援するWebアプリケーションです（開発中）。

- 作業の必要性・ムダ・重複している工程を見直す（AI業務改善診断・開発中。使うかどうかは任意）
- 必要な処理を組み立てて実行する（AIの提案は人が確認してから使う）
- 業務の「完了基準」に沿って、結果が正しいかを確かめる
- 一度きりの作業にも、毎月の定型業務にも使える（保存した手順は、次から新しいファイルを選んで再実行）

設計の考え方は [docs/product-review.md](docs/product-review.md) を参照してください。

> 開発状況：**Phase 1（基盤・UI骨格・処理エンジン）着手**。下記の機能は計画であり、実装済みのものは「開発状況」に記載します。

## 解決する業務課題

- 毎月同じ手順で行うExcelの集計・照合作業に時間がかかる
- 手順が担当者の頭の中にあり、属人化している
- VLOOKUP等の結合で、コードの重複や照合漏れに気づかず誤った集計をしてしまう

## 主要機能（計画）

| 機能 | 内容 |
|---|---|
| AIによるフロー提案 | 日本語の指示から処理手順を提案。重要な条件は人が確定するまで実行しない |
| ビジュアルフロー | 処理の順序と内容を図で確認・編集 |
| 12種類の処理 | 抽出・並べ替え・列編集・型変換・重複・欠損・結合・連結・集計・計算・読込・出力 |
| 品質検証 | 結合関係・行数増加・金額整合性・未照合レコードを自動検証 |
| 保存と再実行 | フローをJSONで保存し、翌月のデータで再実行。列構成の変化を事前に検出 |
| Excel出力 | 処理結果／検証結果／エラー・警告一覧／処理履歴の4シート |

## 使用技術

- フロントエンド：React / TypeScript / Vite / Tailwind CSS / React Flow
- バックエンド：Python 3.12 / FastAPI / pandas / openpyxl / pytest
- AI：Claude API（公式 `anthropic` SDK）
- 公開：Docker / Hugging Face Spaces（予定）

## 使い方

### 必要なもの
- Python 3.12
- Node.js 24

### バックエンドの起動（Windows / PowerShell）

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

ブラウザで http://127.0.0.1:8000/api/health を開き、`"status":"ok"` と表示されれば起動できています。
API仕様の一覧は http://127.0.0.1:8000/docs で確認できます。

### 画面（フロントエンド）の起動

バックエンドを起動したまま、別のターミナルで：

```powershell
cd frontend
npm install
npm run dev
```

> **「このシステムではスクリプトの実行が無効になっている」と表示された場合**
> PowerShellの安全設定により `npm.ps1` が止められています。次のどちらかで解決できます。
> - `npm` の代わりに `npm.cmd` を使う（例：`npm.cmd run dev`）
> - `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` を一度実行する（自分のユーザーにだけ適用。会社PCでは社内ルールを確認）

ブラウザで http://localhost:5173 を開きます。画面からの `/api/...` の呼び出しは、開発サーバーがバックエンドへ中継します。

## テスト方法

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -v
```

フロントエンドの単体テスト（作業手順の操作・状態管理）：

```powershell
cd frontend
npm test
```

フロントエンド（型チェック・ビルド・コードチェック）：

```powershell
cd frontend
npm run build
npm run lint
```

E2Eテスト（実際のブラウザで画面を操作するテスト。テスト専用のサーバーをポート8001・5174で自動起動します。普段の開発用サーバー（8000・5173）を起動したままでも実行できます）：

```powershell
cd frontend
npx playwright install chromium   # 初回のみ
npm run test:e2e
```

画面幅ごとのスクリーンショットとレイアウト自動チェック（開発サーバー起動中に実行）：

```powershell
cd frontend
npx playwright install chromium   # 初回のみ
node scripts/screenshots.mjs screenshots
```

1440px・1280px・ノートPC相当（1280×650）・タブレット（768px）・スマートフォン（390px）で撮影し、横スクロール・ブラウザのエラー・ファーストビューのボタン表示を確認します。

## 画面一覧

| URL | 画面 |
|---|---|
| `/` | TOP（製品紹介） |
| `/build` | 作る画面（ファイル読込 → 作業手順の作成）。PC専用。旧URL `/workspace` は自動で転送 |
| `/build?view=sample` | サンプルの作業手順での画面表示 |
| `/dev/diagnostics` | 開発者向けのシステム状態 |

## 設計資料

- [設計書](docs/architecture.md)
- [実装計画](docs/implementation-plan.md)

## データの取り扱い

- アップロードしたファイルはサーバーのメモリ上でのみ処理し、最終操作から60分で自動削除します。
- AIには列名・データ型・少量のサンプル値のみ送信し、個人情報と思われる列の値はマスクします。
- 公開デモ環境には機密情報を含むファイルをアップロードしないでください。
- 同梱のデモデータはすべて架空のものです。

## 改善余地

（開発の進行に合わせて記載）
