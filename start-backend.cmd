@echo off
rem 開発用のバックエンドを起動する（古いプロセスが残っていないかを確かめてから）。中身は scripts\start-backend.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1" %*
if errorlevel 1 pause
