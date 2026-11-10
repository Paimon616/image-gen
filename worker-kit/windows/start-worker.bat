@echo off
chcp 65001 >nul
rem Turn the GPU worker ON (syncs marc's setup first, then starts ComfyUI in the background).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker.ps1" start
pause
