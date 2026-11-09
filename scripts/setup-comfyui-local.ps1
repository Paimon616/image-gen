<#
  One-click ComfyUI setup for a Windows PC with an NVIDIA GPU (used by
  setup-comfyui.bat in the repo root). Wraps scripts\setup-comfyui.ps1 and fixes
  the three things that went wrong when it was run by hand:

    1. Python: "python" is often the Microsoft Store stub, so a real Python 3.12
       is located (or installed with winget) and passed explicitly.
    2. ComfyUI version: pinned to the commit the local stack was tested on
       (v0.34.0 - needed for the MiniMax H3 native video nodes).
    3. Torch: ComfyUI's requirements install the CPU build of torch on Windows,
       so the CUDA 13.0 build is installed afterwards.

  Then run install-local-models.bat for the models and LoRAs.
#>
param(
  [string]$ComfyUIRef = "12d5279438bfefc058a269eae805ceab6047777f",
  [string]$TorchIndex = "https://download.pytorch.org/whl/cu130",
  [string[]]$TorchPackages = @("torch==2.14.1+cu130", "torchvision==0.29.1+cu130", "torchaudio==2.11.0+cu130"),
  [switch]$SkipTorch
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComfyUIDir = Join-Path $RepoRoot "ComfyUI"
$env:PYTHONUTF8 = "1"

function Find-RealPython {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    (Join-Path $env:ProgramFiles "Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"),
    (Join-Path $env:ProgramFiles "Python311\python.exe")
  )
  # The py launcher knows real installs and never resolves to the Store stub.
  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($v in "3.12", "3.11") {
      $p = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $p) { $candidates = @($p.Trim()) + $candidates }
    }
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c) -and ($c -notmatch "WindowsApps")) { return $c }
  }
  return ""
}

Write-Host "==> Checking NVIDIA GPU..."
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
} else {
  Write-Warning "nvidia-smi not found. Install the latest NVIDIA driver first (CUDA 13.0 torch needs driver 580 or newer)."
}

Write-Host "==> Finding Python 3.12..."
$python = Find-RealPython
if (-not $python) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Python 3.12 is not installed and winget is not available. Install Python 3.12 from python.org, then run this again."
  }
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  $python = Find-RealPython
  if (-not $python) { throw "Python 3.12 was installed but could not be found. Close this window and run setup-comfyui.bat again." }
}
Write-Host "    $python"

Write-Host "==> Installing ComfyUI ($ComfyUIRef)..."
& (Join-Path $PSScriptRoot "setup-comfyui.ps1") -ComfyUIRef $ComfyUIRef -PythonBin $python

$venvPython = Join-Path $ComfyUIDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { throw "ComfyUI venv was not created at $venvPython." }

if (-not $SkipTorch) {
  $cuda = & $venvPython -c "import torch; print(torch.version.cuda or '')" 2>$null
  if ($LASTEXITCODE -eq 0 -and $cuda) {
    Write-Host "==> Torch already has CUDA $cuda"
  } else {
    Write-Host "==> Installing CUDA torch ($($TorchPackages -join ', '))..."
    & $venvPython -m pip install --force-reinstall --no-deps @TorchPackages --index-url $TorchIndex
    if ($LASTEXITCODE -ne 0) { throw "CUDA torch install failed. Check the network, then run setup-comfyui.bat again." }
    # Install anything the CUDA wheels need that the CPU build did not.
    & $venvPython -m pip install @TorchPackages --index-url $TorchIndex --extra-index-url https://pypi.org/simple
  }
}

Write-Host "==> Checking..."
& $venvPython -c "import torch; ok = torch.cuda.is_available(); print('torch', torch.__version__, '| CUDA', torch.version.cuda, '| GPU:', torch.cuda.get_device_name(0) if ok else 'NOT AVAILABLE')"

Write-Host ""
Write-Host "ComfyUI is ready." -ForegroundColor Green
Write-Host "Next: put CIVITAI_API_TOKEN in .env.local, then double-click install-local-models.bat."
