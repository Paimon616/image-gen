param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

$ConfigDir = Join-Path $RootDir "comfyui-config"
$CustomNodesDir = Join-Path $ComfyUIDir "custom_nodes"
$UserDir = Join-Path $ComfyUIDir "user\default"
$Python = Join-Path $ComfyUIDir "venv\Scripts\python.exe"

if (-not (Test-Path (Join-Path $ComfyUIDir "main.py"))) {
  throw "ComfyUI is not installed at $ComfyUIDir. Run: npm run setup:comfyui:win"
}
if (-not (Test-Path $Python)) {
  throw "ComfyUI virtual environment is missing. Run: npm run setup:comfyui:win"
}

Ensure-Git

# ---------------------------------------------------------------------------
# 1. Custom nodes (pinned)
# ---------------------------------------------------------------------------
$Manifest = Join-Path $ConfigDir "custom-nodes.json"
if (Test-Path $Manifest) {
  New-Item -ItemType Directory -Force -Path $CustomNodesDir | Out-Null
  $Nodes = (Get-Content $Manifest -Raw | ConvertFrom-Json).custom_nodes
  foreach ($Node in $Nodes) {
    $NodeDir = Join-Path $CustomNodesDir $Node.name

    if ((Test-Path $NodeDir) -and -not (Test-Path (Join-Path $NodeDir ".git"))) {
      throw "$NodeDir exists but is not a git checkout. Move it aside and rerun."
    }
    if (-not (Test-Path (Join-Path $NodeDir ".git"))) {
      Write-Host "Cloning $($Node.name)..."
      Invoke-Checked { git clone $Node.repo $NodeDir } "Failed to clone $($Node.name)."
    }

    Write-Host "Pinning $($Node.name) -> $($Node.ref)"
    git -C $NodeDir fetch --quiet origin $Node.ref 2>$null
    if ($LASTEXITCODE -ne 0) { git -C $NodeDir fetch --quiet --all }
    Invoke-Checked { git -C $NodeDir checkout --quiet $Node.ref } "Failed to checkout $($Node.ref)."

    $Requirements = Join-Path $NodeDir "requirements.txt"
    if (Test-Path $Requirements) {
      Write-Host "Installing Python requirements for $($Node.name)..."
      Invoke-Checked { & $Python -m pip install -r $Requirements } "Failed to install requirements for $($Node.name)."
    }
  }
} else {
  Write-Host "No custom-nodes.json manifest found at $Manifest (skipping custom nodes)."
}

# ---------------------------------------------------------------------------
# 2. GUI workflows
# ---------------------------------------------------------------------------
$WorkflowsSrc = Join-Path $ConfigDir "workflows"
if (Test-Path $WorkflowsSrc) {
  $WorkflowsDest = Join-Path $UserDir "workflows"
  New-Item -ItemType Directory -Force -Path $WorkflowsDest | Out-Null
  foreach ($wf in Get-ChildItem -Path $WorkflowsSrc -Filter *.json) {
    $dest = Join-Path $WorkflowsDest $wf.Name
    if ((Test-Path $dest) -and -not $Force) {
      Write-Host "Skipping existing workflow $($wf.Name) (use -Force to overwrite)."
    } else {
      Copy-Item $wf.FullName $dest -Force
      Write-Host "Installed workflow $($wf.Name)."
    }
  }
}

# ---------------------------------------------------------------------------
# 3. Baseline UI settings (seed only if absent)
# ---------------------------------------------------------------------------
$SettingsSrc = Join-Path $ConfigDir "settings\comfy.settings.json"
$SettingsDest = Join-Path $UserDir "comfy.settings.json"
if (Test-Path $SettingsSrc) {
  if ((Test-Path $SettingsDest) -and -not $Force) {
    Write-Host "Skipping existing comfy.settings.json (use -Force to overwrite)."
  } else {
    New-Item -ItemType Directory -Force -Path $UserDir | Out-Null
    Copy-Item $SettingsSrc $SettingsDest -Force
    Write-Host "Installed comfy.settings.json."
  }
}

Write-Host ""
Write-Host "ComfyUI config provisioned. Restart ComfyUI to load newly installed custom nodes."
