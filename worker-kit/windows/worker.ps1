# GPU worker control script (Windows PowerShell 5.1+).
#
#   worker.ps1 start     everything in one go: first run installs the ComfyUI
#                        portable runtime and the firewall rule, then (if a depot
#                        is configured) syncs marc's setup, then starts ComfyUI
#   worker.ps1 install   only the runtime download
#   worker.ps1 sync      only the depot sync (optional; models can also be copied
#                        into data\models by hand)
#   worker.ps1 nodes     only the kit's pinned custom nodes (custom-nodes.json)
#   worker.ps1 stop      stop ComfyUI
#   worker.ps1 status    show whether it is running
#
# Everything lives inside this folder. Nothing outside it is read or written,
# except the Windows Firewall rule that firewall.ps1 adds (admin, once).
# marc decides what runs (ComfyUI version, nodes, models) through the depot
# manifest; the owner of this PC decides when it runs (start/stop).

param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "sync", "nodes", "start", "stop", "status")]
  [string]$Action = "status",
  [switch]$NoSync
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is 10x slower with the progress bar

$Kit = $PSScriptRoot
$ConfigPath = Join-Path $Kit "worker-config.json"
$Runtime = Join-Path $Kit "runtime"            # ComfyUI_windows_portable (python_embeded + ComfyUI)
$Python = Join-Path $Runtime "python_embeded\python.exe"
$Core = Join-Path $Runtime "ComfyUI"
$Data = Join-Path $Kit "data"                  # --base-directory: models, custom_nodes, input, output, user
$Logs = Join-Path $Kit "logs"
$PidFile = Join-Path $Kit "comfyui.pid"
$HelperPidFile = Join-Path $Kit "helper.pid"
$ManifestCache = Join-Path $Kit "manifest.json"
$KitNodesPath = Join-Path $Kit "custom-nodes.json"   # marc-pinned node list shipped with the kit

function Read-Config {
  if (-not (Test-Path $ConfigPath)) {
    throw "worker-config.json is missing. Put the file marc sent into this folder."
  }
  $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  if (-not $cfg.port) { $cfg | Add-Member -NotePropertyName port -NotePropertyValue 8188 -Force }
  return $cfg
}

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Invoke-Download($url, $dest, $token) {
  # curl.exe ships with Windows 10 1803+; resumes partial downloads (-C -).
  $part = "$dest.part"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  $curlArgs = @("-fL", "--retry", "3", "--retry-delay", "5", "-C", "-", "-o", $part)
  if ($token) { $curlArgs += @("-H", "Authorization: Bearer $token") }
  $curlArgs += $url
  & curl.exe @curlArgs
  if ($LASTEXITCODE -ne 0) {
    # Server ignored the range request; start over once.
    Remove-Item -Force -ErrorAction SilentlyContinue $part
    $curlArgs = $curlArgs | Where-Object { $_ -ne "-C" -and $_ -ne "-" }
    & curl.exe @curlArgs
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  }
  Move-Item -Force $part $dest
}

function Expand-GithubZip($repoUrl, $ref, $dest) {
  # https://github.com/owner/name(.git) at a commit -> extracted folder, no git needed.
  $slug = ($repoUrl -replace '^https://github.com/', '' -replace '\.git$', '')
  $zip = Join-Path $env:TEMP ("gpuworker-" + [guid]::NewGuid().ToString() + ".zip")
  $tmp = Join-Path $env:TEMP ("gpuworker-" + [guid]::NewGuid().ToString())
  try {
    Invoke-Download "https://codeload.github.com/$slug/zip/$ref" $zip $null
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp | Select-Object -First 1
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item $inner.FullName $dest
    Set-Content -Path (Join-Path $dest ".worker-ref") -Value $ref
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $zip
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
  }
}

function Get-KitPid($file) {
  if (-not (Test-Path $file)) { return $null }
  $id = [int](Get-Content $file -Raw)
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($proc -and $proc.Path -and ($proc.Path -like "$Runtime*")) { return $id }
  Remove-Item -Force -ErrorAction SilentlyContinue $file
  return $null
}

