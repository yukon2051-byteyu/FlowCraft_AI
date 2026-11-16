<#
  開発用のバックエンド（ポート8000）を起動する。

  なぜ必要か：Windows では、--reload 付きで起動したバックエンドを止めても、子プロセスが残って
  ポート8000を使い続けることがある。新しく起動すると古いものと2つが同時に待ち受け、
  古いプログラム・古い設定（.env を読む前など）のまま答えてしまう（2026-11-16・11-17 に発生）。

  この起動用のスクリプトがすること：
    1. ポート8000を使っているプロセスを探す（待ち受けているもの・その起動役・子プロセス）
    2. 見つかったら一覧を出し、止めるかを聞く（勝手に止めない。初期値は「止めない」）
    3. 止めたら、ポートが空いたことを確かめてから起動する（空かなければ起動しない）
    FlowCraft のバックエンド（uvicorn）以外のプログラムが使っていたら、止めずに終了する。
    テスト用のバックエンド（ポート8001）には触れない。

  使い方（プロジェクトのフォルダで）：
    .\start-backend.cmd           … 確かめてから起動する
    .\start-backend.cmd -Check    … 一覧を出すだけ（止めない・起動しない）
#>
param(
  [switch]$Check,
  [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

function Test-IsBackend($p) {
  # FlowCraft のバックエンド（uvicorn）か、その子プロセス（multiprocessing の spawn）か
  return ($p.Name -eq 'python.exe') -and ($p.CommandLine -match 'uvicorn app\.main:app|multiprocessing\.spawn')
}

function Find-PortProcesses([int]$port) {
  $all = @(Get-CimInstance Win32_Process)
  $byId = @{}
  foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  $found = @{}
  $kind = @{}
  foreach ($id in $listeners) {
    $p = $byId[[int]$id]
    if (-not $p) { continue }
    $found[[int]$id] = $p
    $kind[[int]$id] = '待ち受け'
    if (-not (Test-IsBackend $p)) { continue }
    # 親をたどる（--reload の起動役。uvicorn のものだけ）
    $cur = $byId[[int]$p.ParentProcessId]
    while ($cur -and (Test-IsBackend $cur) -and -not $found.ContainsKey([int]$cur.ProcessId)) {
      $found[[int]$cur.ProcessId] = $cur
      $kind[[int]$cur.ProcessId] = '起動役'
      $cur = $byId[[int]$cur.ParentProcessId]
    }
  }
  # 子をたどる（実際に処理をしている子プロセス。バックエンドのものだけ）
  do {
    $added = $false
    foreach ($p in $all) {
      $id = [int]$p.ProcessId
      if (-not $found.ContainsKey($id) -and $found.ContainsKey([int]$p.ParentProcessId) -and (Test-IsBackend $found[[int]$p.ParentProcessId])) {
        $found[$id] = $p
        $kind[$id] = '子プロセス'
        $added = $true
      }
    }
  } while ($added)
  return @($found.Values | Sort-Object CreationDate | ForEach-Object {
      $cmd = [string]$_.CommandLine
      if ($cmd.Length -gt 70) { $cmd = $cmd.Substring(0, 70) + '…' }
      [pscustomobject]@{
        番号     = [int]$_.ProcessId
        種類     = $kind[[int]$_.ProcessId]
        起動日時 = $_.CreationDate.ToString('MM/dd HH:mm:ss')
        バックエンド = if (Test-IsBackend $_) { 'はい' } else { 'いいえ' }
        コマンド = $cmd
      }
    })
}

if (-not (Test-Path $python)) {
  Write-Host "Python の仮想環境が見つかりません：$python" -ForegroundColor Red
  Write-Host 'README の「バックエンドの準備」の手順で、backend\.venv を作ってください。'
  exit 1
}

Write-Host "ポート$Port を使っているプロセスを確かめています…"
$procs = Find-PortProcesses $Port
if ($procs.Count -eq 0) {
  Write-Host "ポート$Port は空いています。" -ForegroundColor Green
} else {
  Write-Host "ポート$Port を使っているプロセスがあります：" -ForegroundColor Yellow
  $procs | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
  $listening = @($procs | Where-Object { $_.種類 -eq '待ち受け' })
  if ($listening.Count -ge 2) {
    Write-Host "待ち受けているものが$($listening.Count)つあります。古いものが残っていると、古いプログラム・古い設定のまま答えることがあります。" -ForegroundColor Yellow
  }
  if (@($procs | Where-Object { $_.バックエンド -eq 'いいえ' }).Count -gt 0) {
    Write-Host "FlowCraft のバックエンド以外のプログラムが、ポート$Port を使っています。止めずに終了します。" -ForegroundColor Red
    Write-Host 'そのプログラムを終了してから、もう一度実行してください。'
    exit 1
  }
  if ($Check) { exit 0 }
  $answer = Read-Host 'これらを止めてから起動しますか？ 止めるなら y を入力して Enter（そのまま Enter で、止めずに終了）'
  if ($answer -notmatch '^(y|yes|ｙ)$') {
    Write-Host '止めずに終了しました（起動もしていません）。'
    exit 1
  }
  foreach ($p in $procs) {
    try {
      Stop-Process -Id $p.番号 -Force -ErrorAction Stop
      Write-Host "止めました：$($p.番号)（$($p.種類)）"
    } catch {
      # 親を止めると子も一緒に終わることがある（すでに終わっていれば問題ない）
      if (Get-Process -Id $p.番号 -ErrorAction SilentlyContinue) { Write-Host "止められませんでした：$($p.番号)（$($_.Exception.Message)）" -ForegroundColor Red }
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "ポート$Port がまだ使われています。起動しません。.\start-backend.cmd -Check で確かめてください。" -ForegroundColor Red
    exit 1
  }
  Write-Host "ポート$Port が空きました。" -ForegroundColor Green
}

if ($Check) { exit 0 }

Set-Location $backend
# 起動したときのAIの状態（.env の設定から決まる）。off：使わない／fixed：固定応答／live：実際のAI
$aiStatus = & $python -c "from app.config import Settings; print(Settings().ai_status)"
Write-Host "AIの状態：$aiStatus"
Write-Host "バックエンドを起動します（止めるときは Ctrl+C）。確認：http://127.0.0.1:$Port/api/health" -ForegroundColor Green
& $python -m uvicorn app.main:app --reload --port $Port
