param(
  [string]$ImageGenHost = "127.0.0.1",
  [int]$ImageGenPort = 5353,
  [string]$ImageGenUrl = "",
  [string]$ComfyUIHost = "127.0.0.1",
  [int]$ComfyUIPort = 8188,
  [string]$ComfyUIDir = "",
  [string]$LoraRunnerDir = "",
  [string]$LogDir = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-prereqs.ps1")

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ImageGenUrl) {
  $ImageGenUrl = "http://${ImageGenHost}:$ImageGenPort"
}
if (-not $LogDir) {
  $LogDir = Join-Path $RootDir ".local\logs"
}
if (-not $ComfyUIDir) {
  $ComfyUIDir = Join-Path $RootDir "ComfyUI"
}
if (-not $LoraRunnerDir) {
  $LoraRunnerDir = Join-Path $RootDir "runners\sd-scripts"
}

$StartedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

function Test-Port {
  param(
    [string]$HostName,
    [int]$Port
  )

  $Client = New-Object System.Net.Sockets.TcpClient
  try {
    $Result = $Client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $Result.AsyncWaitHandle.WaitOne(300, $false)) {
      return $false
    }
    $Client.EndConnect($Result)
    return $true
  } catch {
    return $false
  } finally {
    $Client.Close()
  }
}

function Wait-ForPort {
  param(
    [string]$Name,
    [string]$HostName,
    [int]$Port,
    [System.Diagnostics.Process]$Process,
    [string]$StdOutLog,
    [string]$StdErrLog
  )

  for ($i = 0; $i -lt 120; $i++) {
    if (Test-Port -HostName $HostName -Port $Port) {
      if ($Process) {
        Start-Sleep -Seconds 2
        if ($Process.HasExited) {
          Write-Error "$Name stopped after opening port $Port. Logs: $StdOutLog / $StdErrLog"
        }
      }
      Write-Host "$Name is ready on port $Port."
      return
    }

    if ($Process -and $Process.HasExited) {
      Write-Error "$Name stopped before port $Port became ready. Logs: $StdOutLog / $StdErrLog"
    }

    Start-Sleep -Seconds 1
  }

  Write-Error "Timed out waiting for $Name on port $Port. Logs: $StdOutLog / $StdErrLog"
}

function Start-LocalService {
  param(
    [string]$Name,
    [string]$HostName,
    [int]$Port,
    [string[]]$Arguments
  )

  if (Test-Port -HostName $HostName -Port $Port) {
    Write-Host "$Name already appears to be running on port $Port."
    return
  }

  $NpmCommand = Ensure-Npm

  $SafeName = $Name.ToLowerInvariant().Replace(" ", "-")
  $StdOutLog = Join-Path $LogDir "$SafeName.out.log"
  $StdErrLog = Join-Path $LogDir "$SafeName.err.log"

  Write-Host "Starting $Name..."
  $Process = Start-Process `
    -FilePath $NpmCommand `
    -ArgumentList $Arguments `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $StdOutLog `
    -RedirectStandardError $StdErrLog `
    -PassThru `
    -WindowStyle Hidden

  $StartedProcesses.Add($Process) | Out-Null
  Wait-ForPort -Name $Name -HostName $HostName -Port $Port -Process $Process -StdOutLog $StdOutLog -StdErrLog $StdErrLog
}

function Wait-ForHttp {
  param(
    [string]$Name,
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [string]$StdOutLog,
    [string]$StdErrLog
  )

  for ($i = 0; $i -lt 120; $i++) {
    try {
      $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ([int]$Response.StatusCode -ge 200 -and [int]$Response.StatusCode -lt 500) {
        Write-Host "$Name is responding at $Url."
        return
      }
    } catch {
    }

    if ($Process -and $Process.HasExited) {
      Write-Error "$Name stopped before $Url responded. Logs: $StdOutLog / $StdErrLog"
    }

    Start-Sleep -Seconds 1
  }

  Write-Error "Timed out waiting for $Name at $Url. Logs: $StdOutLog / $StdErrLog"
}

