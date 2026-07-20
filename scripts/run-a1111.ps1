param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 7860
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$WebUIDir = Join-Path $RootDir "stable-diffusion-webui"
$Python = Join-Path $WebUIDir "venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
  throw "A1111 is not installed."
}

$env:STABLE_DIFFUSION_REPO = "https://github.com/w-e-w/stablediffusion.git"
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
  "--vae-dir", (Join-Path $ModelRoot "vae"),
  "--esrgan-models-path", (Join-Path $ModelRoot "upscale_models")
) + $args

Push-Location $WebUIDir
try {
  & $Python @LaunchArgs
} finally {
  Pop-Location
}