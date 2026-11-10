# GPU worker control script (Windows PowerShell 5.1+).
#
#   worker.ps1 start     everything in one go: first run installs the ComfyUI
#                        portable runtime and the firewall rule, then (if a depot
#                        is configured) syncs marc's setup, then starts ComfyUI
#   worker.ps1 install   only the runtime download
#   worker.ps1 sync      only the depot sync (optional; models can also be copied
#                        into data\models by hand)
#   worker.ps1 nodes     only the kit's pinned custom nodes (custom-nodes.json)
#   worker.ps1 watch     auto-update loop (started by start when a depot is set):
#                        every few minutes it checks the depot; when marc changed
#                        the ComfyUI ref, nodes or kit files it waits until the
#                        queue is empty, then restarts the worker to apply them.
#                        New models download in the background without a restart.
#   worker.ps1 stop      stop ComfyUI (and the auto-update loop)
#   worker.ps1 status    show whether it is running
#
# Everything lives inside this folder. Nothing outside it is read or written,
# except the Windows Firewall rule that firewall.ps1 adds (admin, once).
# marc decides what runs (ComfyUI version, nodes, models) through the depot
# manifest; the owner of this PC decides when it runs (start/stop).

param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "sync", "nodes", "start", "watch", "stop", "status")]
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
$WatcherPidFile = Join-Path $Kit "watcher.pid"
$AppliedPath = Join-Path $Kit "applied-version.txt"    # signature of the depot setup this worker runs
$AttemptedPath = Join-Path $Kit "attempted-version.txt" # last signature the watcher restarted for
# Kit files the depot may replace (sha256-checked). Launchers (.bat), firewall.ps1
# (runs as admin) and worker-config.json are never replaced remotely.
$KitAutoFiles = @("worker.ps1", "helper.py", "custom-nodes.json")

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
function Test-NodeEntry($node) {
  if ($node.name -notmatch '^[A-Za-z0-9._-]+$') { Write-Warning "Skipping node with invalid name: $($node.name)"; return $false }
  if ($node.repo -notmatch '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$') { Write-Warning "Skipping $($node.name): repo must be https://github.com/owner/name"; return $false }
  if ($node.ref -notmatch '^[0-9a-f]{40}$') { Write-Warning "Skipping $($node.name): ref must be a full commit hash"; return $false }
  return $true
}

function Get-KitNodes {
  if (-not (Test-Path $KitNodesPath)) { return @() }
  $list = (Get-Content $KitNodesPath -Raw | ConvertFrom-Json).customNodes
  return @($list | Where-Object { Test-NodeEntry $_ })
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
  Sync-Code $manifest
  Sync-Models $manifest $cfg
  Set-Content -Path $AppliedPath -Value (Get-CodeSignature $manifest)
  Write-Host "Sync done." -ForegroundColor Green
}

