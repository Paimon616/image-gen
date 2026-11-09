#!/usr/bin/env bash
# Installs the image-generation model set on an Apple Silicon Mac
# (used by install-local-models-mac.command). Mac version of
# scripts/install-local-models.ps1 with the same groups:
#
#   image  Hassaku XL (Illustrious) + Detailer IL / Eye Enhancer / HandPatch LoRA,
#          PuLID + InsightFace antelopev2, ADetailer face bbox
#   krea2  Krea2 Turbo bf16 + Qwen3-VL 4B bf16 encoder + Identity Edit LoRA +
#          Refusal-Reduction LoRA, Qwen-Image VAE, node comfyui-krea2edit
#
# Apple Silicon (MPS) cannot load fp8 weights, so Krea2 and its encoder are the
# bf16 builds (larger: about 26 GB + 9 GB). The script also sets
# KREA2_CLIP_NAME=qwen3vl_4b_bf16.safetensors in .env.local so the app uses it.
# Video groups (h3 / wan) are not offered: those models need an NVIDIA GPU.
#
# Usage:
#   ./scripts/install-local-models-mac.sh                 (image + krea2, about 43 GB)
#   MODEL_GROUPS="image" ./scripts/install-local-models-mac.sh
#   ONLY=identity_edit ./scripts/install-local-models-mac.sh
#   LIST=1 ./scripts/install-local-models-mac.sh
#
# Civitai files need CIVITAI_API_TOKEN (environment or .env.local). Downloads
# resume after a drop and files with the right size are skipped.
set -o pipefail   # no -u: macOS bash 3.2 treats an empty array as unbound

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
MODELS_DIR="${MODELS_DIR:-$COMFYUI_DIR/models}"
MODEL_GROUPS="${MODEL_GROUPS:-image krea2}"
MODEL_GROUPS="${MODEL_GROUPS//,/ }"
ONLY="${ONLY:-}"
LIST="${LIST:-}"
ENV_FILE="$ROOT_DIR/.env.local"

HF="https://huggingface.co"
CIVITAI="https://civitai.com/api/download/models"

# group|destination (relative to models/)|url|expected bytes ("" = size unknown)
MODELS="
image|checkpoints/hassakuXLIllustrious_v22.safetensors|$CIVITAI/1697082|6938040456
image|loras/DetailerILv2-000008.safetensors|$CIVITAI/1736373|228465628
image|loras/Eye_Enhancer.safetensors|$CIVITAI/1959770|57426116
image|loras/handPatchUnet4Merge.safetensors|$CIVITAI/1358586|681230068
image|pulid/ip-adapter_pulid_sdxl_fp16.safetensors|$HF/huchenlei/ipadapter_pulid/resolve/main/ip-adapter_pulid_sdxl_fp16.safetensors|791372856
image|insightface/models/antelopev2/1k3d68.onnx|$HF/DIAMONIK7777/antelopev2/resolve/main/1k3d68.onnx|143607619
image|insightface/models/antelopev2/2d106det.onnx|$HF/DIAMONIK7777/antelopev2/resolve/main/2d106det.onnx|5030888
image|insightface/models/antelopev2/genderage.onnx|$HF/DIAMONIK7777/antelopev2/resolve/main/genderage.onnx|1322532
image|insightface/models/antelopev2/glintr100.onnx|$HF/DIAMONIK7777/antelopev2/resolve/main/glintr100.onnx|260665334
image|insightface/models/antelopev2/scrfd_10g_bnkps.onnx|$HF/DIAMONIK7777/antelopev2/resolve/main/scrfd_10g_bnkps.onnx|16923827
image|ultralytics/bbox/face_yolov8n_v2.pt|$HF/Bingsu/adetailer/resolve/main/face_yolov8n_v2.pt|6239036
krea2|diffusion_models/krea2_turbo_bf16.safetensors|$HF/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_bf16.safetensors|26283332608
krea2|text_encoders/qwen3vl_4b_bf16.safetensors|$HF/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_bf16.safetensors|8875719384
krea2|vae/qwen_image_vae.safetensors|$HF/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors|253806246
krea2|loras/krea2_identity_edit_v1_2.safetensors|$CIVITAI/3139172|1828256432
krea2|loras/Capitan01R_Krea2_TextFusion_Refusal_Reduction_v2_updated.safetensors|$CIVITAI/3416236|30354320
"

# group|name|repo|pinned commit
NODES="
krea2|comfyui-krea2edit|https://github.com/lbouaraba/comfyui-krea2edit.git|13ef60f
"

in_groups() { case " $MODEL_GROUPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
human() { awk -v b="${1:-0}" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b/1073741824; else printf "%.0f MB", b/1048576 }'; }
file_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0; }

selected() {
  echo "$MODELS" | while IFS='|' read -r group dest url size; do
    [ -z "$group" ] && continue
    in_groups "$group" || continue
    if [ -n "$ONLY" ] && [[ "$dest" != *"$ONLY"* ]]; then continue; fi
    echo "$group|$dest|$url|$size"
  done
}

