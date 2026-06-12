param(
  [string]$ImageGenHost = "127.0.0.1",
  [int]$ImageGenPort = 3100,
  [string]$ImageGenUrl = "",
  [string]$ComfyUIHost = "127.0.0.1",
  [int]$ComfyUIPort = 8188,
  [string]$LogDir = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ImageGenUrl) {
  $ImageGenUrl = "http://localhost:$ImageGenPort"
}
if (-not $LogDir) {
  $LogDir = Join-Path $RootDir ".local\logs"
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

  $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $NpmCommand) {
    throw "npm is required."
  }

  $SafeName = $Name.ToLowerInvariant().Replace(" ", "-")
  $StdOutLog = Join-Path $LogDir "$SafeName.out.log"
  $StdErrLog = Join-Path $LogDir "$SafeName.err.log"

  Write-Host "Starting $Name..."
  $Process = Start-Process `
    -FilePath $NpmCommand.Source `
    -ArgumentList $Arguments `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $StdOutLog `
    -RedirectStandardError $StdErrLog `
    -PassThru `
    -WindowStyle Hidden

  $StartedProcesses.Add($Process) | Out-Null
  Wait-ForPort -Name $Name -HostName $HostName -Port $Port -Process $Process -StdOutLog $StdOutLog -StdErrLog $StdErrLog
}

try {
  if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    throw "Node dependencies are missing. Run: npm install"
  }

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  $env:COMFYUI_HOST = $ComfyUIHost
  $env:COMFYUI_PORT = [string]$ComfyUIPort

  Start-LocalService `
    -Name "ComfyUI" `
    -HostName $ComfyUIHost `
    -Port $ComfyUIPort `
    -Arguments @("run", "comfyui:win", "--", "-HostName", $ComfyUIHost, "-Port", [string]$ComfyUIPort)

  Start-LocalService `
    -Name "Image Gen" `
    -HostName $ImageGenHost `
    -Port $ImageGenPort `
    -Arguments @("run", "dev", "--", "--hostname", $ImageGenHost, "--port", [string]$ImageGenPort)

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
