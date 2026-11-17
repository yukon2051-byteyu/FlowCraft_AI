<#
  Hugging Face Spaces（Docker）へ、アプリを動かすのに必要なファイルだけを送る。

  なぜこの形か：
    - Space の README の先頭には、Space の設定（Docker で動かす・ポート7860）が必要。GitHub の README には入れたくないので、送るときだけ作る
    - Excel などの文字ではないファイルは、Git LFS で送る必要がある（デモ用の架空の Excel）
    - テスト・資料・設定の見本などは送らない。秘密の値（.env）は絶対に送らない
    - 送るのは「コミット済みの中身」だけ（作業途中の変更は送らない）

  使い方（プロジェクトのフォルダで）：
    powershell -ExecutionPolicy Bypass -File scripts\deploy-hf.ps1 -DryRun   … Space に接続せず、送る中身を組み立てて見せるだけ
    powershell -ExecutionPolicy Bypass -File scripts\deploy-hf.ps1           … Space の中身を取り寄せ、入れ替えて、確認のうえ送る
  初めて送るときは、Hugging Face のユーザー名と、書き込みの権限があるアクセストークン（パスワードの代わり）を聞かれる。
#>
param(
  [string]$Space = 'yukon2051/flowcraft-ai',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# Git の出力（UTF-8）を正しく読む（読まないと、日本語のコミットの題名などが文字化けする）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 送るもの（コミット済みの中身から取り出す）と、その中で送らないもの
$include = @('Dockerfile', '.dockerignore', 'backend/requirements.txt', 'backend/app', 'frontend')
$exclude = @('frontend/e2e', 'frontend/scripts', 'frontend/.env.example')

function Stop-With([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

# 1. コミットしていない変更があれば止める
if (git status --porcelain) {
  Stop-With 'コミットしていない変更があります。送るのはコミット済みの中身だけなので、先にコミットしてください（git status で確かめられます）。'
}
$sha = (git rev-parse --short HEAD).Trim()
Write-Host "送る版：$sha（$(git log -1 --format=%s HEAD)）"

# 2. 作業用のフォルダに、Space の中身を取り寄せる（DryRun では空のフォルダ）
$work = Join-Path $env:TEMP 'flowcraft-hf-deploy'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
if ($DryRun) {
  New-Item -ItemType Directory $work | Out-Null
  git -C $work init -q
} else {
  Write-Host "Space（$Space）の中身を取り寄せています…（初めてのときは、ユーザー名とアクセストークンを聞かれます）"
  git clone -q "https://huggingface.co/spaces/$Space" $work
  if ($LASTEXITCODE -ne 0) { Stop-With 'Space の中身を取り寄せられませんでした。Space の名前・アクセストークン（書き込みの権限）を確かめてください。' }
}

# 3. 中身を入れ替える（.git 以外を消してから、コミット済みの中身を取り出す）
Get-ChildItem $work -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
# コミット済みの中身を、Git の機能（worktree）で一時的なフォルダに取り出してからコピーする。
# tar で取り出すと、Windows では日本語のファイル名が文字化けし、一部のファイルが取り出せなかった（2026-11-17 に確認）
$snapshot = Join-Path $env:TEMP 'flowcraft-hf-snapshot'
if (Test-Path $snapshot) { git worktree remove --force $snapshot 2>$null; if (Test-Path $snapshot) { Remove-Item $snapshot -Recurse -Force } }
git worktree prune
git worktree add --detach -q $snapshot HEAD
if ($LASTEXITCODE -ne 0) { Stop-With 'コミット済みの中身を取り出せませんでした。' }
try {
  foreach ($i in $include) {
    $dest = Join-Path $work $i
    New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
    Copy-Item (Join-Path $snapshot $i) $dest -Recurse -Force
  }
} finally {
  git worktree remove --force $snapshot
}
foreach ($e in $exclude) { $p = Join-Path $work $e; if (Test-Path $p) { Remove-Item $p -Recurse -Force } }
# 取り出せたかを確かめる（取り出しに失敗したまま送らない）
foreach ($must in @('Dockerfile', 'backend/requirements.txt', 'backend/app/main.py', 'frontend/package.json', 'frontend/src/main.tsx')) {
  if (-not (Test-Path -LiteralPath (Join-Path $work $must))) { Stop-With "送る中身に $must がありません。送らずに止めます。" }
}
# デモのデータ（日本語の名前）が、リポジトリと同じ名前・同じ数だけあるか
$expected = @(git -c core.quotepath=off ls-files backend/app/demos/data) | Sort-Object
$actual = @(Get-ChildItem -LiteralPath (Join-Path $work 'backend/app/demos/data') -File | ForEach-Object { "backend/app/demos/data/$($_.Name)" }) | Sort-Object
if (Compare-Object $expected $actual) { Stop-With 'デモのデータの名前か数が、リポジトリと一致しません。送らずに止めます。' }
Write-Host "デモのデータ：$($actual.Count) 個（リポジトリと一致）"
$secrets = @(Get-ChildItem $work -Recurse -Force -File | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' })
if ($secrets.Count -gt 0) { Stop-With "秘密の値のファイルが含まれています（$($secrets.FullName -join ', ')）。送らずに止めます。" }

# 4. Space 用の README と、Excel を LFS で送る設定
$readme = @"
---
title: FlowCraft AI
emoji: 📊
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# FlowCraft AI

**そのExcel作業、自動化する前に、見直そう**

Excel・CSVを使う定型業務について、作業そのものの見直し（AI業務改善診断）から、処理の組み立て・実行、結果が業務として正しいかの確認、次回の再実行までを支援するWebアプリケーションです。
デモのデータはすべて架空のものです。機密情報や実在する個人情報を含むファイルは使用しないでください。

ソースコード・設計資料：https://github.com/yukon2051-byteyu/FlowCraft_AI （版 $sha）
"@
[System.IO.File]::WriteAllText((Join-Path $work 'README.md'), $readme, (New-Object System.Text.UTF8Encoding($false)))
$attributes = @"
*.xlsx filter=lfs diff=lfs merge=lfs -text
*.xls filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
"@
[System.IO.File]::WriteAllText((Join-Path $work '.gitattributes'), $attributes, (New-Object System.Text.UTF8Encoding($false)))

# 5. 送る中身を見せて、確認してから送る
Push-Location $work
try {
  git lfs install --local | Out-Null
  git add -A
  git -c core.quotepath=off status --short | Out-Host
  $files = @(git ls-files).Count
  $lfs = @(git lfs ls-files).Count
  Write-Host "送るファイル：$files 個（うち LFS：$lfs 個）。作業用のフォルダ：$work"
  if ($DryRun) {
    Write-Host '確認だけで終わります（Space には何も送っていません）。' -ForegroundColor Green
    exit 0
  }
  if (-not (git status --porcelain)) {
    Write-Host 'Space の中身と同じなので、送るものはありません。' -ForegroundColor Green
    exit 0
  }
  $answer = Read-Host "Space（$Space）に送りますか？ 送るなら y を入力して Enter（そのまま Enter で、送らずに終了）"
  if ($answer -notmatch '^(y|yes|ｙ)$') { Stop-With '送らずに終了しました。' }
  git commit -q -m "FlowCraft AI $sha を反映"
  git push origin HEAD:main
  if ($LASTEXITCODE -ne 0) { Stop-With '送れませんでした。上のメッセージを確かめてください。' }
  Write-Host "送りました。Space の画面で、組み立て（Building）の進み具合を確かめてください：https://huggingface.co/spaces/$Space" -ForegroundColor Green
} finally {
  Pop-Location
}