if [ -n "$LIST" ]; then
  selected | while IFS='|' read -r group dest url size; do
    if [ -n "$size" ]; then s="$(human "$size")"; else s="?"; fi
    printf "%-6s %10s  %s\n" "$group" "$s" "$dest"
  done
  echo "$NODES" | while IFS='|' read -r group name repo commit; do
    [ -n "$group" ] && in_groups "$group" && printf "node   %10s  custom_nodes/%s\n" "" "$name"
  done
  total=0
  while IFS='|' read -r group dest url size; do total=$((total + ${size:-0})); done < <(selected)
  echo "Total: $(human "$total")"
  exit 0
fi

if [ ! -f "$COMFYUI_DIR/main.py" ]; then
  echo "ComfyUI not found at $COMFYUI_DIR. Double-click setup-comfyui-mac.command first." >&2
  exit 1
fi

TOKEN="${CIVITAI_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$ENV_FILE" ]; then
  TOKEN="$(grep -E '^[[:space:]]*CIVITAI_API_TOKEN[[:space:]]*=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"' \r")"
fi
[ -z "$TOKEN" ] && echo "Warning: CIVITAI_API_TOKEN is not set (.env.local or environment). Civitai files will be skipped." >&2

FAILED=()
LIST_FILE="$(mktemp)"
selected > "$LIST_FILE"
TOTAL=$(wc -l < "$LIST_FILE" | tr -d ' ')
i=0
echo "Models dir: $MODELS_DIR"
echo "Groups: $MODEL_GROUPS  |  $TOTAL files"

while IFS='|' read -r group dest url size; do
  i=$((i + 1))
  target="$MODELS_DIR/$dest"
  label="[$i/$TOTAL] $dest"
  [ -n "$size" ] && label="$label ($(human "$size"))"

  if [ -f "$target" ]; then
    have="$(file_size "$target")"
    if [ -z "$size" ] || [ "$have" = "$size" ]; then echo "$label - already installed"; continue; fi
  fi

  auth=()
  if [[ "$url" == "$CIVITAI"* ]]; then
    if [ -z "$TOKEN" ]; then echo "$label - skipped (no Civitai token)" >&2; FAILED+=("$dest"); continue; fi
    auth=(-H "Authorization: Bearer $TOKEN")
  fi

  mkdir -p "$(dirname "$target")"
  echo "$label"
  ok=""
  for attempt in $(seq 1 20); do
    # CURL_OPTS: extra curl options for unusual networks (e.g. a proxy).
    # shellcheck disable=SC2086
    curl -L --fail --retry 5 --retry-delay 5 --connect-timeout 30 -C - -o "$target.part" ${CURL_OPTS:-} "${auth[@]}" "$url"
    rc=$?
    have="$(file_size "$target.part")"
    if [ "$rc" = 0 ] && { [ -z "$size" ] || [ "$have" -ge "$size" ]; }; then ok=1; break; fi
    if [ -n "$size" ] && [ "$have" -ge "$size" ]; then ok=1; break; fi
    [ "$rc" = 22 ] && break   # HTTP error (bad token / missing file): retrying will not help
    echo "  retrying ($attempt)..."
    sleep 3
  done
  if [ -n "$ok" ]; then mv -f "$target.part" "$target"; echo "  done"; else echo "  failed: $url" >&2; FAILED+=("$dest"); fi
done < "$LIST_FILE"
rm -f "$LIST_FILE"

PY="$COMFYUI_DIR/venv/bin/python"
echo "$NODES" | while IFS='|' read -r group name repo commit; do
  [ -z "$group" ] && continue
  in_groups "$group" || continue
  [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]] && continue
  dir="$COMFYUI_DIR/custom_nodes/$name"
  echo "Node: $name"
  [ -d "$dir/.git" ] || git clone "$repo" "$dir" || { echo "  clone failed" >&2; continue; }
  git -C "$dir" fetch --quiet origin || true
  git -C "$dir" checkout --quiet "$commit" || echo "  could not check out $commit; keeping the current version" >&2
  if [ -f "$dir/requirements.txt" ]; then
    grep -v '^[[:space:]]*llama-cpp-python' "$dir/requirements.txt" > "$dir/.requirements-mac.txt"
    "$PY" -m pip install -r "$dir/.requirements-mac.txt" || echo "  pip install failed for $name" >&2
  fi
done

# Point the app at the bf16 Krea2 encoder (fp8 does not load on Apple Silicon).
if in_groups krea2; then
  touch "$ENV_FILE"
  if grep -qE '^[[:space:]]*KREA2_CLIP_NAME[[:space:]]*=' "$ENV_FILE"; then
    sed -i '' -E 's|^[[:space:]]*KREA2_CLIP_NAME[[:space:]]*=.*|KREA2_CLIP_NAME=qwen3vl_4b_bf16.safetensors|' "$ENV_FILE"
  else
    printf '\nKREA2_CLIP_NAME=qwen3vl_4b_bf16.safetensors\n' >> "$ENV_FILE"
  fi
  echo "Set KREA2_CLIP_NAME=qwen3vl_4b_bf16.safetensors in .env.local (restart the app to apply)."
fi

echo
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "Not installed (${#FAILED[@]}):" >&2
  printf '  %s\n' "${FAILED[@]}" >&2
  echo "Run it again to resume." >&2
  exit 1
fi
cat <<'EOF'
All done. Restart ComfyUI so it picks up the new models and nodes.
In the app, pick "krea2_turbo_bf16" as the Krea2 model (the fp8 build does not run on a Mac).
PuLID also downloads EVA02-CLIP (about 800 MB) to the Hugging Face cache the first time it runs.
EOF
