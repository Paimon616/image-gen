#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/setup-webui-common.sh
source "$ROOT_DIR/scripts/setup-webui-common.sh"

WEBUI_DIR="${A1111_DIR:-$ROOT_DIR/stable-diffusion-webui}"
MODEL_ROOT="${COMFYUI_MODELS_DIR:-$ROOT_DIR/ComfyUI/models}"
WEBUI_REF="${A1111_REF:-v1.10.0}"

provision_webui "a1111" \
  "https://github.com/AUTOMATIC1111/stable-diffusion-webui.git" \
  "$WEBUI_REF" \
  "$WEBUI_DIR" \
  "${A1111_PORT:-7860}" \
  "$ROOT_DIR/scripts/run-a1111.sh"

# Provide the 4x-UltraSharp upscaler in the shared model tree (mirrors the
# Windows setup). Both WebUI backends point --esrgan-models-path here.
UPSCALE_DIR="$MODEL_ROOT/upscale_models"
ULTRASHARP="$UPSCALE_DIR/4x-UltraSharp.pth"
if [ ! -f "$ULTRASHARP" ]; then
  mkdir -p "$UPSCALE_DIR"
  echo "[a1111] Downloading 4x-UltraSharp upscaler..."
  if ! curl -fL \
    "https://huggingface.co/shiertier/upscale_models/resolve/b73626f248084e9af7108621ace5651e1447af44/4x-UltraSharp.pth" \
    -o "$ULTRASHARP"; then
    rm -f "$ULTRASHARP"
    echo "[a1111] Upscaler download failed (optional; you can add it later)." >&2
  fi
fi

echo "[a1111] Setup complete."
