param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# Provisions the "Character Reference" (PuLID identity) feature on the local ComfyUI:
#   1. The PuLID_ComfyUI custom node + its Python deps, via the config provisioner.
#   2. The SDXL PuLID weight (pulid_v1.1.safetensors, ~939 MB) into models\pulid\.
# EVA-CLIP and InsightFace antelopev2 are fetched by the node on first run.
# Idempotent: skips the weight if it already exists at the expected size.

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  if ($env:COMFYUI_DIR) { $ComfyUIDir = $env:COMFYUI_DIR }
  else { $ComfyUIDir = Join-Path $RootDir "ComfyUI" }
}

$ModelsDir = if ($env:COMFYUI_MODELS_DIR) { $env:COMFYUI_MODELS_DIR } else { Join-Path $ComfyUIDir "models" }
$PulidDir = Join-Path $ModelsDir "pulid"

# The image_proj/ip_adapter-structured SDXL weight cubiq PuLID_ComfyUI loads
# (NOT guozinan's pulid_v1.1.safetensors, whose id_adapter layout fails to load).
$WeightName = "ip-adapter_pulid_sdxl_fp16.safetensors"
$WeightUrl = "https://huggingface.co/huchenlei/ipadapter_pulid/resolve/main/$WeightName`?download=true"
$WeightMinBytes = 700000000

Write-Host "==> Installing the PuLID custom node via the ComfyUI config provisioner..."
$configArgs = @()
if ($ComfyUIDir) { $configArgs += @("-ComfyUIDir", $ComfyUIDir) }
if ($Force) { $configArgs += "-Force" }
& (Join-Path $PSScriptRoot "setup-comfyui-config.ps1") @configArgs

Write-Host ""
Write-Host "==> Fetching the SDXL PuLID weight ($WeightName)..."
New-Item -ItemType Directory -Force -Path $PulidDir | Out-Null
$Dest = Join-Path $PulidDir $WeightName

$big = $false
if (Test-Path $Dest) {
  if ((Get-Item $Dest).Length -ge $WeightMinBytes) { $big = $true }
}

if ($big) {
  Write-Host "Already present: $Dest (skipping download)."
} else {
  $tmp = "$Dest.part"
  Invoke-WebRequest -Uri $WeightUrl -OutFile $tmp -UseBasicParsing
  if ((Get-Item $tmp).Length -lt $WeightMinBytes) {
    throw "Downloaded file is smaller than expected — treating as failed. Left $tmp in place."
  }
  Move-Item -Force $tmp $Dest
  Write-Host "Saved: $Dest"
}

Write-Host ""
Write-Host "==> Fetching the InsightFace antelopev2 face models..."
# PulidInsightFaceLoader runs FaceAnalysis(name="antelopev2") under
# <models>\insightface\models\antelopev2\. Place the five ONNX files explicitly.
$AntelopeDir = Join-Path $ModelsDir "insightface\models\antelopev2"
$AntelopeBase = "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main"
New-Item -ItemType Directory -Force -Path $AntelopeDir | Out-Null
foreach ($f in @("1k3d68.onnx", "2d106det.onnx", "genderage.onnx", "glintr100.onnx", "scrfd_10g_bnkps.onnx")) {
  $onnxDest = Join-Path $AntelopeDir $f
  if ((Test-Path $onnxDest) -and ((Get-Item $onnxDest).Length -gt 100000)) {
    Write-Host "  already present: $f"
  } else {
    Write-Host "  downloading $f..."
    Invoke-WebRequest -Uri "$AntelopeBase/$f`?download=true" -OutFile "$onnxDest.part" -UseBasicParsing
    Move-Item -Force "$onnxDest.part" $onnxDest
  }
}

Write-Host ""
Write-Host "PuLID is ready. Restart ComfyUI so the node loads, then set a Character"
Write-Host "Reference image in the generator (SDXL/Illustrious checkpoints)."
