# One-time, run as administrator (install-worker.bat elevates for you).
# Lets ONLY marc's Mac reach this PC's ComfyUI port. ComfyUI has no login, so
# the port must never be reachable from anywhere else, and never from the
# internet. Re-run after marc's Mac IP changes.

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$Kit = $PSScriptRoot
$cfg = Get-Content (Join-Path $Kit "worker-config.json") -Raw | ConvertFrom-Json
$port = if ($cfg.port) { $cfg.port } else { 8188 }
$ruleName = "onechat GPU worker (ComfyUI $port)"
$python = Join-Path $Kit "runtime\python_embeded\python.exe"

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# Windows asks "allow python.exe?" the first time ComfyUI listens. If someone
# clicked Allow, that rule opens the port to everyone on the network; remove it.
Get-NetFirewallApplicationFilter -Program $python -ErrorAction SilentlyContinue |
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -ne $ruleName } |
  Remove-NetFirewallRule

if ($Remove) {
  Write-Host "Firewall rule removed. Nothing can reach the worker port now." -ForegroundColor Yellow
  exit 0
}

$allow = @($cfg.allowFrom) | Where-Object { $_ }
if ($allow.Count -eq 0) { throw "worker-config.json allowFrom is empty (marc's Mac IP)." }

New-NetFirewallRule -DisplayName $ruleName `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
  -RemoteAddress $allow -Program $python `
  -Profile Domain,Private | Out-Null
# Explicit block for everyone else on this port, including the Public profile.
New-NetFirewallRule -DisplayName "$ruleName - block others" `
  -Direction Inbound -Action Block -Protocol TCP -LocalPort $port `
  -RemoteAddress Any -Profile Public | Out-Null

Write-Host "Firewall: port $port open only to $($allow -join ', ') (Domain/Private networks)." -ForegroundColor Green
