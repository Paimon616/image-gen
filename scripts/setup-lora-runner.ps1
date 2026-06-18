param(
  [string]$RunnerDir = "",
  [string]$SdScriptsRepo = "https://github.com/kohya-ss/sd-scripts.git",
  [string]$PythonBin = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$DefaultRunnerDir = Join-Path $RootDir "runners\sd-scripts"
if (-not $RunnerDir) {
  $RunnerDir = $DefaultRunnerDir
}

Ensure-Git
$PythonBin = Ensure-Python310 -PreferredBin $PythonBin

$ExpectedRunnerCommit = ""
if ([System.IO.Path]::GetFullPath($RunnerDir).TrimEnd("\") -eq [System.IO.Path]::GetFullPath($DefaultRunnerDir).TrimEnd("\")) {
  $RunnerTreeEntry = git -C $RootDir ls-tree HEAD -- "runners/sd-scripts"
  if ($LASTEXITCODE -eq 0 -and $RunnerTreeEntry -match "160000 commit ([0-9a-f]{40})\s+runners/sd-scripts") {
    $ExpectedRunnerCommit = $Matches[1]
  }
}

function Sync-RunnerCheckout {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RunnerDir,
    [string]$ExpectedCommit = ""
  )

  if (-not $ExpectedCommit) {
    Invoke-Checked { git -C $RunnerDir pull --ff-only } "Failed to update sd-scripts checkout."
    return
  }

  & git -C $RunnerDir cat-file -e "$ExpectedCommit^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Invoke-Checked { git -C $RunnerDir fetch origin $ExpectedCommit } "Failed to fetch pinned sd-scripts commit $ExpectedCommit."
  }

  Invoke-Checked { git -C $RunnerDir checkout --detach $ExpectedCommit } "Failed to checkout pinned sd-scripts commit $ExpectedCommit."
}

$RunnerGitDir = Join-Path $RunnerDir ".git"
if (Test-Path $RunnerGitDir) {
  Write-Host "Updating existing sd-scripts checkout..."
  Invoke-Checked { git -C $RunnerDir rev-parse --is-inside-work-tree | Out-Null } "$RunnerDir has a .git directory but is not a valid git checkout. Move it aside or pass -RunnerDir."
  Sync-RunnerCheckout -RunnerDir $RunnerDir -ExpectedCommit $ExpectedRunnerCommit
} elseif (Test-Path $RunnerDir) {
  $RunnerItems = @(Get-ChildItem -Force -LiteralPath $RunnerDir)
  if ($RunnerItems.Count -gt 0) {
    throw "$RunnerDir already exists but is not a git checkout. Move it aside or pass -RunnerDir."
  }

  Write-Host "Cloning sd-scripts into empty directory $RunnerDir..."
  Invoke-Checked { git clone $SdScriptsRepo $RunnerDir } "Failed to clone sd-scripts."
  Sync-RunnerCheckout -RunnerDir $RunnerDir -ExpectedCommit $ExpectedRunnerCommit
} else {
  Write-Host "Cloning sd-scripts into $RunnerDir..."
  New-Item -ItemType Directory -Force -Path (Split-Path $RunnerDir) | Out-Null
  Invoke-Checked { git clone $SdScriptsRepo $RunnerDir } "Failed to clone sd-scripts."
  Sync-RunnerCheckout -RunnerDir $RunnerDir -ExpectedCommit $ExpectedRunnerCommit
}

$VenvDir = Join-Path $RunnerDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if ((Test-Path $VenvPython)) {
  try {
    Invoke-Checked { & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" } "Existing LoRA runner venv uses Python older than 3.10."
  } catch {
    Write-Host "Existing LoRA runner venv uses Python older than 3.10. Recreating it..."
    Remove-Item -Recurse -Force $VenvDir
  }
}

if (-not (Test-Path $VenvDir)) {
  Write-Host "Creating Python virtual environment..."
  Invoke-Checked { & $PythonBin -m venv $VenvDir } "Failed to create Python virtual environment."
}

Invoke-Checked { & $VenvPython -m pip install --upgrade pip "setuptools<82" wheel } "Failed to install base Python packaging tools."
Push-Location $RunnerDir
try {
  Invoke-Checked { & $VenvPython -m pip install -r "requirements.txt" } "Failed to install sd-scripts requirements."
} finally {
  Pop-Location
}
Invoke-Checked { & $VenvPython -m pip install accelerate torchvision } "Failed to install LoRA runner runtime packages."

New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "training\runs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "ComfyUI\models\loras") | Out-Null

Write-Host ""
Write-Host "LoRA runner is ready."
Write-Host ""
Write-Host "Runner:"
Write-Host "  $RunnerDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart the Next.js dev server if it is already running."
Write-Host "  2. Open /lora-training."
Write-Host "  3. The button should change from 'Runner 연결 필요' to 'LoRA 파일 생성 시작'."
