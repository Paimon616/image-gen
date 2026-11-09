@echo off
rem Double-click to install ComfyUI for the local stack (Windows + NVIDIA GPU):
rem   real Python 3.12 (installed with winget if missing), ComfyUI pinned to the tested
rem   version, its custom nodes, and the CUDA build of torch.
rem After this, double-click install-local-models.bat for the models and LoRAs.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-comfyui-local.ps1" %*
echo.
pause
