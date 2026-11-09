param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Provisions the BETA character reference sheet feature on the
# local ComfyUI (docs/character-reference-sheet.md):
#   1. ComfyUI_IPAdapter_plus custom node (pinned in comfyui-config/custom-nodes.json).
#   2. models\ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors   (~848 MB)
#   3. models\clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors (~2.5 GB)
# Idempotent: files already present at the expected size are skipped.

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  if ($env:COMFYUI_DIR) { $ComfyUIDir = $env:COMFYUI_DIR }
  else { $ComfyUIDir = Join-Path $RootDir "ComfyUI" }
}
$ModelsDir = if ($env:COMFYUI_MODELS_DIR) { $env:COMFYUI_MODELS_DIR } else { Join-Path $ComfyUIDir "models" }

Write-Host "==> Installing ComfyUI_IPAdapter_plus via the ComfyUI config provisioner..."
$configArgs = @()
if ($ComfyUIDir) { $configArgs += @("-ComfyUIDir", $ComfyUIDir) }
if ($Force) { $configArgs += "-Force" }
& (Join-Path $PSScriptRoot "setup-comfyui-config.ps1") @configArgs

function Fetch-Model($rel, $url, [int64]$bytes) {
  $dest = Join-Path $ModelsDir ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $bytes)) {
    Write-Host "  already present: $rel"
    return
  }
  Write-Host "  downloading $rel..."
  $part = "$dest.part"
  & curl.exe -fL --retry 3 -C - -o $part $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  if ((Get-Item $part).Length -ne $bytes) { throw "Size mismatch for $rel; left $part to resume." }
  Move-Item -Force $part $dest
}

Write-Host ""
Write-Host "==> Fetching IP-Adapter models into $ModelsDir ..."
# Keep in sync with IPADAPTER_MODEL / IPADAPTER_CLIP_VISION in src/lib/character-sheet.ts.
Fetch-Model "ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" `
  "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" 847517512
Fetch-Model "clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" `
  "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" 2528373448

Write-Host ""
Write-Host "IP-Adapter is ready. Restart ComfyUI, then enable the beta in Settings."
