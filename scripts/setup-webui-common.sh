#!/usr/bin/env bash
# Shared provisioner for AUTOMATIC1111 / Forge on macOS/Linux.
# Sourced by setup-a1111.sh and setup-forge.sh.

# Resolve a Python 3.10 interpreter, installing it via Homebrew when missing.
# Echoes the interpreter path on success; returns non-zero otherwise.
resolve_python310() {
  if command -v python3.10 >/dev/null 2>&1; then
    command -v python3.10
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    echo "[setup] Installing Python 3.10 via Homebrew..." >&2
    brew install python@3.10 >&2 || true
    local brew_py
    brew_py="$(brew --prefix python@3.10 2>/dev/null)/bin/python3.10"
    if [ -x "$brew_py" ]; then
      echo "$brew_py"
      return 0
    fi
    if command -v python3.10 >/dev/null 2>&1; then
      command -v python3.10
      return 0
    fi
  fi

  return 1
}

# provision_webui LABEL REPO_URL GIT_REF TARGET_DIR PORT RUN_SCRIPT
provision_webui() {
  local label="$1" repo="$2" ref="$3" dir="$4" port="$5" run_script="$6"
  local root_dir
  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local log_dir="${LOG_DIR:-$root_dir/.local/logs}"
  mkdir -p "$log_dir"
  local log="$log_dir/setup-$label.log"
  : >"$log"

  if ! command -v git >/dev/null 2>&1; then
    echo "[$label] git is required but was not found." >&2
    return 1
  fi

  local py
  if ! py="$(resolve_python310)"; then
    echo "[$label] Python 3.10 is required and could not be installed automatically." >&2
    echo "[$label] Install it (e.g. 'brew install python@3.10') and re-run: npm run setup:$label" >&2
    return 1
  fi
  echo "[$label] Using Python: $py ($("$py" --version 2>&1))"

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

  # Recreate the virtualenv if it is missing or built with the wrong Python.
  local venv_py="$dir/venv/bin/python"
  if [ -x "$venv_py" ]; then
    local ver
    ver="$("$venv_py" -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || echo "")"
    if [ "$ver" != "3.10" ]; then
      echo "[$label] Existing venv is Python ${ver:-unknown}; recreating with 3.10..."
      rm -rf "$dir/venv"
    fi
  fi
  if [ ! -x "$venv_py" ]; then
    echo "[$label] Creating virtualenv..."
    "$py" -m venv "$dir/venv"
  fi

  echo "[$label] Preparing build tools..."
  # setuptools<81 keeps pkg_resources available, which the pinned OpenAI CLIP
  # needs at build time; without this the dependency install fails.
  "$venv_py" -m pip install --upgrade pip >>"$log" 2>&1 || true
  "$venv_py" -m pip install "setuptools<81" wheel >>"$log" 2>&1 || true

  # Pre-install OpenAI CLIP with build isolation disabled so it builds against
  # our pinned setuptools instead of pip's fresh (too-new) overlay. A1111/Forge
  # skip their own CLIP step once the module imports.
  if ! "$venv_py" -c "import clip" >/dev/null 2>&1; then
    echo "[$label] Pre-installing OpenAI CLIP..."
    "$venv_py" -m pip install ftfy regex tqdm >>"$log" 2>&1 || true
    "$venv_py" -m pip install --no-build-isolation \
      "clip @ git+https://github.com/openai/CLIP.git@d50d76daa670286dd6cacf3bcd80b5e4823fc8e1" \
      >>"$log" 2>&1 ||
      echo "[$label] CLIP pre-install failed; the WebUI will retry on launch (see $log)." >&2
  fi

  # ADetailer is a WebUI extension, not a built-in script. Without it the API
  # rejects generations that request it ("Script 'ADetailer' not found").
  local ext_dir="$dir/extensions/adetailer"
  if [ ! -d "$ext_dir/.git" ]; then
    if [ -e "$ext_dir" ] && [ -n "$(ls -A "$ext_dir" 2>/dev/null)" ]; then
      echo "[$label] ADetailer directory exists but is not a git checkout: $ext_dir" >&2
      return 1
    fi
    echo "[$label] Installing ADetailer extension..."
    if ! git clone --depth 1 https://github.com/Bing-su/adetailer.git "$ext_dir" >>"$log" 2>&1; then
      echo "[$label] ADetailer clone failed (see $log)." >&2
      return 1
    fi
  fi

  # ADetailer's install.py reinstalls the LATEST ultralytics/mediapipe on every
  # launch, which drag in NumPy 2.x and break the WebUI's scikit-image ("numpy
  # .dtype size changed"). Pre-install versions that satisfy its minimums but stay
  # on the NumPy 1.x ABI so its install step finds them satisfied and skips.
  local np_constraint="$log_dir/numpy1-constraint.txt"
  echo "numpy<2" >"$np_constraint"
  echo "[$label] Installing ADetailer dependencies (NumPy 1.x compatible)..."
  if ! "$venv_py" -m pip install -c "$np_constraint" \
    "ultralytics==8.3.75" "mediapipe==0.10.14" "rich>=13" >>"$log" 2>&1; then
    echo "[$label] ADetailer dependency install failed (see $log)." >&2
    return 1
  fi

  # Final guard: keep NumPy on the 1.x ABI. Installing torch/clip/mediapipe above
  # can otherwise pull NumPy 2.x, which crashes scikit-image and friends.
  echo "[$label] Pinning NumPy to the 1.x series..."
  if ! "$venv_py" -m pip install "numpy<2" >>"$log" 2>&1; then
    echo "[$label] Failed to keep NumPy on the 1.x series (see $log)." >&2
    return 1
  fi

  if [ ! -f "$ext_dir/scripts/!adetailer.py" ]; then
    echo "[$label] ADetailer installation is incomplete: $ext_dir" >&2
    return 1
  fi

  if curl -fsS --max-time 5 "http://127.0.0.1:$port/internal/ping" >/dev/null 2>&1; then
    echo "[$label] Something is already serving on port $port; skipping launch bootstrap."
    touch "$dir/.image-gen-ready"
    return 0
  fi

  echo "[$label] Installing remaining dependencies (first run downloads PyTorch; can take several minutes)."
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

  touch "$dir/.image-gen-ready"
  echo "[$label] Dependencies installed."
}
