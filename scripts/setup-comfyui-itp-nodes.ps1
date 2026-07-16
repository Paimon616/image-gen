param(
  [string]$ComfyUIDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# The image-to-prompt custom nodes (WD14-Tagger, Custom-Scripts, Florence2) are
# now managed as pinned entries in comfyui-config/custom-nodes.json. This script
# delegates to the unified config provisioner so there is a single source of truth.

Write-Host "Image-to-prompt nodes are provisioned via comfyui-config/custom-nodes.json."
Write-Host "Delegating to setup-comfyui-config.ps1..."

$ConfigScript = Join-Path $PSScriptRoot "setup-comfyui-config.ps1"
$params = @{}
if ($ComfyUIDir) { $params["ComfyUIDir"] = $ComfyUIDir }
if ($Force) { $params["Force"] = $true }
& $ConfigScript @params
