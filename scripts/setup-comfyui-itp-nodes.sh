#!/usr/bin/env bash
set -euo pipefail

# The image-to-prompt custom nodes (WD14-Tagger, Custom-Scripts, Florence2) are
# now managed as pinned entries in comfyui-config/custom-nodes.json. This script
# delegates to the unified config provisioner so there is a single source of truth.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Image-to-prompt nodes are provisioned via comfyui-config/custom-nodes.json."
echo "Delegating to setup-comfyui-config.sh..."
exec bash "$ROOT_DIR/scripts/setup-comfyui-config.sh" "$@"
