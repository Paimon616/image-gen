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

# Locate an existing Homebrew, even if it is not yet on PATH (fresh installs on
# Apple Silicon live in /opt/homebrew, Intel in /usr/local).
brew_bin() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  local candidate
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# Make sure Homebrew is available, offering to install it (system-modifying, so
# it is gated behind an explicit y/N prompt). Loads brew into this shell's PATH.
ensure_homebrew() {
  local brew
  if brew="$(brew_bin)"; then
    eval "$("$brew" shellenv)"
    return 0
  fi

  echo "Homebrew is needed to auto-install the missing tools, but it isn't installed."
  printf "Install Homebrew now? This downloads and runs Homebrew's official installer. [y/N] "
  local reply=""
  read -r reply || true
  case "$reply" in
    y | Y)
      NONINTERACTIVE=1 /bin/bash -c \
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      if brew="$(brew_bin)"; then
        eval "$("$brew" shellenv)"
        return 0
      fi
      echo "Homebrew installation did not complete." >&2
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

# Check the system tools the launcher and setup scripts assume, installing the
# ones Homebrew can provide. curl and lsof ship with macOS, so they are only
# warned about (installing them via brew is unnecessary and error-prone).
ensure_system_deps() {
  command -v curl >/dev/null 2>&1 || echo "Warning: curl not found (unexpected on macOS)." >&2
  command -v lsof >/dev/null 2>&1 || echo "Warning: lsof not found (unexpected on macOS)." >&2

  local missing=()
  command -v git >/dev/null 2>&1 || missing+=("git")
  command -v python3 >/dev/null 2>&1 || missing+=("python")
  # node provides npm, so a single check/install covers both.
  command -v node >/dev/null 2>&1 || missing+=("node")

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  echo "Missing required tools: ${missing[*]}"
  if ! ensure_homebrew; then
    echo "Please install these manually and re-run the launcher: ${missing[*]}" >&2
    exit 1
  fi

  echo "Installing missing tools with Homebrew: ${missing[*]}"
  brew install "${missing[@]}"
}

# macOS is the supported auto-install target; on other platforms fall back to the
# plain require_command checks below so behavior there is unchanged.
if [ "$(uname -s)" = "Darwin" ]; then
  ensure_system_deps
fi

require_command npm
require_command lsof
require_command curl

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Node dependencies are missing. Running npm install..."
  (cd "$ROOT_DIR" && npm install)
fi

# Register the git merge driver once per clone (idempotent). Previously a manual
# `npm run setup:git-merge` step; folded in here so a fresh clone just works.
if ! git -C "$ROOT_DIR" config --local --get merge.model-catalog-json.driver >/dev/null 2>&1; then
  echo "Registering git merge driver..."
  (cd "$ROOT_DIR" && npm run setup:git-merge) || echo "git-merge setup skipped (non-fatal)."
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
# the app can auto-launch them on demand. Set SKIP_WEBUI_SETUP=1 to opt out of
# both. AUTOMATIC1111 is skipped by default here; set INSTALL_A1111=1 to enable.
if [ "${SKIP_WEBUI_SETUP:-0}" != "1" ]; then
  if [ "${INSTALL_A1111:-0}" = "1" ]; then
    if [ ! -f "$A1111_DIR/.image-gen-ready" ] || [ ! -f "$A1111_DIR/extensions/adetailer/scripts/!adetailer.py" ]; then
      echo "AUTOMATIC1111 or ADetailer is not ready. Running setup (first run downloads PyTorch)..."
      (cd "$ROOT_DIR" && npm run setup:a1111)
    fi
  fi

  if [ ! -f "$FORGE_DIR/.image-gen-ready" ] || [ ! -f "$FORGE_DIR/extensions/adetailer/scripts/!adetailer.py" ]; then
    echo "Forge or ADetailer is not ready. Running setup (first run downloads PyTorch)..."
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
