param(
  [string]$ForgeDir = "",
  [string]$ForgeRef = "main"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ForgeDir) { $ForgeDir = Join-Path $RootDir "stable-diffusion-webui-forge" }
Ensure-Git

if (Test-Path (Join-Path $ForgeDir ".git")) {
  Invoke-Checked { git -C $ForgeDir fetch --quiet origin } "Failed to update Forge."
} elseif (Test-Path $ForgeDir) {
  if (@(Get-ChildItem -Force -LiteralPath $ForgeDir).Count -gt 0) {
    throw "$ForgeDir exists but is not a git checkout."
  }
  Invoke-Checked { git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git $ForgeDir } "Failed to clone Forge."
} else {
  Invoke-Checked { git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git $ForgeDir } "Failed to clone Forge."
}
Invoke-Checked { git -C $ForgeDir checkout $ForgeRef } "Failed to checkout Forge $ForgeRef."
if ($ForgeRef -eq "main") {
  Invoke-Checked { git -C $ForgeDir pull --ff-only } "Failed to update Forge main."
}

$Python = Join-Path $RootDir ".python310\python.exe"
$InstalledPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python310\python.exe"
if (-not (Test-Path $Python)) {
  if (-not (Test-Path $InstalledPython)) {
    Install-WingetPackage -PackageId "Python.Python.3.10" -DisplayName "Python 3.10"
  }
  if (-not (Test-Path $InstalledPython)) {
    throw "Python 3.10 is required. Restart the terminal and retry."
  }
  $Python = $InstalledPython
}

$VenvPython = Join-Path $ForgeDir "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Invoke-Checked { & $Python -m venv (Join-Path $ForgeDir "venv") } "Failed to create Forge venv."
}
Invoke-Checked { & $VenvPython -m pip install --upgrade pip "setuptools<70" wheel } "Failed to prepare Forge pip."
$ClipPackage = "https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip"
Invoke-Checked {
  & $VenvPython -m pip install --no-build-isolation $ClipPackage
} "Failed to install Forge CLIP dependency."

Push-Location $ForgeDir
try {
  Invoke-Checked {
    & $VenvPython launch.py --exit --skip-version-check --skip-torch-cuda-test --no-download-sd-model
  } "Forge dependency setup failed."
} finally {
  Pop-Location
}

Write-Host "Forge is ready. Start with: npm run forge:win"