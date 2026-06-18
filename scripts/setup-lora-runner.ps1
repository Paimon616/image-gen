param(
  [string]$RunnerDir = "",
  [string]$SdScriptsRepo = "https://github.com/kohya-ss/sd-scripts.git",
  [string]$PythonBin = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $RunnerDir) {
  $RunnerDir = Join-Path $RootDir "runners\sd-scripts"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to install the LoRA runner."
}

if (-not $PythonBin) {
  foreach ($Candidate in @("python3.12", "python3.11", "python3.10", "python")) {
    if (Get-Command $Candidate -ErrorAction SilentlyContinue) {
      $PythonBin = $Candidate
      break
    }
  }
}

if (-not $PythonBin -or -not (Get-Command $PythonBin -ErrorAction SilentlyContinue)) {
  throw "Python 3.10 or newer is required. Pass -PythonBin if needed."
}

& $PythonBin -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) {
  throw "Python 3.10 or newer is required for the LoRA runner."
}

$RunnerGitDir = Join-Path $RunnerDir ".git"
if (Test-Path $RunnerGitDir) {
  Write-Host "Updating existing sd-scripts checkout..."
  git -C $RunnerDir pull --ff-only
} elseif (Test-Path $RunnerDir) {
  throw "$RunnerDir already exists but is not a git checkout. Move it aside or pass -RunnerDir."
} else {
  Write-Host "Cloning sd-scripts into $RunnerDir..."
  New-Item -ItemType Directory -Force -Path (Split-Path $RunnerDir) | Out-Null
  git clone $SdScriptsRepo $RunnerDir
}

$VenvDir = Join-Path $RunnerDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if ((Test-Path $VenvPython)) {
  & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Existing LoRA runner venv uses Python older than 3.10. Recreating it..."
    Remove-Item -Recurse -Force $VenvDir
  }
}

if (-not (Test-Path $VenvDir)) {
  Write-Host "Creating Python virtual environment..."
  & $PythonBin -m venv $VenvDir
}

& $VenvPython -m pip install --upgrade pip setuptools wheel
Push-Location $RunnerDir
try {
  & $VenvPython -m pip install -r "requirements.txt"
} finally {
  Pop-Location
}
& $VenvPython -m pip install accelerate torchvision

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
