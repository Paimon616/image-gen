#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.local/logs}"

IMAGE_GEN_HOST="${IMAGE_GEN_HOST:-127.0.0.1}"
IMAGE_GEN_PORT="${IMAGE_GEN_PORT:-3000}"
IMAGE_GEN_URL="${IMAGE_GEN_URL:-http://localhost:$IMAGE_GEN_PORT}"

COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"

STARTED_PIDS=()

cleanup() {
  if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
    echo
    echo "Stopping local servers..."
    kill "${STARTED_PIDS[@]}" 2>/dev/null || true
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

  if port_listening "$port"; then
    echo "$name already appears to be running on port $port."
    return 0
  fi

  echo "Starting $name..."
  (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_file" 2>&1 &

  local pid="$!"
  STARTED_PIDS+=("$pid")
  wait_for_port "$name" "$port" "$pid" "$log_file"
}

require_command npm
require_command lsof

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Node dependencies are missing. Run: npm install" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
export COMFYUI_HOST
export COMFYUI_PORT

start_service "ComfyUI" "$COMFYUI_PORT" "$LOG_DIR/comfyui.log" npm run comfyui

start_service "Image Gen" "$IMAGE_GEN_PORT" "$LOG_DIR/image-gen.log" \
  npm run dev -- --hostname "$IMAGE_GEN_HOST" --port "$IMAGE_GEN_PORT"

echo "Opening $IMAGE_GEN_URL"
open_url "$IMAGE_GEN_URL"

if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
  echo
  echo "Servers are running. Keep this window open; press Ctrl-C to stop servers started by this launcher."
  wait "${STARTED_PIDS[@]}"
fi
