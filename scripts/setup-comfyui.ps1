param(
  [string]$ComfyUIDir = "",
  [string]$ComfyUIRepo = "https://github.com/comfyanonymous/ComfyUI.git",
  [string]$PythonBin = "python"
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to install ComfyUI."
}

if (-not (Get-Command $PythonBin -ErrorAction SilentlyContinue)) {
  throw "$PythonBin is required. Pass -PythonBin if needed."
}

$ComfyGitDir = Join-Path $ComfyUIDir ".git"
if (Test-Path $ComfyGitDir) {
  Write-Host "Updating existing ComfyUI checkout..."
  git -C $ComfyUIDir pull --ff-only
} elseif (Test-Path $ComfyUIDir) {
  throw "$ComfyUIDir already exists but is not a git checkout. Move it aside or pass -ComfyUIDir."
} else {
  Write-Host "Cloning ComfyUI into $ComfyUIDir..."
  git clone $ComfyUIRepo $ComfyUIDir
}

$VenvDir = Join-Path $ComfyUIDir "venv"
if (-not (Test-Path $VenvDir)) {
  Write-Host "Creating Python virtual environment..."
  & $PythonBin -m venv $VenvDir
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip setuptools wheel
& $VenvPython -m pip install -r (Join-Path $ComfyUIDir "requirements.txt")

@(
  "models\checkpoints",
  "models\loras",
  "models\embeddings",
  "models\vae",
  "models\controlnet",
  "input",
  "output",
  "temp"
) | ForEach-Object {
  New-Item -ItemType Directory -Force -Path (Join-Path $ComfyUIDir $_) | Out-Null
}

Write-Host ""
Write-Host "ComfyUI is ready."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Put model files under $ComfyUIDir\models"
Write-Host "  2. Start ComfyUI: npm run comfyui:win"
Write-Host "  3. Start this app in another terminal: npm run dev"
