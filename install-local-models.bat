@echo off
rem Double-click to install the image-generation model set (image + krea2, about 28 GB):
rem   Hassaku XL + consistency LoRAs + PuLID, Krea2 Turbo + Identity Edit (+ its ComfyUI node).
rem Extra arguments are passed through, e.g.:
rem   install-local-models.bat -List
rem   install-local-models.bat -Groups image,krea2,h3,wan
rem See scripts\install-local-models.ps1 for the groups and options.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local-models.ps1" %*
echo.
pause
