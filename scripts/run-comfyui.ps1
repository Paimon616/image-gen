param(
  [string]$ComfyUIDir = "",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 8188
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}

$MainPy = Join-Path $ComfyUIDir "main.py"
$Python = Join-Path $ComfyUIDir "venv\Scripts\python.exe"

if (-not (Test-Path $MainPy)) {
  throw "ComfyUI is not installed at $ComfyUIDir. Run: npm run setup:comfyui:win"
}

if (-not (Test-Path $Python)) {
  throw "ComfyUI virtual environment is missing. Run: npm run setup:comfyui:win"
}

Push-Location $ComfyUIDir
try {
  & $Python main.py --listen $HostName --port $Port @args
} finally {
  Pop-Location
}
