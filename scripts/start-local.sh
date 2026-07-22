#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.local/logs}"

IMAGE_GEN_HOST="${IMAGE_GEN_HOST:-127.0.0.1}"
IMAGE_GEN_PORT="${IMAGE_GEN_PORT:-5353}"
IMAGE_GEN_URL="${IMAGE_GEN_URL:-http://$IMAGE_GEN_HOST:$IMAGE_GEN_PORT}"

COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
LORA_RUNNER_DIR="${LORA_RUNNER_DIR:-$ROOT_DIR/runners/sd-scripts}"

A1111_DIR="${A1111_DIR:-$ROOT_DIR/stable-diffusion-webui}"
FORGE_DIR="${FORGE_DIR:-$ROOT_DIR/stable-diffusion-webui-forge}"

STARTED_PIDS=()
CLEANED_UP=0

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1

  if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
    echo
    echo "Stopping local servers..."
    kill "${STARTED_PIDS[@]}" 2>/dev/null || true
    for pid in "${STARTED_PIDS[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        sleep 1
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  fi
}

trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

port_pids() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true
}

# Kill anything currently listening on the given port. Tries SIGTERM first,
# waits briefly, then escalates to SIGKILL. Returns 0 only when the port is
# finally free (or was already free).
kill_port() {
  local port="$1"
  local label="${2:-}"
  local pids
  local still

  pids="$(port_pids "$port")"
  if [ -z "$pids" ]; then
    return 0
  fi

  if [ -n "$label" ]; then
    echo "Stopping existing $label process(es) on port $port (PIDs: $(echo "$pids" | tr '\n' ' '))..."
  else
    echo "Stopping existing process(es) on port $port (PIDs: $(echo "$pids" | tr '\n' ' '))..."
  fi

  kill -TERM $pids 2>/dev/null || true

  for _ in $(seq 1 40); do
    still="$(port_pids "$port")"
    if [ -z "$still" ]; then
      return 0
    fi
    sleep 0.25
  done

  still="$(port_pids "$port")"
  if [ -n "$still" ]; then
    echo "Port $port did not stop after SIGTERM; force killing (PIDs: $(echo "$still" | tr '\n' ' '))..." >&2
    kill -KILL $still 2>/dev/null || true
    for _ in $(seq 1 20); do
      still="$(port_pids "$port")"
      if [ -z "$still" ]; then
        return 0
      fi
      sleep 0.25
    done
  fi

  if [ -n "$(port_pids "$port")" ]; then
    echo "ERROR: could not free port $port; something is still listening there." >&2
    echo "  Run: lsof -nP -iTCP:$port -sTCP:LISTEN" >&2
    return 1
  fi
  return 0
}

# Also sweep stray next-server / python ComfyUI processes that may not be
# holding the configured port anymore (e.g. crashed children). We only target
# processes whose listening socket is one of our configured ports, to stay
# surgical.
kill_managed_ports() {
  kill_port "$COMFYUI_PORT" "ComfyUI" || exit 1
  kill_port "$IMAGE_GEN_PORT" "Image Gen" || exit 1
}

wait_for_port() {
  local name="$1"
  local port="$2"
  local pid="${3:-}"
  local log_file="${4:-}"

  for _ in $(seq 1 120); do
    if port_listening "$port"; then
      if [ -n "$pid" ]; then
        sleep 2
        if ! kill -0 "$pid" >/dev/null 2>&1; then
          echo "$name stopped after opening port $port." >&2
          if [ -n "$log_file" ] && [ -f "$log_file" ]; then
            echo "Last log lines from $log_file:" >&2
            tail -n 40 "$log_file" >&2
          fi
          exit 1
        fi
      fi
      echo "$name is ready on port $port."
      return 0
    fi

    if [ -n "$pid" ] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name stopped before port $port became ready." >&2
      if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo "Last log lines from $log_file:" >&2
        tail -n 40 "$log_file" >&2
      fi
      exit 1
    fi

    sleep 1
  done

  echo "Timed out waiting for $name on port $port." >&2
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    echo "Last log lines from $log_file:" >&2
    tail -n 40 "$log_file" >&2
  fi
  exit 1
}

open_url() {
  local url="$1"

  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  else
    echo "Open this URL in your browser: $url"
  fi
}

