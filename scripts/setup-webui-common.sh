#!/usr/bin/env bash
# Shared provisioner for AUTOMATIC1111 / Forge on macOS/Linux.
# Sourced by setup-a1111.sh and setup-forge.sh.

# provision_webui LABEL REPO_URL GIT_REF TARGET_DIR PORT RUN_SCRIPT
#
# Clones the repo, creates a virtualenv, then installs dependencies by launching
# the WebUI once until its API answers and stopping it again. A1111/Forge clone
# their sub-repositories and pip-install torch during that first run, so there is
# no lighter, version-proof way to fully provision them.
provision_webui() {
  local label="$1" repo="$2" ref="$3" dir="$4" port="$5" run_script="$6"
  local root_dir
  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local log_dir="${LOG_DIR:-$root_dir/.local/logs}"
  mkdir -p "$log_dir"
  local log="$log_dir/setup-$label.log"

  if ! command -v git >/dev/null 2>&1; then
    echo "[$label] git is required but was not found." >&2
    return 1
  fi

  if [ ! -f "$dir/launch.py" ]; then
    echo "[$label] Cloning into $dir ..."
    if [ -n "$ref" ]; then
      git clone --branch "$ref" --depth 1 "$repo" "$dir"
    else
      git clone --depth 1 "$repo" "$dir"
    fi
  else
    echo "[$label] Repository already present at $dir."
  fi

  local py
  if command -v python3.10 >/dev/null 2>&1; then
    py=python3.10
  else
    py=python3
    echo "[$label] WARNING: python3.10 not found; using $(python3 --version 2>&1)." >&2
    echo "[$label] A1111/Forge are most reliable on Python 3.10 (brew install python@3.10)." >&2
  fi

  if [ ! -x "$dir/venv/bin/python" ]; then
    echo "[$label] Creating virtualenv with $py ..."
    "$py" -m venv "$dir/venv"
    "$dir/venv/bin/python" -m pip install --upgrade pip >>"$log" 2>&1 || true
  else
    echo "[$label] Virtualenv already present."
  fi

  if curl -fsS --max-time 5 "http://127.0.0.1:$port/internal/ping" >/dev/null 2>&1; then
    echo "[$label] Something is already serving on port $port; skipping dependency bootstrap."
    return 0
  fi

  echo "[$label] Installing dependencies (first run downloads PyTorch and can take several minutes)."
  echo "[$label] Progress log: $log"
  ( bash "$run_script" ) >>"$log" 2>&1 &
  local pid=$!

  local ready=0 i
  for i in $(seq 1 720); do   # 720 * 5s = up to 60 minutes
    if curl -fsS --max-time 5 "http://127.0.0.1:$port/internal/ping" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "[$label] Launcher exited during install. Last log lines:" >&2
      tail -n 40 "$log" >&2
      return 1
    fi
    sleep 5
  done

  echo "[$label] Stopping bootstrap server..."
  kill "$pid" >/dev/null 2>&1 || true

  local leftover
  leftover="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$leftover" ]; then
    # shellcheck disable=SC2086
    kill $leftover >/dev/null 2>&1 || true
    sleep 1
    leftover="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [ -n "$leftover" ] && kill -KILL $leftover >/dev/null 2>&1 || true
  fi

  if [ "$ready" -ne 1 ]; then
    echo "[$label] Timed out installing dependencies. See $log" >&2
    return 1
  fi

  echo "[$label] Dependencies installed."
}
