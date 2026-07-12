param(
  [string]$ComfyUIDir = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

$CustomNodesDir = Join-Path $ComfyUIDir "custom_nodes"
$Python = Join-Path $ComfyUIDir "venv\Scripts\python.exe"

if (-not (Test-Path (Join-Path $ComfyUIDir "main.py"))) {
  throw "ComfyUI is not installed at $ComfyUIDir. Run: npm run setup:comfyui:win"
}

if (-not (Test-Path $Python)) {
  throw "ComfyUI virtual environment is missing. Run: npm run setup:comfyui:win"
}

Ensure-Git
New-Item -ItemType Directory -Force -Path $CustomNodesDir | Out-Null

$Nodes = @(
  @{
    Name = "ComfyUI-WD14-Tagger"
    Repo = "https://github.com/pythongosssss/ComfyUI-WD14-Tagger.git"
  },
  @{
    Name = "ComfyUI-Custom-Scripts"
    Repo = "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git"
  },
  @{
    Name = "ComfyUI-Florence2"
    Repo = "https://github.com/kijai/ComfyUI-Florence2.git"
  }
)

foreach ($Node in $Nodes) {
  $NodeDir = Join-Path $CustomNodesDir $Node.Name
  if (Test-Path (Join-Path $NodeDir ".git")) {
    Write-Host "Updating $($Node.Name)..."
    Invoke-Checked { git -C $NodeDir pull --ff-only } "Failed to update $($Node.Name)."
  } elseif (Test-Path $NodeDir) {
    throw "$NodeDir already exists but is not a git checkout. Move it aside and rerun this script."
  } else {
    Write-Host "Installing $($Node.Name)..."
    Invoke-Checked { git clone $Node.Repo $NodeDir } "Failed to clone $($Node.Name)."
  }

  $Requirements = Join-Path $NodeDir "requirements.txt"
  if (Test-Path $Requirements) {
    Write-Host "Installing Python requirements for $($Node.Name)..."
    Invoke-Checked { & $Python -m pip install -r $Requirements } "Failed to install requirements for $($Node.Name)."
  }
}

Write-Host ""
Write-Host "Image-to-prompt ComfyUI nodes are ready. Restart ComfyUI before using the feature."
Write-Host "WD14 works with the built-in workflow. Florence requires COMFYUI_ITP_FLORENCE_WORKFLOW_PATH unless your workflow is customized."
