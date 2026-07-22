#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/setup-webui-common.sh
source "$ROOT_DIR/scripts/setup-webui-common.sh"

FORGE_DIR="${FORGE_DIR:-$ROOT_DIR/stable-diffusion-webui-forge}"

provision_webui "forge" \
  "https://github.com/lllyasviel/stable-diffusion-webui-forge.git" \
  "${FORGE_REF:-}" \
  "$FORGE_DIR" \
  "${FORGE_PORT:-7861}" \
  "$ROOT_DIR/scripts/run-forge.sh"

echo "[forge] Setup complete."
