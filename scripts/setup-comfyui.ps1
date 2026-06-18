param(
  [string]$ComfyUIDir = "",
  [string]$ComfyUIRepo = "https://github.com/comfyanonymous/ComfyUI.git",
  [string]$PythonBin = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

Ensure-Git
$PythonBin = Ensure-Python310 -PreferredBin $PythonBin

$ComfyGitDir = Join-Path $ComfyUIDir ".git"
if (Test-Path $ComfyGitDir) {
  Write-Host "Updating existing ComfyUI checkout..."
  Invoke-Checked { git -C $ComfyUIDir rev-parse --is-inside-work-tree | Out-Null } "$ComfyUIDir has a .git directory but is not a valid git checkout. Move it aside or pass -ComfyUIDir."
  Invoke-Checked { git -C $ComfyUIDir pull --ff-only } "Failed to update ComfyUI checkout."
} elseif (Test-Path $ComfyUIDir) {
  $ComfyItems = @(Get-ChildItem -Force -LiteralPath $ComfyUIDir)
  if ($ComfyItems.Count -gt 0) {
    throw "$ComfyUIDir already exists but is not a git checkout. Move it aside or pass -ComfyUIDir."
  }

  Write-Host "Cloning ComfyUI into empty directory $ComfyUIDir..."
  Invoke-Checked { git clone $ComfyUIRepo $ComfyUIDir } "Failed to clone ComfyUI."
} else {
  Write-Host "Cloning ComfyUI into $ComfyUIDir..."
  Invoke-Checked { git clone $ComfyUIRepo $ComfyUIDir } "Failed to clone ComfyUI."
}

$VenvDir = Join-Path $ComfyUIDir "venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if ((Test-Path $VenvPython)) {
  try {
    Invoke-Checked { & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" } "Existing ComfyUI venv uses Python older than 3.10."
  } catch {
    Write-Host "Existing ComfyUI venv uses Python older than 3.10. Recreating it..."
    Remove-Item -Recurse -Force $VenvDir
  }
}

if (-not (Test-Path $VenvDir)) {
  Write-Host "Creating Python virtual environment..."
  Invoke-Checked { & $PythonBin -m venv $VenvDir } "Failed to create Python virtual environment."
}

Invoke-Checked { & $VenvPython -m pip install --upgrade pip "setuptools<82" wheel } "Failed to install base Python packaging tools."
Invoke-Checked { & $VenvPython -m pip install -r (Join-Path $ComfyUIDir "requirements.txt") } "Failed to install ComfyUI requirements."

@(
  "models\checkpoints",
  "models\loras",
  "models\embeddings",
  "models\vae",
  "models\upscale_models",
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
