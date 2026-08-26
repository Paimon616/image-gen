#!/bin/bash
#
# MiniMax H3 (DaSiWa MythicAlchemy) pod bootstrap — pairs with the
# `dasiwa-minimax-h3-i2va` video pipeline (workflows/dasiwa-minimax-h3-i2va.json).
#
# The onechat_ltx25 pods have NO network volume: a pod stop/start resets
# /workspace to the container image (ComfyUI 0.26.2, no models). Re-run this
# script on the pod after every restart. It is idempotent — finished downloads
# and installs are skipped, so a re-run on a healthy pod is fast.
#
# Usage (from this repo):
#   scp -P <ssh-port> scripts/setup-minimax-h3-pod.sh root@<pod-ip>:/workspace/
#   ssh -p <ssh-port> root@<pod-ip> 'bash /workspace/setup-minimax-h3-pod.sh'
#
# What it does:
#   1. Downloads the 8 model files (HF mirrors; aria2 16-way for the big ones)
#   2. Upgrades ComfyUI to v0.34.0 (MiniMax H3 needs >= 0.30.0)
#   3. Installs ComfyUI-DaSiWa-Nodes
#   4. Restarts ComfyUI and verifies the DaSiWa nodes are live
set -uo pipefail
C="${COMFY_DIR:-/workspace/runpod-slim/ComfyUI}"
M="$C/models"
COMFY_REF="${COMFY_REF:-v0.34.0}"
step(){ echo "[$(date +%H:%M:%S)] $*"; }

mkdir -p "$M/diffusion_models" "$M/text_encoders" "$M/vae/MiniMaxH3" "$M/vae_approx" "$M/loras"

if ! command -v aria2c >/dev/null 2>&1; then
  step "installing aria2"
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq aria2 >/dev/null 2>&1
fi

FAILED=0
# big files: aria2 16-way with resume (-c); .aria2 control file marks unfinished
dl_big(){ # dl_big <dest> <url>
  if [ -f "$1" ] && [ ! -f "$1.aria2" ]; then step "SKIP $(basename "$1") (already complete)"; return; fi
  if aria2c -x16 -s16 -c --console-log-level=warn --summary-interval=0 \
      -d "$(dirname "$1")" -o "$(basename "$1")" "$2"; then
    step "DONE $(basename "$1") ($(du -h "$1" | cut -f1))"
  else
    step "FAIL $(basename "$1")"; FAILED=1
  fi
}
dl_small(){ # dl_small <dest> <url>
  if wget -q -c -O "$1" "$2"; then step "DONE $(basename "$1") ($(du -h "$1" | cut -f1))"
  else step "FAIL $(basename "$1")"; FAILED=1; fi
}

step "downloads: start"
dl_small "$M/vae_approx/taeh3.safetensors" "https://huggingface.co/Kijai/MiniMax-H3-TAE/resolve/main/vae_approx/taeh3.safetensors" &
dl_small "$M/loras/MysticXXX_MMH3-V3.safetensors" "https://huggingface.co/Kutches/minmax/resolve/main/MysticXXX_MMH3-V3.safetensors" &
# lightx2v turbo distill LoRAs (optional, enabled via the pipeline's Turbo LoRA control)
dl_small "$M/loras/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors" "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors" &
dl_small "$M/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors" "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors" &
dl_small "$M/vae/MiniMaxH3/minimax_h3_audio_vae_fp32.safetensors" "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors" &
dl_big "$M/vae/MiniMaxH3/minimax_h3_video_vae_fp16.safetensors" "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors"
dl_big "$M/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
dl_big "$M/diffusion_models/DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors" "https://huggingface.co/yamanakaaa2015/mymodel/resolve/main/MiniMax/DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors"

step "comfyui: checkout $COMFY_REF"
cd "$C"
git fetch --tags origin >/dev/null 2>&1
git -c advice.detachedHead=false checkout "$COMFY_REF" 2>&1 | tail -1
step "comfyui: pip install requirements"
python3 -m pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]" | tail -3

step "custom_nodes: ComfyUI-DaSiWa-Nodes"
cd "$C/custom_nodes"
if [ ! -d ComfyUI-DaSiWa-Nodes ]; then
  git clone -q https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes.git
fi
if [ -f ComfyUI-DaSiWa-Nodes/requirements.txt ]; then
  python3 -m pip install -q -r ComfyUI-DaSiWa-Nodes/requirements.txt 2>&1 | grep -v "^\[notice\]" | tail -3
fi

step "waiting for downloads..."
wait
if [ "$FAILED" -ne 0 ]; then step "ERROR: one or more downloads failed — fix and re-run (resume is supported)"; exit 1; fi
step "downloads: all finished"

step "restart comfyui"
PID=$(pgrep -f "main.py --listen" | head -1)
[ -n "${PID:-}" ] && kill "$PID" && sleep 5
cd "$C"
nohup python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header > /workspace/comfyui.log 2>&1 &
step "comfyui restarted (pid $!)"

for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then step "comfyui is up"; break; fi
  sleep 3
done
curl -s http://127.0.0.1:8188/system_stats | python3 -c "import json,sys; print('version:', json.load(sys.stdin)['system']['comfyui_version'])"
DASIWA_BYTES=$(curl -s "http://127.0.0.1:8188/object_info/DaSiWa_EnhancedVideoCombine" | wc -c)
if [ "$DASIWA_BYTES" -gt 10 ]; then step "DaSiWa nodes: OK"; else step "ERROR: DaSiWa nodes did not load — check /workspace/comfyui.log"; exit 1; fi
step "ALL DONE"