start_service() {
  local name="$1"
  local port="$2"
  local log_file="$3"
  shift 3

  # Always start fresh. Any lingering process on this port should already have
  # been killed earlier, but double-check and clean again just in case something
  # grabbed it between sweeps.
  if port_listening "$port"; then
    echo "$name port $port is unexpectedly busy; cleaning up before launch..."
    kill_port "$port" "$name" || exit 1
  fi

  : >"$log_file"

  echo "Starting $name..."
  (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_file" 2>&1 &

  local pid="$!"
  STARTED_PIDS+=("$pid")
  wait_for_port "$name" "$port" "$pid" "$log_file"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local pid="${3:-}"
  local log_file="${4:-}"
  local attempt

  for attempt in $(seq 1 120); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "$name is responding at $url."
      return 0
    fi

    if [ -n "$pid" ] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name stopped before $url responded." >&2
      if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo "Last log lines from $log_file:" >&2
        tail -n 60 "$log_file" >&2
      fi
      exit 1
    fi

    if [ $((attempt % 10)) -eq 0 ]; then
      echo "Still waiting for $name to respond at $url..."
    fi

    sleep 1
  done

  echo "Timed out waiting for $name at $url." >&2
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    echo "Last log lines from $log_file:" >&2
    tail -n 60 "$log_file" >&2
  fi
  exit 1
}

build_image_gen() {
  echo "Building Image Gen for local launch..."
  (
    cd "$ROOT_DIR"
    npm run build
  )
}

start_image_gen() {
  local log_file="$LOG_DIR/image-gen.log"

  # Make sure nothing is squatting the Image Gen port before launch.
  kill_port "$IMAGE_GEN_PORT" "Image Gen" || exit 1

  : >"$log_file"

  echo "Starting Image Gen server..."
  (
    cd "$ROOT_DIR"
    npm run start -- --hostname "$IMAGE_GEN_HOST" --port "$IMAGE_GEN_PORT"
  ) >"$log_file" 2>&1 &

  local pid="$!"
  STARTED_PIDS+=("$pid")
  wait_for_port "Image Gen" "$IMAGE_GEN_PORT" "$pid" "$log_file"
  wait_for_http "Image Gen" "$IMAGE_GEN_URL" "$pid" "$log_file"
}

require_command npm
require_command lsof
require_command curl

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Node dependencies are missing. Running npm install..."
  (cd "$ROOT_DIR" && npm install)
fi

mkdir -p "$LOG_DIR"
export COMFYUI_HOST
export COMFYUI_PORT
export COMFYUI_DIR
export LORA_RUNNER_DIR
export A1111_DIR
export FORGE_DIR

if [ ! -f "$COMFYUI_DIR/main.py" ] || [ ! -x "$COMFYUI_DIR/venv/bin/python" ]; then
  echo "ComfyUI is missing. Running setup..."
  (cd "$ROOT_DIR" && npm run setup:comfyui)
fi

if [ ! -f "$LORA_RUNNER_DIR/sdxl_train_network.py" ] || [ ! -x "$LORA_RUNNER_DIR/.venv/bin/python" ]; then
  echo "LoRA runner is missing. Running setup..."
  (cd "$ROOT_DIR" && npm run setup:lora-runner)
fi

# AUTOMATIC1111 / Forge are optional WebUI backends. Install them if missing so
# the app can auto-launch them on demand. Set SKIP_WEBUI_SETUP=1 to opt out.
if [ "${SKIP_WEBUI_SETUP:-0}" != "1" ]; then
  if [ ! -f "$A1111_DIR/launch.py" ] || [ ! -x "$A1111_DIR/venv/bin/python" ]; then
    echo "AUTOMATIC1111 is missing. Running setup (first run downloads PyTorch)..."
    (cd "$ROOT_DIR" && npm run setup:a1111)
  fi

  if [ ! -f "$FORGE_DIR/launch.py" ] || [ ! -x "$FORGE_DIR/venv/bin/python" ]; then
    echo "Forge is missing. Running setup (first run downloads PyTorch)..."
    (cd "$ROOT_DIR" && npm run setup:forge)
  fi
fi

# --- Fresh start: clean any leftover processes on our managed ports. ---
echo "Cleaning up any previous local instances..."
kill_managed_ports

# Truncate old logs so the current run is easy to read.
: >"$LOG_DIR/comfyui.log" 2>/dev/null || true
: >"$LOG_DIR/image-gen.log" 2>/dev/null || true

build_image_gen

start_service "ComfyUI" "$COMFYUI_PORT" "$LOG_DIR/comfyui.log" npm run comfyui

# Re-sweep the Image Gen port right before launch in case anything grabbed it
# during the ComfyUI startup wait.
kill_port "$IMAGE_GEN_PORT" "Image Gen" || exit 1

start_image_gen

echo "Opening $IMAGE_GEN_URL"
open_url "$IMAGE_GEN_URL"

if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
  echo
  echo "Servers are running. Keep this window open; press Ctrl-C to stop servers started by this launcher."
  wait "${STARTED_PIDS[@]}"
fi
