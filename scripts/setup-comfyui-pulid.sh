#!/usr/bin/env bash
set -euo pipefail

# Provisions everything the "Character Reference" (PuLID identity) feature needs
# on the local ComfyUI:
#   1. The PuLID_ComfyUI custom node (pinned in comfyui-config/custom-nodes.json)
#      and its Python deps (insightface, facexlib, onnxruntime, timm) — installed
#      by the shared config provisioner.
#   2. The SDXL PuLID weight (pulid_v1.1.safetensors, ~939 MB) into models/pulid/.
#      EVA-CLIP and the InsightFace antelopev2 models are fetched automatically by
#      the node on first run, so only this one weight is downloaded here.
#
# Idempotent: re-running skips the node clone if present and skips the weight if it
# already exists at the expected size. For a RunPod pod, run this on the pod (or set
# COMFYUI_DIR / COMFYUI_MODELS_DIR to point at the pod's ComfyUI checkout).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
MODELS_DIR="${COMFYUI_MODELS_DIR:-$COMFYUI_DIR/models}"
PULID_DIR="$MODELS_DIR/pulid"

# The image_proj/ip_adapter-structured SDXL weight cubiq PuLID_ComfyUI loads.
# (NOT guozinan's pulid_v1.1.safetensors, whose id_adapter layout fails to load.)
WEIGHT_NAME="ip-adapter_pulid_sdxl_fp16.safetensors"
WEIGHT_URL="https://huggingface.co/huchenlei/ipadapter_pulid/resolve/main/${WEIGHT_NAME}?download=true"
# Sanity gate (~791MB file) so a truncated download is re-fetched, not kept.
WEIGHT_MIN_BYTES=700000000

echo "==> Installing the PuLID custom node via the ComfyUI config provisioner..."
bash "$ROOT_DIR/scripts/setup-comfyui-config.sh" "$@"

echo
echo "==> Fetching the SDXL PuLID weight ($WEIGHT_NAME)..."
mkdir -p "$PULID_DIR"
dest="$PULID_DIR/$WEIGHT_NAME"

file_big_enough() {
  # Portable stat: try GNU (-c%s) then BSD/macOS (-f%z).
  local size
  size="$(stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0)"
  [ "${size:-0}" -ge "$WEIGHT_MIN_BYTES" ]
}

if [ -f "$dest" ] && file_big_enough "$dest"; then
  echo "Already present: $dest (skipping download)."
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download the PuLID weight." >&2
    echo "Download it manually into: $PULID_DIR/$WEIGHT_NAME" >&2
    echo "  $WEIGHT_URL" >&2
    exit 1
  fi
  tmp="$dest.part"
  # -L follow redirects (HF -> CDN), -C - resume a partial .part file, -f fail on HTTP errors.
  curl -L -f -C - -o "$tmp" "$WEIGHT_URL"
  if ! file_big_enough "$tmp"; then
    echo "Downloaded file is smaller than expected — treating as failed." >&2
    echo "Leaving $tmp in place so you can resume with the same command." >&2
    exit 1
  fi
  mv "$tmp" "$dest"
  echo "Saved: $dest"
fi

echo
echo "==> Fetching the InsightFace antelopev2 face models..."
# PulidInsightFaceLoader runs FaceAnalysis(name="antelopev2"), which resolves under
# <models>/insightface/models/antelopev2/. InsightFace's own auto-download is flaky,
# so place the five ONNX files explicitly.
ANTELOPE_DIR="$MODELS_DIR/insightface/models/antelopev2"
ANTELOPE_BASE="https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main"
mkdir -p "$ANTELOPE_DIR"
for f in 1k3d68.onnx 2d106det.onnx genderage.onnx glintr100.onnx scrfd_10g_bnkps.onnx; do
  onnx_dest="$ANTELOPE_DIR/$f"
  onnx_size="$(stat -c%s "$onnx_dest" 2>/dev/null || stat -f%z "$onnx_dest" 2>/dev/null || echo 0)"
  if [ -f "$onnx_dest" ] && [ "${onnx_size:-0}" -gt 100000 ]; then
    echo "  already present: $f"
  elif command -v curl >/dev/null 2>&1; then
    echo "  downloading $f..."
    curl -L -f -o "$onnx_dest.part" "$ANTELOPE_BASE/$f?download=true"
    mv "$onnx_dest.part" "$onnx_dest"
  else
    echo "  curl missing — download $ANTELOPE_BASE/$f into $ANTELOPE_DIR/ manually." >&2
  fi
done

echo
echo "PuLID is ready. Restart ComfyUI so the node loads, then set a Character"
echo "Reference image in the generator (SDXL/Illustrious checkpoints)."