function Get-WorkerPid { Get-KitPid $PidFile }

function Install-Runtime {
  $cfg = Read-Config
  if (Test-Path $Python) { Write-Host "Runtime already installed: $Runtime"; return }
  $release = if ($cfg.portableRelease) { $cfg.portableRelease } else { "latest" }
  $asset = "ComfyUI_windows_portable_nvidia.7z"
  $url = if ($release -eq "latest") {
    "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/$asset"
  } else {
    "https://github.com/comfyanonymous/ComfyUI/releases/download/$release/$asset"
  }
  $archive = Join-Path $Kit $asset
  Write-Step "Downloading ComfyUI portable ($release, ~2 GB)"
  Invoke-Download $url $archive $null

  Write-Step "Extracting"
  $extractTo = Join-Path $Kit "_extract"
  New-Item -ItemType Directory -Force -Path $extractTo | Out-Null
  $sevenZip = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($sevenZip) {
    & $sevenZip x $archive "-o$extractTo" -y | Out-Null
  } else {
    # Windows 11 tar (libarchive) reads .7z.
    & tar.exe -xf $archive -C $extractTo
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not extract $asset. Install 7-Zip and run install again." }
  $inner = Get-ChildItem $extractTo -Directory | Select-Object -First 1
  Move-Item $inner.FullName $Runtime
  Remove-Item -Recurse -Force $extractTo
  Remove-Item -Force $archive
  New-Item -ItemType Directory -Force -Path $Data, $Logs | Out-Null
  Write-Host "Runtime installed. Next: start-worker.bat" -ForegroundColor Green
}

# The kit's own pinned custom nodes (custom-nodes.json, shipped and versioned
# with the kit). Installed locally on start; nothing remote can add to or change
# this list. Each entry must be a github.com https repo at a full 40-hex commit.
function Get-KitNodes {
  if (-not (Test-Path $KitNodesPath)) { return @() }
  $list = (Get-Content $KitNodesPath -Raw | ConvertFrom-Json).customNodes
  $valid = @()
  foreach ($node in $list) {
    if ($node.name -notmatch '^[A-Za-z0-9._-]+$') { Write-Warning "Skipping node with invalid name: $($node.name)"; continue }
    if ($node.repo -notmatch '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$') { Write-Warning "Skipping $($node.name): repo must be https://github.com/owner/name"; continue }
    if ($node.ref -notmatch '^[0-9a-f]{40}$') { Write-Warning "Skipping $($node.name): ref must be a full commit hash"; continue }
    $valid += $node
  }
  return $valid
}

function Install-NodeAtRef($node) {
  $nodesDir = Join-Path $Data "custom_nodes"
  New-Item -ItemType Directory -Force -Path $nodesDir | Out-Null
  $dest = Join-Path $nodesDir $node.name
  $refFile = Join-Path $dest ".worker-ref"
  $have = if (Test-Path $refFile) { (Get-Content $refFile -Raw).Trim() } else { "" }
  if ($have -eq $node.ref) { return }
  Write-Step "custom node $($node.name) -> $($node.ref.Substring(0, 10))"
  Expand-GithubZip $node.repo $node.ref $dest
  $req = Join-Path $dest "requirements.txt"
  if (Test-Path $req) {
    & $Python -s -m pip install --disable-pip-version-check -q -r $req
    if ($LASTEXITCODE -ne 0) { throw "pip install for $($node.name) failed." }
  }
  $installPy = Join-Path $dest "install.py"
  if (Test-Path $installPy) { & $Python -s $installPy }
}

function Install-KitNodes {
  if (-not (Test-Path $Python)) { throw "Runtime missing. Run start-worker.bat (installs it)." }
  if (Get-WorkerPid) { throw "ComfyUI is running. Stop it before installing nodes." }
  foreach ($node in Get-KitNodes) { Install-NodeAtRef $node }
}

function Get-Manifest($cfg) {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 `
      -Headers @{ Authorization = "Bearer $($cfg.token)" } `
      -Uri "$($cfg.depotUrl.TrimEnd('/'))/manifest"
    Set-Content -Path $ManifestCache -Value $res.Content -Encoding UTF8
    return $res.Content | ConvertFrom-Json
  } catch {
    Write-Warning "Depot not reachable ($($_.Exception.Message))."
    if (Test-Path $ManifestCache) {
      Write-Warning "Using the last synced setup."
      return $null
    }
    throw "First sync needs marc's depot running. Ask marc to start it."
  }
}