function Start-ImageGen {
  if (Test-Port -HostName $ImageGenHost -Port $ImageGenPort) {
    Write-Host "Image Gen already appears to be running on port $ImageGenPort."
    Wait-ForHttp -Name "Image Gen" -Url $ImageGenUrl
    return
  }

  $NpmCommand = Ensure-Npm

  Write-Host "Building Image Gen for local launch..."
  Push-Location $RootDir
  try {
    & $NpmCommand run build
  } finally {
    Pop-Location
  }

  $StdOutLog = Join-Path $LogDir "image-gen.out.log"
  $StdErrLog = Join-Path $LogDir "image-gen.err.log"

  Write-Host "Starting Image Gen..."
  $Process = Start-Process `
    -FilePath $NpmCommand `
    -ArgumentList @("run", "start", "--", "--hostname", $ImageGenHost, "--port", [string]$ImageGenPort) `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $StdOutLog `
    -RedirectStandardError $StdErrLog `
    -PassThru `
    -WindowStyle Hidden

  $StartedProcesses.Add($Process) | Out-Null
  Wait-ForPort -Name "Image Gen" -HostName $ImageGenHost -Port $ImageGenPort -Process $Process -StdOutLog $StdOutLog -StdErrLog $StdErrLog
  Wait-ForHttp -Name "Image Gen" -Url $ImageGenUrl -Process $Process -StdOutLog $StdOutLog -StdErrLog $StdErrLog
}

try {
  if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    Write-Host "Node dependencies are missing. Running npm install..."
    $NpmCommand = Ensure-Npm
    Push-Location $RootDir
    try {
      & $NpmCommand install
    } finally {
      Pop-Location
    }
  }

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  $env:COMFYUI_HOST = $ComfyUIHost
  $env:COMFYUI_PORT = [string]$ComfyUIPort
  $env:COMFYUI_DIR = $ComfyUIDir
  $env:LORA_RUNNER_DIR = $LoraRunnerDir

  $ComfyMain = Join-Path $ComfyUIDir "main.py"
  $ComfyPython = Join-Path $ComfyUIDir "venv\Scripts\python.exe"
  if ((-not (Test-Path $ComfyMain)) -or (-not (Test-Path $ComfyPython))) {
    Write-Host "ComfyUI is missing. Running setup..."
    $NpmCommand = Ensure-Npm
    Push-Location $RootDir
    try {
      & $NpmCommand run setup:comfyui:win
    } finally {
      Pop-Location
    }
  }

  $LoraTrainScript = Join-Path $LoraRunnerDir "sdxl_train_network.py"
  $LoraPython = Join-Path $LoraRunnerDir ".venv\Scripts\python.exe"
  if ((-not (Test-Path $LoraTrainScript)) -or (-not (Test-Path $LoraPython))) {
    Write-Host "LoRA runner is missing. Running setup..."
    $NpmCommand = Ensure-Npm
    Push-Location $RootDir
    try {
      & $NpmCommand run setup:lora-runner:win
    } finally {
      Pop-Location
    }
  }

  Start-LocalService `
    -Name "ComfyUI" `
    -HostName $ComfyUIHost `
    -Port $ComfyUIPort `
    -Arguments @("run", "comfyui:win", "--", "-HostName", $ComfyUIHost, "-Port", [string]$ComfyUIPort)

  Start-ImageGen

  Write-Host "Opening $ImageGenUrl"
  Start-Process $ImageGenUrl

  if ($StartedProcesses.Count -gt 0) {
    Write-Host ""
    Write-Host "Servers are running. Keep this window open; press Ctrl-C to stop servers started by this launcher."
    Wait-Process -Id ($StartedProcesses | ForEach-Object { $_.Id })
  }
} finally {
  if ($StartedProcesses.Count -gt 0) {
    Write-Host ""
    Write-Host "Stopping local servers..."
    foreach ($Process in $StartedProcesses) {
      if (-not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
}
