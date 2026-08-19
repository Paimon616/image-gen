#!/usr/bin/env bash
set -euo pipefail

# Provisions everything the "Censor (auto-mosaic)" video feature needs on the local
# ComfyUI:
#   1. The ComfyUI-Nudenet custom node (pinned in comfyui-config/custom-nodes.json)
#      — provides ApplyNudenet / NudenetModelLoader / FilterdLabel, wired in-graph by
#      injectCensorNodes() in src/lib/comfyui.ts.
#   2. The ComfyUI-segment-anything-2 node (installed for a future SAM2 precise-mask
#      pass; its SAM2 checkpoints auto-download on first use, so nothing is fetched
#      here).
#   3. The NudeNet ONNX detector (nudenet.onnx, ~25 MB) into models/Nudenet/, which
#      NudenetModelLoader lists and loads.
#
# Idempotent: re-running skips the node clones if present and skips the model if it
# already exists at a plausible size. For a RunPod pod, run this on the pod (or set
# COMFYUI_DIR / COMFYUI_MODELS_DIR to point at the pod's ComfyUI checkout).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
MODELS_DIR="${COMFYUI_MODELS_DIR:-$COMFYUI_DIR/models}"
NUDENET_DIR="$MODELS_DIR/Nudenet"

# The default detector NudenetModelLoader expects. Override the filename the workflow
# references with COMFYUI_NUDENET_MODEL if you place a different ONNX here.
MODEL_NAME="${COMFYUI_NUDENET_MODEL:-nudenet.onnx}"
MODEL_URL="https://d2xl8ijk56kv4u.cloudfront.net/models/nudenet.onnx"
# Sanity gate so a truncated/HTML-error download is re-fetched, not kept.
MODEL_MIN_BYTES=1000000

echo "==> Installing the censor custom nodes via the ComfyUI config provisioner..."
bash "$ROOT_DIR/scripts/setup-comfyui-config.sh" "$@"

echo
echo "==> Fetching the NudeNet ONNX detector ($MODEL_NAME)..."
mkdir -p "$NUDENET_DIR"
dest="$NUDENET_DIR/$MODEL_NAME"

file_big_enough() {
  # Portable stat: try GNU (-c%s) then BSD/macOS (-f%z).
  local size
  size="$(stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0)"
  [ "${size:-0}" -ge "$MODEL_MIN_BYTES" ]
}

if [ -f "$dest" ] && file_big_enough "$dest"; then
  echo "Already present: $dest (skipping download)."
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download the NudeNet detector." >&2
    echo "Download it manually into: $NUDENET_DIR/$MODEL_NAME" >&2
    echo "  $MODEL_URL" >&2
    exit 1
  fi
  tmp="$dest.part"
  # -L follow redirects, -C - resume a partial .part file, -f fail on HTTP errors.
  curl -L -f -C - -o "$tmp" "$MODEL_URL"
  if ! file_big_enough "$tmp"; then
    echo "Downloaded file is smaller than expected — treating as failed." >&2
    echo "Leaving $tmp in place so you can resume with the same command." >&2
    exit 1
  fi
  mv "$tmp" "$dest"
  echo "Saved: $dest"
fi

echo
echo "Censoring is ready. Restart ComfyUI so the nodes load, then enable"
echo "\"Censor (auto-mosaic)\" in the video generator. If you use a different"
echo "detector filename, set COMFYUI_NUDENET_MODEL to match."