# Signature of everything that needs a ComfyUI restart (core, nodes, kit files).
# Models are left out: they download while ComfyUI runs.
function Get-CodeSignature($manifest) {
  $parts = @("core=$($manifest.comfyui.ref)")
  foreach ($node in $manifest.customNodes) { $parts += "node=$($node.name)@$($node.ref)" }
  if ($manifest.kit) { foreach ($f in $manifest.kit.files) { $parts += "kit=$($f.name)@$($f.sha256)" } }
  $bytes = [Text.Encoding]::UTF8.GetBytes((($parts | Sort-Object) -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower()
}

# Replace kit files the depot lists (only $KitAutoFiles, sha256-verified).
# Returns $true when something changed, so the caller can rerun the new script.
function Update-KitFiles($manifest, $cfg) {
  if (-not $manifest.kit -or -not $manifest.kit.files) { return $false }
  $changed = $false
  foreach ($f in $manifest.kit.files) {
    if ($KitAutoFiles -notcontains $f.name) { Write-Warning "Ignoring kit file $($f.name) (not auto-updatable)."; continue }
    if ($f.sha256 -notmatch '^[0-9a-f]{64}$') { Write-Warning "Ignoring kit file $($f.name) (bad hash)."; continue }
    $dest = Join-Path $Kit $f.name
    if ((Test-Path $dest) -and ((Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower() -eq $f.sha256)) { continue }
    Write-Step "kit file $($f.name)"
    $tmp = "$dest.new"
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp, "$tmp.part"
    Invoke-Download "$($cfg.depotUrl.TrimEnd('/'))/kit/$($f.name)" $tmp $cfg.token
    if ((Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower() -ne $f.sha256) {
      Remove-Item -Force -ErrorAction SilentlyContinue $tmp
      throw "Kit file $($f.name) failed its hash check; keeping the old one."
    }
    Move-Item -Force $tmp $dest
    $changed = $true
  }
  return $changed
}

function Sync-Code($manifest) {
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
    if (-not (Test-NodeEntry $node)) { continue }
    $wanted[$node.name] = $true
    Install-NodeAtRef $node
  }
  Get-ChildItem $nodesDir -Directory | Where-Object { -not $wanted.ContainsKey($_.Name) } | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $disabledDir | Out-Null
    Write-Step "disable unlisted custom node $($_.Name)"
    Move-Item -Force $_.FullName (Join-Path $disabledDir $_.Name)
  }
}

function Sync-Models($manifest, $cfg) {
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
  if (-not $NoSync -and $cfg.depotUrl) {
    try {
      $manifest = Get-Manifest $cfg
      if ($manifest) {
        if (Update-KitFiles $manifest $cfg) {
          # PowerShell already parsed the old script; run the new one instead.
          Write-Step "Kit updated; continuing with the new worker.ps1"
          & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Kit "worker.ps1") start
          return
        }
        Sync-Code $manifest
        Sync-Models $manifest $cfg
        Set-Content -Path $AppliedPath -Value (Get-CodeSignature $manifest)
        Write-Host "Sync done." -ForegroundColor Green
      }
    } catch { Write-Warning "Sync failed: $($_.Exception.Message). Starting with the current setup." }
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
  Start-Watcher $cfg
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

function Get-WatcherPid {
  if (-not (Test-Path $WatcherPidFile)) { return $null }
  $id = [int](Get-Content $WatcherPidFile -Raw)
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -like "*worker.ps1*watch*") { return $id }
  Remove-Item -Force -ErrorAction SilentlyContinue $WatcherPidFile
  return $null
}

function Start-Watcher($cfg) {
  if (-not $cfg.depotUrl -or $cfg.autoUpdate -eq $false) { return }
  if (Get-WatcherPid) { return }
  $proc = Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Kit\worker.ps1`" watch"
  Set-Content -Path $WatcherPidFile -Value $proc.Id
}

function Write-WatchLog($text) {
  New-Item -ItemType Directory -Force -Path $Logs | Out-Null
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $text
  Add-Content -Path (Join-Path $Logs ("watch-" + (Get-Date -Format "yyyyMMdd") + ".log")) -Value $line
}

function Read-Text($path) { if (Test-Path $path) { (Get-Content $path -Raw).Trim() } else { "" } }

function Test-WorkerIdle($cfg) {
  try {
    $q = Invoke-RestMethod -TimeoutSec 5 "http://127.0.0.1:$($cfg.port)/queue"
    return (@($q.queue_running).Count -eq 0 -and @($q.queue_pending).Count -eq 0)
  } catch { return $false }
}

# Auto-update loop. Pulls from marc's depot only (same trust as start); nothing
# is pushed to this PC. Code changes are applied by a normal restart, and only
# while no generation is queued or running.
function Watch-Worker {
  $cfg = Read-Config
  if (-not $cfg.depotUrl -or $cfg.autoUpdate -eq $false) { return }
  Set-Content -Path $WatcherPidFile -Value $PID
  $minutes = if ($cfg.autoUpdateMinutes) { [Math]::Max(1, [int]$cfg.autoUpdateMinutes) } else { 10 }
  Write-WatchLog "watching $($cfg.depotUrl) every $minutes min"
  while ($true) {
    Start-Sleep -Seconds ($minutes * 60)
    if (-not (Get-WorkerPid)) { Write-WatchLog "worker stopped; exiting"; break }
    if ((Get-WatcherPid) -ne $PID) { break }
    try {
      $manifest = Get-Manifest $cfg
      if (-not $manifest) { continue }
      try { Sync-Models $manifest $cfg } catch { Write-WatchLog "model sync failed: $($_.Exception.Message)" }
      $sig = Get-CodeSignature $manifest
      if ($sig -eq (Read-Text $AppliedPath) -or $sig -eq (Read-Text $AttemptedPath)) { continue }
      Write-WatchLog "update available; waiting for an empty queue"
      $idle = 0
      while ($idle -lt 2) {
        Start-Sleep -Seconds 30
        if (-not (Get-WorkerPid)) { Write-WatchLog "worker stopped; exiting"; return }
        if (Test-WorkerIdle $cfg) { $idle++ } else { $idle = 0 }
      }
      Set-Content -Path $AttemptedPath -Value $sig
      Write-WatchLog "restarting to apply the update"
      Remove-Item -Force -ErrorAction SilentlyContinue $WatcherPidFile
      Stop-Worker
      Start-Process -FilePath "powershell.exe" -WindowStyle Hidden `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Kit\worker.ps1`" start"
      return
    } catch { Write-WatchLog "check failed: $($_.Exception.Message)" }
  }
  if ((Read-Text $WatcherPidFile) -eq "$PID") { Remove-Item -Force -ErrorAction SilentlyContinue $WatcherPidFile }
}

function Stop-Worker {
  $watcher = Get-WatcherPid
  if ($watcher -and $watcher -ne $PID) { & taskkill.exe /PID $watcher /F | Out-Null }
  Remove-Item -Force -ErrorAction SilentlyContinue $WatcherPidFile
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
  if (Get-WatcherPid) { Write-Host "Auto-update: on (logs\watch-*.log)." }
}

switch ($Action) {
  "install" { Install-Runtime }
  "sync" { Sync-Worker }
  "nodes" { Install-KitNodes }
  "start" { Start-Worker }
  "watch" { Watch-Worker }
  "stop" { Stop-Worker }
  "status" { Show-Status }
}
