param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Provisions the BETA character reference sheet feature on the
# local ComfyUI (docs/character-reference-sheet.md):
#   1. ComfyUI_IPAdapter_plus custom node (pinned in comfyui-config/custom-nodes.json).
#   2. models\ipadapter\NOOB-IPA-MARK1.safetensors (~1.4 GB, Civitai: needs
#      $env:CIVITAI_API_TOKEN or the key saved in .local\settings.json)
#   3. models\clip_vision\CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors (~3.7 GB)
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

$Token = $env:CIVITAI_API_TOKEN
$SettingsPath = Join-Path $RootDir ".local\settings.json"
if (-not $Token -and (Test-Path $SettingsPath)) {
  $Token = (Get-Content $SettingsPath -Raw | ConvertFrom-Json).civitaiApiKey
}

function Fetch-Model($rel, $url, [int64]$bytes, $auth) {
  $dest = Join-Path $ModelsDir ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $bytes)) {
    Write-Host "  already present: $rel"
    return
  }
  Write-Host "  downloading $rel..."
  $part = "$dest.part"
  $curlArgs = @("-fL", "--retry", "3", "-C", "-", "-o", $part)
  if ($auth) { $curlArgs += @("-H", "Authorization: Bearer $auth") }
  & curl.exe @curlArgs $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  if ((Get-Item $part).Length -ne $bytes) { throw "Size mismatch for $rel; left $part to resume." }
  Move-Item -Force $part $dest
}

Write-Host ""
Write-Host "==> Fetching IP-Adapter models into $ModelsDir ..."
# Keep in sync with IPADAPTER_MODEL / IPADAPTER_CLIP_VISION in src/lib/character-sheet.ts.
if (-not $Token) { throw "Civitai API key missing (CIVITAI_API_TOKEN or Settings). Needed for NOOB-IPA-MARK1." }
Fetch-Model "ipadapter/NOOB-IPA-MARK1.safetensors" `
  "https://civitai.com/api/download/models/1121145" 1405172056 $Token
Fetch-Model "clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors" `
  "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/image_encoder/model.safetensors" 3689912664 $null

Write-Host ""
Write-Host "IP-Adapter is ready. Restart ComfyUI, then enable the beta in Settings."
