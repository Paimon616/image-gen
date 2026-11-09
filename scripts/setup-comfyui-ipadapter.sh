#!/usr/bin/env bash
set -euo pipefail

# Provisions the BETA "캐릭터 기준 시트" (character reference sheet) feature on the
# local ComfyUI (docs/character-reference-sheet.md):
#   1. ComfyUI_IPAdapter_plus custom node, pinned in comfyui-config/custom-nodes.json
#      (installed by the shared config provisioner).
#   2. models/ipadapter/NOOB-IPA-MARK1.safetensors (~1.4 GB, Civitai: needs
#      CIVITAI_API_TOKEN or the key saved in .local/settings.json)
#   3. models/clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors (~3.7 GB)
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

TOKEN="${CIVITAI_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$ROOT_DIR/.local/settings.json" ] && command -v python3 >/dev/null 2>&1; then
  TOKEN="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("civitaiApiKey",""))' "$ROOT_DIR/.local/settings.json" 2>/dev/null || true)"
fi

fetch() {
  local rel="$1" url="$2" bytes="$3" auth="${4:-}"
  local dest="$MODELS_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && [ "$(file_size "$dest")" -eq "$bytes" ]; then
    echo "  already present: $rel"
    return
  fi
  echo "  downloading $rel..."
  if [ -n "$auth" ]; then
    curl -L -f -C - -H "Authorization: Bearer $auth" -o "$dest.part" "$url"
  else
    curl -L -f -C - -o "$dest.part" "$url"
  fi
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
if [ -z "$TOKEN" ]; then
  echo "Civitai API key missing (CIVITAI_API_TOKEN or Settings). Needed for NOOB-IPA-MARK1." >&2
  exit 1
fi
fetch "ipadapter/NOOB-IPA-MARK1.safetensors" \
  "https://civitai.com/api/download/models/1121145" \
  1405172056 "$TOKEN"
fetch "clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors" \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/image_encoder/model.safetensors" \
  3689912664

echo
echo "IP-Adapter is ready. Restart ComfyUI, then turn on Settings > 베타 기능 >"
echo "캐릭터 기준 시트 and confirm a sheet in the character studio."
