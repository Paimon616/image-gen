@echo off
chcp 65001 >nul
rem Turn the GPU worker OFF. Frees the GPU immediately; safe to run any time.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker.ps1" stop
pause
