$ErrorActionPreference = "Stop"

if (-not $env:CIVITAI_API_TOKEN) {
  throw "Set CIVITAI_API_TOKEN before running this script."
}

$root = Split-Path -Parent $PSScriptRoot
$loraDir = Join-Path $root "ComfyUI\models\loras"
New-Item -ItemType Directory -Force -Path $loraDir | Out-Null

$downloads = @(
  @{
    Url = "https://civitai.com/api/download/models/1545040"
    Path = Join-Path $loraDir "doggyPOV_v1_1.safetensors"
  },
  @{
    Url = "https://civitai.com/api/download/models/2553271"
    Path = Join-Path $loraDir "DR34ML4Y_I2V_14B_LOW_V2.safetensors"
  }
)

foreach ($item in $downloads) {
  if (Test-Path $item.Path) {
    Write-Host "Already exists: $($item.Path)"
    continue
  }

  Write-Host "Downloading: $($item.Path)"
  curl.exe -L --fail --retry 5 --retry-delay 5 `
    -H "Authorization: Bearer $env:CIVITAI_API_TOKEN" `
    -o $item.Path `
    $item.Url
}

Write-Host "Done. To use the LoRA workflow, set:"
Write-Host "COMFYUI_VIDEO_WORKFLOW_PATH=workflows/wan22-i2v-civitai-133468541-api.json"
