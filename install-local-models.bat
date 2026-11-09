@echo off
rem Double-click to install the local model set (models, LoRAs, ComfyUI nodes).
rem Extra arguments are passed through, e.g.:  install-local-models.bat -Groups image,krea2
rem See scripts\install-local-models.ps1 for the groups and options.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local-models.ps1" %*
echo.
pause
