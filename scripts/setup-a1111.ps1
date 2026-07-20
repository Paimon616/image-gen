param(
  [string]$WebUIDir = "",
  [string]$WebUIRef = "v1.10.0"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $WebUIDir) { $WebUIDir = Join-Path $RootDir "stable-diffusion-webui" }
$ModelRoot = Join-Path $RootDir "ComfyUI\models"
$UpscalerDir = Join-Path $ModelRoot "upscale_models"
$UltraSharpPath = Join-Path $UpscalerDir "4x-UltraSharp.pth"
$UltraSharpUrl = "https://huggingface.co/shiertier/upscale_models/resolve/b73626f248084e9af7108621ace5651e1447af44/4x-UltraSharp.pth"
$UltraSharpSha256 = "a5812231fc936b42af08a5edba784195495d303d5b3248c24489ef0c4021fe01"

Ensure-Git

if (Test-Path (Join-Path $WebUIDir ".git")) {
  Invoke-Checked { git -C $WebUIDir fetch --quiet origin --tags } "Failed to update A1111."
} elseif (Test-Path $WebUIDir) {
  if (@(Get-ChildItem -Force -LiteralPath $WebUIDir).Count -gt 0) {
    throw "$WebUIDir exists but is not a git checkout."
  }
  Invoke-Checked { git clone --branch $WebUIRef https://github.com/AUTOMATIC1111/stable-diffusion-webui.git $WebUIDir } "Failed to clone A1111."
} else {
  Invoke-Checked { git clone --branch $WebUIRef https://github.com/AUTOMATIC1111/stable-diffusion-webui.git $WebUIDir } "Failed to clone A1111."
}
Invoke-Checked { git -C $WebUIDir checkout $WebUIRef } "Failed to checkout A1111 $WebUIRef."

$Python = Join-Path $RootDir ".python310\python.exe"
$InstalledPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python310\python.exe"
if (-not (Test-Path $Python)) {
  if (-not (Test-Path $InstalledPython)) {
    Install-WingetPackage -PackageId "Python.Python.3.10" -DisplayName "Python 3.10"
  }
  if (-not (Test-Path $InstalledPython)) {
    throw "Python 3.10 is required. Restart the terminal after installation and retry."
  }
  $Python = $InstalledPython
}

$VenvPython = Join-Path $WebUIDir "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Invoke-Checked { & $Python -m venv (Join-Path $WebUIDir "venv") } "Failed to create the A1111 venv."
}
Invoke-Checked { & $VenvPython -m pip install --upgrade pip "setuptools<70" wheel } "Failed to prepare pip."

@("checkpoints", "loras", "vae", "upscale_models") | ForEach-Object {
  New-Item -ItemType Directory -Force -Path (Join-Path $ModelRoot $_) | Out-Null
}

$NeedsDownload = -not (Test-Path $UltraSharpPath)
if (-not $NeedsDownload) {
  $NeedsDownload = (Get-FileHash -Algorithm SHA256 -LiteralPath $UltraSharpPath).Hash.ToLowerInvariant() -ne $UltraSharpSha256
}
if ($NeedsDownload) {
  $TempPath = "$UltraSharpPath.download"
  Invoke-WebRequest -UseBasicParsing -Uri $UltraSharpUrl -OutFile $TempPath
  $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TempPath).Hash.ToLowerInvariant()
  if ($ActualHash -ne $UltraSharpSha256) {
    Remove-Item -LiteralPath $TempPath -Force
    throw "4x-UltraSharp checksum mismatch: $ActualHash"
  }
  Move-Item -LiteralPath $TempPath -Destination $UltraSharpPath -Force
}

Push-Location $WebUIDir
try {
  Invoke-Checked {
    & $VenvPython launch.py --exit --skip-version-check --skip-torch-cuda-test --no-download-sd-model
  } "A1111 dependency setup failed."
} finally {
  Pop-Location
}

Write-Host "A1111 $WebUIRef and 4x-UltraSharp are ready."
Write-Host "Start with: npm run a1111:win"