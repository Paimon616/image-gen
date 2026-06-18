$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Update-ProcessPath {
  $CurrentPath = $env:Path
  $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($CurrentPath, $MachinePath, $UserPath) -join ";"
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PackageId,
    [Parameter(Mandatory = $true)]
    [string]$DisplayName
  )

  $Winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $Winget) {
    throw "$DisplayName is required, and winget is not available to install it automatically."
  }

  Write-Host "$DisplayName is missing. Installing with winget..."
  Invoke-Checked {
    & $Winget.Source install --id $PackageId --exact --source winget --accept-package-agreements --accept-source-agreements
  } "Failed to install $DisplayName with winget."
  Update-ProcessPath
}

function Ensure-Git {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    return
  }

  Install-WingetPackage -PackageId "Git.Git" -DisplayName "Git"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git was installed, but git is still not available in PATH. Restart this terminal and run the launcher again."
  }
}

function Ensure-Npm {
  $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  if ($NpmCommand) {
    return $NpmCommand.Source
  }

  Install-WingetPackage -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
  $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  if ($NpmCommand) {
    return $NpmCommand.Source
  }

  throw "Node.js LTS was installed, but npm is still not available in PATH. Restart this terminal and run the launcher again."
}

function Test-Python310 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PythonBin
  )

  $Command = Get-Command $PythonBin -ErrorAction SilentlyContinue
  if (-not $Command) {
    return $false
  }

  & $Command.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
  return $LASTEXITCODE -eq 0
}

function Find-Python310 {
  param(
    [string]$PreferredBin = ""
  )

  $Candidates = @()
  if ($PreferredBin) {
    $Candidates += $PreferredBin
  }
  $Candidates += @("python3.12", "python3.11", "python3.10", "python")

  foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
    if (Test-Python310 -PythonBin $Candidate) {
      return (Get-Command $Candidate).Source
    }
  }

  return ""
}

function Ensure-Python310 {
  param(
    [string]$PreferredBin = ""
  )

  $PythonBin = Find-Python310 -PreferredBin $PreferredBin
  if ($PythonBin) {
    return $PythonBin
  }

  Install-WingetPackage -PackageId "Python.Python.3.12" -DisplayName "Python 3.12"
  $PythonBin = Find-Python310 -PreferredBin $PreferredBin
  if ($PythonBin) {
    return $PythonBin
  }

  throw "Python 3.10 or newer was installed, but it is still not available in PATH. Restart this terminal and run the launcher again."
}
