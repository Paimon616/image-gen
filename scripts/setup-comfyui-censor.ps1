param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# Provisions the video "Censor (auto-mosaic)" feature on the local ComfyUI:
#   1. The ComfyUI-Nudenet + ComfyUI-segment-anything-2 custom nodes, via the config
#      provisioner.
#   2. The NudeNet ONNX detector (nudenet.onnx, ~25 MB) into models\Nudenet\.
# Idempotent: skips the model if it already exists at a plausible size.

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  if ($env:COMFYUI_DIR) { $ComfyUIDir = $env:COMFYUI_DIR }
  else { $ComfyUIDir = Join-Path $RootDir "ComfyUI" }
}

$ModelsDir = if ($env:COMFYUI_MODELS_DIR) { $env:COMFYUI_MODELS_DIR } else { Join-Path $ComfyUIDir "models" }
$NudenetDir = Join-Path $ModelsDir "Nudenet"

$ModelName = if ($env:COMFYUI_NUDENET_MODEL) { $env:COMFYUI_NUDENET_MODEL } else { "nudenet.onnx" }
$ModelUrl = "https://d2xl8ijk56kv4u.cloudfront.net/models/nudenet.onnx"
$ModelMinBytes = 1000000

Write-Host "==> Installing the censor custom nodes via the ComfyUI config provisioner..."
$configArgs = @()
if ($ComfyUIDir) { $configArgs += @("-ComfyUIDir", $ComfyUIDir) }
if ($Force) { $configArgs += "-Force" }
& (Join-Path $PSScriptRoot "setup-comfyui-config.ps1") @configArgs

Write-Host ""
Write-Host "==> Fetching the NudeNet ONNX detector ($ModelName)..."
New-Item -ItemType Directory -Force -Path $NudenetDir | Out-Null
$Dest = Join-Path $NudenetDir $ModelName

$big = $false
if (Test-Path $Dest) {
  if ((Get-Item $Dest).Length -ge $ModelMinBytes) { $big = $true }
}

if ($big) {
  Write-Host "Already present: $Dest (skipping download)."
} else {
  $tmp = "$Dest.part"
  Invoke-WebRequest -Uri $ModelUrl -OutFile $tmp -UseBasicParsing
  if ((Get-Item $tmp).Length -lt $ModelMinBytes) {
    throw "Downloaded file is smaller than expected — treating as failed. Left $tmp in place."
  }
  Move-Item -Force $tmp $Dest
  Write-Host "Saved: $Dest"
}

Write-Host ""
Write-Host "Censoring is ready. Restart ComfyUI so the nodes load, then enable"
Write-Host "`"Censor (auto-mosaic)`" in the video generator."
