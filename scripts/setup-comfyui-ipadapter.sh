#!/usr/bin/env bash
set -euo pipefail

# Provisions the BETA "캐릭터 기준 시트" (character reference sheet) feature on the
# local ComfyUI (docs/character-reference-sheet.md):
#   1. ComfyUI_IPAdapter_plus custom node, pinned in comfyui-config/custom-nodes.json
#      (installed by the shared config provisioner).
#   2. models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors   (~848 MB)
#   3. models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors (~2.5 GB)
# Idempotent: files already present at the expected size are skipped; a partial
# download resumes. Restart ComfyUI afterwards so the node loads.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
MODELS_DIR="${COMFYUI_MODELS_DIR:-$COMFYUI_DIR/models}"

echo "==> Installing ComfyUI_IPAdapter_plus via the ComfyUI config provisioner..."
bash "$ROOT_DIR/scripts/setup-comfyui-config.sh" "$@"

file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0
}

fetch() {
  local rel="$1" url="$2" bytes="$3"
  local dest="$MODELS_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && [ "$(file_size "$dest")" -eq "$bytes" ]; then
    echo "  already present: $rel"
    return
  fi
  echo "  downloading $rel..."
  curl -L -f -C - -o "$dest.part" "$url"
  if [ "$(file_size "$dest.part")" -ne "$bytes" ]; then
    echo "Downloaded size mismatch for $rel; left $dest.part to resume." >&2
    exit 1
  fi
  mv "$dest.part" "$dest"
}

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

echo
echo "==> Fetching IP-Adapter models into $MODELS_DIR ..."
# Keep in sync with IPADAPTER_MODEL / IPADAPTER_CLIP_VISION in src/lib/character-sheet.ts.
fetch "ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
  847517512
fetch "clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
  2528373448

echo
echo "IP-Adapter is ready. Restart ComfyUI, then turn on Settings > 베타 기능 >"
echo "캐릭터 기준 시트 and confirm a sheet in the character studio."
