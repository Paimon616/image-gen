param(
  [string]$ImageGenHost = "127.0.0.1",
  [int]$ImageGenPort = 5353,
  [string]$ImageGenUrl = "",
  [string]$ComfyUIHost = "127.0.0.1",
  [int]$ComfyUIPort = 8188,
  [string]$ComfyUIDir = "",
  [string]$A1111Host = "127.0.0.1",
  [int]$A1111Port = 7860,
  [string]$A1111Dir = "",
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
if (-not $A1111Dir) {
  $A1111Dir = Join-Path $RootDir "stable-diffusion-webui"
}
if (-not $LoraRunnerDir) {
  $LoraRunnerDir = Join-Path $RootDir "runners\sd-scripts"
}

$StartedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$LauncherJob = $null

function Initialize-LauncherJob {
  if ($script:LauncherJob) {
    return
  }

  if (-not ("ImageGenLauncher.NativeMethods" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace ImageGenLauncher {
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public UInt64 ReadOperationCount;
    public UInt64 WriteOperationCount;
    public UInt64 OtherOperationCount;
    public UInt64 ReadTransferCount;
    public UInt64 WriteTransferCount;
    public UInt64 OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public Int64 PerProcessUserTimeLimit;
    public Int64 PerJobUserTimeLimit;
    public UInt32 LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public UInt32 ActiveProcessLimit;
    public UIntPtr Affinity;
    public UInt32 PriorityClass;
    public UInt32 SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct SECURITY_ATTRIBUTES {
    public UInt32 nLength;
    public IntPtr lpSecurityDescriptor;
    public Int32 bInheritHandle;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  public static class NativeMethods {
    public const UInt32 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    public const Int32 JobObjectExtendedLimitInformation = 9;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll")]
    public static extern bool SetInformationJobObject(
      IntPtr hJob,
      Int32 infoType,
      IntPtr lpJobObjectInfo,
      UInt32 cbJobObjectInfoLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);
  }
}
"@
  }

  $Job = [ImageGenLauncher.NativeMethods]::CreateJobObject([IntPtr]::Zero, $null)
  if ($Job -eq [IntPtr]::Zero) {
    Write-Warning "Could not create launcher process group. Child servers may need manual cleanup."
    return
  }

  $Info = New-Object ImageGenLauncher.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $Info.BasicLimitInformation.LimitFlags = [ImageGenLauncher.NativeMethods]::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  $InfoSize = [Runtime.InteropServices.Marshal]::SizeOf($Info)
  $InfoPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($InfoSize)

  try {
    [Runtime.InteropServices.Marshal]::StructureToPtr($Info, $InfoPtr, $false)
    $Ok = [ImageGenLauncher.NativeMethods]::SetInformationJobObject(
      $Job,
      [ImageGenLauncher.NativeMethods]::JobObjectExtendedLimitInformation,
      $InfoPtr,
      [uint32]$InfoSize
    )

    if (-not $Ok) {
      [ImageGenLauncher.NativeMethods]::CloseHandle($Job) | Out-Null
      Write-Warning "Could not configure launcher process group. Child servers may need manual cleanup."
      return
    }

    $script:LauncherJob = $Job
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($InfoPtr)
  }
}

function Add-ProcessToLauncherJob {
  param(
    [System.Diagnostics.Process]$Process
  )

  Initialize-LauncherJob
  if (-not $script:LauncherJob -or -not $Process) {
    return
  }

  $Ok = [ImageGenLauncher.NativeMethods]::AssignProcessToJobObject(
    $script:LauncherJob,
    $Process.Handle
  )

  if (-not $Ok) {
    Write-Warning "Could not attach process $($Process.Id) to launcher process group."
  }
}

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

function Stop-LocalPort {
  param(
    [string]$Name,
    [int]$Port
  )

  $Connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($Connections.Count -eq 0) {
    return
  }

  $ProcessIds = @($Connections | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
  if ($ProcessIds.Count -eq 0) {
    return
  }

  Write-Host "$Name is already running on port $Port. Stopping existing process..."
  foreach ($ProcessId in $ProcessIds) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }

  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-Port -HostName "127.0.0.1" -Port $Port)) {
      Write-Host "$Name port $Port is clear."
      return
    }

    Start-Sleep -Milliseconds 500
  }

  Write-Error "Timed out stopping existing $Name process on port $Port."
}

function Stop-ExistingLocalServers {
  Stop-LocalPort -Name "Image Gen" -Port $ImageGenPort
  Stop-LocalPort -Name "ComfyUI" -Port $ComfyUIPort
  Stop-LocalPort -Name "A1111" -Port $A1111Port
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
  Add-ProcessToLauncherJob -Process $Process
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
  $NpmCommand = Ensure-Npm

  $StdOutLog = Join-Path $LogDir "image-gen.out.log"
  $StdErrLog = Join-Path $LogDir "image-gen.err.log"

  Write-Host "Starting Image Gen dev server..."
  $Process = Start-Process `
    -FilePath $NpmCommand `
    -ArgumentList @("run", "dev", "--", "--hostname", $ImageGenHost, "--port", [string]$ImageGenPort) `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $StdOutLog `
    -RedirectStandardError $StdErrLog `
    -PassThru `
    -WindowStyle Hidden

  $StartedProcesses.Add($Process) | Out-Null
  Add-ProcessToLauncherJob -Process $Process
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
  Stop-ExistingLocalServers

  $env:COMFYUI_HOST = $ComfyUIHost
  $env:COMFYUI_PORT = [string]$ComfyUIPort
  $env:COMFYUI_DIR = $ComfyUIDir
  $env:A1111_DIR = $A1111Dir
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

  $A1111Launch = Join-Path $A1111Dir "launch.py"
  $A1111Python = Join-Path $A1111Dir "venv\Scripts\python.exe"
  $A1111ADetailer = Join-Path $A1111Dir "extensions\adetailer\scripts\!adetailer.py"
  if (
    (-not (Test-Path $A1111Launch)) -or
    (-not (Test-Path $A1111Python)) -or
    (-not (Test-Path $A1111ADetailer))
  ) {
    Write-Host "A1111 or its ADetailer extension is missing. Running setup..."
    $NpmCommand = Ensure-Npm
    Push-Location $RootDir
    try {
      & $NpmCommand run setup:a1111:win
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

  Start-LocalService `
    -Name "A1111" `
    -HostName $A1111Host `
    -Port $A1111Port `
    -Arguments @("run", "a1111:win", "--", "-HostName", $A1111Host, "-Port", [string]$A1111Port)

  Start-ImageGen

  Write-Host "Opening $ImageGenUrl"
  Start-Process $ImageGenUrl

  if ($StartedProcesses.Count -gt 0) {
    Write-Host ""
    Write-Host "Servers are running. Keep this window open; press Ctrl-C or close it to stop servers started by this launcher."
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

  if ($script:LauncherJob) {
    [ImageGenLauncher.NativeMethods]::CloseHandle($script:LauncherJob) | Out-Null
    $script:LauncherJob = $null
  }
}
