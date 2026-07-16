param(
  [string]$ComfyUIDir = "",
  [string]$ComfyUIRepo = "https://github.com/comfyanonymous/ComfyUI.git",
  [string]$ComfyUIRef = "",
  [string]$PythonBin = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

# Pin ComfyUI to a known-good commit for reproducibility. Precedence:
# -ComfyUIRef param > comfyui-config/comfyui-version.txt > latest master.
$VersionFile = Join-Path $RootDir "comfyui-config\comfyui-version.txt"
if (-not $ComfyUIRef -and (Test-Path $VersionFile)) {
  $ComfyUIRef = (Get-Content $VersionFile -Raw).Trim()
}

Ensure-Git
$PythonBin = Ensure-Python310 -PreferredBin $PythonBin

$ComfyGitDir = Join-Path $ComfyUIDir ".git"
if (Test-Path $ComfyGitDir) {
  Write-Host "Updating existing ComfyUI checkout..."
  Invoke-Checked { git -C $ComfyUIDir rev-parse --is-inside-work-tree | Out-Null } "$ComfyUIDir has a .git directory but is not a valid git checkout. Move it aside or pass -ComfyUIDir."
  Invoke-Checked { git -C $ComfyUIDir fetch --quiet origin } "Failed to fetch ComfyUI updates."
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

if ($ComfyUIRef) {
  Write-Host "Checking out pinned ComfyUI ref: $ComfyUIRef"
  git -C $ComfyUIDir fetch --quiet origin $ComfyUIRef 2>$null
  if ($LASTEXITCODE -ne 0) { git -C $ComfyUIDir fetch --quiet --all }
  Invoke-Checked { git -C $ComfyUIDir checkout $ComfyUIRef } "Failed to checkout pinned ComfyUI ref $ComfyUIRef."
} else {
  Write-Host "No pinned ref set; using latest master."
  git -C $ComfyUIDir checkout master 2>$null | Out-Null
  Invoke-Checked { git -C $ComfyUIDir pull --ff-only } "Failed to update ComfyUI checkout."
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
  "models\diffusion_models",
  "models\text_encoders",
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

$ConfigScript = Join-Path $PSScriptRoot "setup-comfyui-config.ps1"
if (Test-Path $ConfigScript) {
  Write-Host "Provisioning ComfyUI config (custom nodes, workflows, settings)..."
  try {
    & $ConfigScript -ComfyUIDir $ComfyUIDir
  } catch {
    Write-Host "ComfyUI config provisioning skipped/failed; run 'npm run setup:comfyui-config:win' manually."
  }
}

Write-Host ""
Write-Host "ComfyUI is ready."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Put model files under $ComfyUIDir\models"
Write-Host "  2. Optional image-to-prompt nodes: npm run setup:itp-nodes:win"
Write-Host "  3. Start ComfyUI: npm run comfyui:win"
Write-Host "  4. Start this app in another terminal: npm run dev"
