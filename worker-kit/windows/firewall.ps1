# Run as administrator (start-worker.bat elevates for you when needed).
# Opens this PC's ComfyUI port and the model helper port only to the addresses in worker-config.json
# allowFrom (IPs or CIDR, e.g. 10.202.0.0/16). ComfyUI has no login, so the
# port must never be reachable from anywhere else, and never from the internet.
# Re-run after allowFrom changes.

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$Kit = $PSScriptRoot
$cfg = Get-Content (Join-Path $Kit "worker-config.json") -Raw | ConvertFrom-Json
$port = if ($cfg.port) { $cfg.port } else { 8188 }
$ruleName = "onechat GPU worker (ComfyUI $port)"
$ruleVersion = "onechat-gpu-worker v3"
$helperPort = if ($cfg.helperPort) { $cfg.helperPort } else { 3000 }
$python = Join-Path $Kit "runtime\python_embeded\python.exe"

# Our rules from any earlier kit version (v1 also added a Public block rule,
# which overrode the allow rule on networks Windows classifies as Public).
Get-NetFirewallRule -DisplayName "$ruleName*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# Windows asks "allow python.exe?" the first time a program listens. Clicking
# Allow creates a rule open to everyone; clicking Cancel creates a block rule
# that overrides ours. Remove both kinds for this kit's python.exe.
Get-NetFirewallApplicationFilter -Program $python -ErrorAction SilentlyContinue |
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

if ($Remove) {
  Write-Host "Firewall rule removed. Nothing can reach the worker port now." -ForegroundColor Yellow
  exit 0
}

$allow = @($cfg.allowFrom) | Where-Object { $_ }
if ($allow.Count -eq 0) { throw "worker-config.json allowFrom is empty." }

# All profiles: office networks are often classified as Public on PCs that
# are not domain-joined. The address filter is what limits access; inbound
# traffic not matching an allow rule stays blocked by Windows' default.
New-NetFirewallRule -DisplayName $ruleName -Description $ruleVersion `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort @($port, $helperPort) `
  -RemoteAddress $allow -Program $python -Profile Any | Out-Null

Write-Host "Firewall: ports $port, $helperPort open only to $($allow -join ', ')." -ForegroundColor Green