function Sync-Worker {
  $cfg = Read-Config
  if (-not $cfg.depotUrl) { Write-Host "No depotUrl configured; skipping sync."; return }
  if (-not (Test-Path $Python)) { throw "Runtime missing. Run start-worker.bat (installs it)." }
  if (Get-WorkerPid) { throw "ComfyUI is running. Stop it before syncing." }
  $manifest = Get-Manifest $cfg
  if (-not $manifest) { return }

  # 1. ComfyUI core at marc's pinned commit (replaces only runtime\ComfyUI code).
  $coreRefFile = Join-Path $Core ".worker-ref"
  $coreRef = if (Test-Path $coreRefFile) { (Get-Content $coreRefFile -Raw).Trim() } else { "" }
  if ($coreRef -ne $manifest.comfyui.ref) {
    Write-Step "ComfyUI core -> $($manifest.comfyui.ref.Substring(0, 10))"
    Expand-GithubZip "https://github.com/$($manifest.comfyui.repo)" $manifest.comfyui.ref $Core
    & $Python -s -m pip install --disable-pip-version-check -q -r (Join-Path $Core "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "pip install for ComfyUI core failed." }
  }

  # 2. Custom nodes: exactly the manifest list, at pinned refs. Anything else is disabled.
  $nodesDir = Join-Path $Data "custom_nodes"
  $disabledDir = Join-Path $Data "custom_nodes_disabled"
  New-Item -ItemType Directory -Force -Path $nodesDir | Out-Null
  $wanted = @{}
  # The kit's pinned nodes are always wanted (installed by Install-KitNodes).
  foreach ($node in Get-KitNodes) { $wanted[$node.name] = $true }
  foreach ($node in $manifest.customNodes) {
    $wanted[$node.name] = $true
    Install-NodeAtRef $node
  }
  Get-ChildItem $nodesDir -Directory | Where-Object { -not $wanted.ContainsKey($_.Name) } | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $disabledDir | Out-Null
    Write-Step "disable unlisted custom node $($_.Name)"
    Move-Item -Force $_.FullName (Join-Path $disabledDir $_.Name)
  }

  # 3. Models: download what is missing (size check when the depot knows it).
  foreach ($model in $manifest.models) {
    $dest = Join-Path $Data ("models\" + $model.folder + "\" + ($model.name -replace '/', '\'))
    $ok = Test-Path $dest
    if ($ok -and $model.size) { $ok = ((Get-Item $dest).Length -eq [int64]$model.size) }
    if ($ok) { continue }
    Write-Step "model $($model.folder)/$($model.name)"
    $url = "$($cfg.depotUrl.TrimEnd('/'))/files/$($model.folder)/" + [uri]::EscapeDataString($model.name)
    Invoke-Download $url $dest $cfg.token
  }
  Write-Host "Sync done." -ForegroundColor Green
}

function Test-FirewallOk($cfg) {
  $port = if ($cfg.port) { $cfg.port } else { 8188 }
  $rule = Get-NetFirewallRule -DisplayName "onechat GPU worker (ComfyUI $port)" -ErrorAction SilentlyContinue
  if (-not $rule -or $rule.Description -ne "onechat-gpu-worker v3") { return $false }
  # A rule Windows created from the "allow python.exe?" prompt (open to all,
  # or a block that overrides ours) means firewall.ps1 must clean up again.
  $others = Get-NetFirewallApplicationFilter -Program $Python -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -ne $rule.DisplayName }
  return -not $others
}

