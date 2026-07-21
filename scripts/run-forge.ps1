param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 7861
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$ForgeDir = Join-Path $RootDir "stable-diffusion-webui-forge"
$Python = Join-Path $ForgeDir "venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
  throw "Forge is not installed. Run: npm run setup:forge:win"
}

$ModelRoot = Join-Path $RootDir "ComfyUI\models"
$LaunchArgs = @(
  "launch.py",
  "--api",
  "--listen",
  "--server-name", $HostName,
  "--port", $Port,
  "--skip-version-check",
  "--no-download-sd-model",
  "--ckpt-dir", (Join-Path $ModelRoot "checkpoints"),
  "--lora-dir", (Join-Path $ModelRoot "loras"),
  "--embeddings-dir", (Join-Path $ModelRoot "embeddings"),
  "--vae-dir", (Join-Path $ModelRoot "vae"),
  "--esrgan-models-path", (Join-Path $ModelRoot "upscale_models")
) + $args

Push-Location $ForgeDir
try {
  & $Python @LaunchArgs
} finally {
  Pop-Location
}