function Ensure-Firewall($cfg) {
  if (Test-FirewallOk $cfg) { return }
  Write-Step "Setting up the firewall rule (Windows will ask for admin permission)"
  $fw = Join-Path $Kit "firewall.ps1"
  Start-Process powershell -Verb RunAs -Wait `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$fw`""
  if (-not (Test-FirewallOk $cfg)) {
    throw "Firewall rule was not added; not starting (the port must stay closed to others)."
  }
}

function Start-Worker {
  $cfg = Read-Config
  if (Get-WorkerPid) { Write-Host "Already running."; return }
  if (-not (Test-Path $Python)) { Install-Runtime }
  Ensure-Firewall $cfg
  if (-not $NoSync) {
    try { Sync-Worker } catch { Write-Warning "Sync failed: $($_.Exception.Message). Starting with the current setup." }
  }
  try { Install-KitNodes } catch { Write-Warning "Kit custom nodes failed: $($_.Exception.Message). Starting without them." }
  # --base-directory does not create its subfolders; ComfyUI crashes at startup
  # listing a missing custom_nodes folder.
  foreach ($sub in @("custom_nodes", "models\checkpoints", "models\loras", "models\vae", "input", "output", "user")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Data $sub) | Out-Null
  }
  New-Item -ItemType Directory -Force -Path $Logs | Out-Null
  # Listen on every interface; firewall.ps1 lets only marc's Mac reach the port.
  $argsList = @(
    "-s", "`"$Core\main.py`"",
    "--listen", "0.0.0.0",
    "--port", "$($cfg.port)",
    "--base-directory", "`"$Data`"",
    "--disable-auto-launch",
    "--disable-api-nodes",
    "--preview-method", "none"
  )
  if ($cfg.extraArgs) { $argsList += $cfg.extraArgs }
  $log = Join-Path $Logs ("comfyui-" + (Get-Date -Format "yyyyMMdd") + ".log")
  $proc = Start-Process -FilePath $Python -ArgumentList $argsList -WorkingDirectory $Runtime `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  Set-Content -Path $PidFile -Value $proc.Id
  # Model helper: lets image-gen check and download model files (Civitai/HF)
  # into data\models, the same way it does for RunPod pods.
  if (-not (Get-KitPid $HelperPidFile)) {
    $helperPort = if ($cfg.helperPort) { $cfg.helperPort } else { 3000 }
    $helperLog = Join-Path $Logs ("helper-" + (Get-Date -Format "yyyyMMdd") + ".log")
    $helper = Start-Process -FilePath $Python `
      -ArgumentList @("-s", "`"$Kit\helper.py`"", "--models", "`"$Data\models`"", "--port", "$helperPort") `
      -WorkingDirectory $Kit -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $helperLog -RedirectStandardError "$helperLog.err"
    Set-Content -Path $HelperPidFile -Value $helper.Id
  }
  Write-Host "Starting ComfyUI on port $($cfg.port) (pid $($proc.Id))..."
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if ($proc.HasExited) { throw "ComfyUI exited. See $log.err" }
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$($cfg.port)/system_stats" | Out-Null
      Write-Host "GPU worker is ON. Close it any time with stop-worker.bat." -ForegroundColor Green
      return
    } catch {}
  }
  Write-Warning "ComfyUI is still starting. Check $log"
}

function Stop-Worker {
  $ids = @((Get-WorkerPid), (Get-KitPid $HelperPidFile)) | Where-Object { $_ }
  if ($ids.Count -eq 0) { Write-Host "Not running."; return }
  # /T kills the process tree (ComfyUI may spawn helpers).
  foreach ($id in $ids) { & taskkill.exe /PID $id /T /F | Out-Null }
  Remove-Item -Force -ErrorAction SilentlyContinue $PidFile, $HelperPidFile
  Write-Host "GPU worker is OFF." -ForegroundColor Yellow
}

function Show-Status {
  $id = Get-WorkerPid
  if ($id) { Write-Host "Running (pid $id)." -ForegroundColor Green } else { Write-Host "Stopped." }
}

switch ($Action) {
  "install" { Install-Runtime }
  "sync" { Sync-Worker }
  "nodes" { Install-KitNodes }
  "start" { Start-Worker }
  "stop" { Stop-Worker }
  "status" { Show-Status }
}
