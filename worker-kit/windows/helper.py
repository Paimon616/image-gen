"""GPU worker model helper.

Speaks the subset of the image-gen RunPod helper API (/api/runpod/helper/*)
that image-gen uses to check and download model files, so a LAN GPU worker
gets the same "missing files -> Download" flow as a RunPod pod. Runs on the
ComfyUI portable's embedded Python (stdlib only), next to ComfyUI.

Only writes inside the models folder it is given. Downloads only over https.
Reachable only from the addresses firewall.ps1 allows.

POST /api/worker/update (Bearer = the worker token) asks the kit's update
watcher to pull marc's depot now. The request carries no content: what gets
installed still comes only from the depot manifest.

GET /api/worker/logs[?name=watch|comfyui|comfyui-err|helper|helper-err&lines=N]
(same token) returns the tail of the newest kit log of that kind, read-only.
"""

import argparse
import glob
import hmac
import json
import os
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Must match RUNPOD_HELPER_VERSION in src/lib/runpod.ts, or the app shows
# "helper update needed" (cosmetic only).
HELPER_VERSION = "7"
POD_PREFIX = "/workspace/ComfyUI/models/"
CHUNK = 1024 * 1024

MODELS_DIR = ""
KIT_DIR = os.path.dirname(os.path.abspath(__file__))
UPDATE_FLAG = os.path.join(KIT_DIR, "update-request.flag")
UPDATE_STATE = os.path.join(KIT_DIR, "update-state.json")
CATALOG_LOCK = threading.Lock()
# In-flight downloads, keyed by relative model path, so anyone can see the
# percent via GET /api/runpod/helper/downloads (not only the caller streaming it).
DOWNLOADS = {}
DOWNLOADS_LOCK = threading.Lock()


def _relative(target):
    return os.path.relpath(target, MODELS_DIR).replace("\\", "/")


def _track(target, done, total, state="downloading", error=""):
    with DOWNLOADS_LOCK:
        now = time.time()
        entry = DOWNLOADS.setdefault(_relative(target), {"startedAt": now})
        # Current speed, not the lifetime average: a resumed download (network
        # switch, sleep) would otherwise keep showing its old, slow rate.
        if state == "downloading":
            last_at = entry.get("rateAt")
            if last_at is None or done < entry.get("rateDone", 0):
                entry.update({"rateAt": now, "rateDone": done, "rate": None})
            elif now - last_at >= 2:
                instant = (done - entry["rateDone"]) / (now - last_at)
                previous = entry.get("rate")
                entry["rate"] = instant if previous is None else previous * 0.5 + instant * 0.5
                entry.update({"rateAt": now, "rateDone": done})
        entry.update({
            "path": _relative(target),
            "downloaded": done,
            "total": total,
            "percent": min(100, round(done * 100 / total)) if total else None,
            "state": state,
            "error": error,
            "updatedAt": time.time(),
        })
        # Forget finished entries after 10 minutes.
        cutoff = time.time() - 600
        for key in [k for k, v in DOWNLOADS.items() if v["state"] != "downloading" and v["updatedAt"] < cutoff]:
            del DOWNLOADS[key]


def downloads_snapshot():
    with DOWNLOADS_LOCK:
        items = [dict(v) for v in DOWNLOADS.values()]
    now = time.time()
    for item in items:
        elapsed = max(1e-6, now - item["startedAt"])
        rate = item.pop("rate", None)
        rate_at = item.pop("rateAt", None)
        item.pop("rateDone", None)
        if item["state"] != "downloading":
            item["bytesPerSec"] = None
        elif rate is not None and rate_at is not None and now - rate_at < 10:
            item["bytesPerSec"] = int(rate)
        elif rate is not None:
            item["bytesPerSec"] = 0  # no progress for 10s+: stalled
        else:
            item["bytesPerSec"] = int(item["downloaded"] / elapsed)
    # Partial files left by an interrupted download (sleep, network drop):
    # these resume from their size on the next download request.
    known = {item["path"] for item in items}
    for root, _dirs, files in os.walk(MODELS_DIR):
        for name in files:
            if name.endswith(".download"):
                rel = _relative(os.path.join(root, name[: -len(".download")]))
                if rel not in known:
                    items.append({
                        "path": rel,
                        "downloaded": os.path.getsize(os.path.join(root, name)),
                        "total": None,
                        "percent": None,
                        "state": "paused",
                    })
    return items


def model_path(value):
    """'/workspace/ComfyUI/models/loras/x.safetensors' or 'loras/x' -> absolute path in MODELS_DIR."""
    raw = str(value or "").strip().replace("\\", "/")
    if raw.startswith(POD_PREFIX):
        raw = raw[len(POD_PREFIX):]
    raw = raw.lstrip("/")
    if not raw or ".." in raw.split("/") or ":" in raw:
        raise ValueError("Invalid model path: %s" % value)
    full = os.path.normpath(os.path.join(MODELS_DIR, raw))
    root = os.path.normpath(MODELS_DIR)
    if os.path.commonpath([full, root]) != root:
        raise ValueError("Path escapes the models folder: %s" % value)
    return full


class _StripAuthOnHostChange(urllib.request.HTTPRedirectHandler):
    # Civitai/HF redirect to signed CDN URLs; like fetch(), don't forward the
    # bearer token to a different host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            old_host = urllib.parse.urlparse(req.full_url).hostname
            new_host = urllib.parse.urlparse(newurl).hostname
            if old_host != new_host:
                for name in list(new.headers):
                    if name.lower() == "authorization":
                        del new.headers[name]
                new.unredirected_hdrs.pop("Authorization", None)
        return new


def _tls_context():
    # Python 3.13+ enables VERIFY_X509_STRICT, which rejects certificates
    # re-signed by corporate TLS inspection proxies ("Missing Authority Key
    # Identifier"). Keep full chain and hostname verification; drop only the
    # strict RFC 5280 profile check. Windows' certificate store (where the
    # company root CA lives) is loaded by create_default_context().
    ctx = ssl.create_default_context()
    ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
    return ctx


_opener = urllib.request.build_opener(
    _StripAuthOnHostChange, urllib.request.HTTPSHandler(context=_tls_context())
)


def download_to_file(target, url, token, on_progress):
    def report(done, total):
        _track(target, done, total)
        on_progress(done, total)

    try:
        result = _download_to_file(target, url, token, report)
        size = os.path.getsize(target)
        _track(target, size, size, state="done")
        return result
    except Exception as error:
        with DOWNLOADS_LOCK:
            entry = DOWNLOADS.get(_relative(target))
        _track(target, entry["downloaded"] if entry else 0, entry["total"] if entry else 0,
               state="error", error=str(error))
        raise


def _download_to_file(target, url, token, on_progress):
    if not url.lower().startswith("https://"):
        raise ValueError("Only https downloads are allowed.")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        size = os.path.getsize(target)
        on_progress(size, size)
        return target
    tmp = target + ".download"
    existing = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    headers = {"User-Agent": "image-gen-gpu-worker-helper/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if existing:
        headers["Range"] = "bytes=%d-" % existing
    req = urllib.request.Request(url, headers=headers)
    on_progress(existing, 0)
    with _opener.open(req, timeout=60) as res:
        if existing and res.status != 206:
            existing = 0  # server ignored the range; start over
        length = int(res.headers.get("Content-Length") or 0)
        total = existing + length if length else 0
        done = existing
        with open(tmp, "ab" if existing else "wb") as out:
            while True:
                chunk = res.read(CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                on_progress(done, total)
    if total and done < total:
        raise IOError("Download ended early (%d of %d bytes)." % (done, total))
    os.replace(tmp, target)
    on_progress(done, done)
    return target


def safetensors_capabilities(path):
    """Whether a checkpoint bundles a text encoder (clip) and a VAE."""
    try:
        with open(path, "rb") as f:
            size = int.from_bytes(f.read(8), "little")
            if size <= 0 or size > 100 * 1024 * 1024:
                return None
            keys = json.loads(f.read(size)).keys()
    except Exception:
        return None
    clip_prefixes = ("conditioner.", "cond_stage_model.", "text_encoders.", "clip_l.", "clip_g.", "te.")
    vae_prefixes = ("first_stage_model.", "vae.")
    return {
        "clip": any(k.startswith(clip_prefixes) for k in keys),
        "vae": any(k.startswith(vae_prefixes) for k in keys),
    }


def worker_token():
    try:
        with open(os.path.join(KIT_DIR, "worker-config.json"), encoding="utf-8-sig") as f:
            return str(json.load(f).get("token") or "")
    except Exception:
        return ""


def update_state():
    try:
        with open(UPDATE_STATE, encoding="utf-8-sig") as f:
            state = json.load(f)
    except Exception:
        state = {"state": "unknown"}
    state["pending"] = os.path.isfile(UPDATE_FLAG)
    return state


# Fixed log kinds -> file patterns inside <kit>\logs. Nothing else is readable.
LOG_KINDS = {
    "watch": "watch-*.log",
    "comfyui": "comfyui-*.log",
    "comfyui-err": "comfyui-*.log.err",
    "helper": "helper-*.log",
    "helper-err": "helper-*.log.err",
}
LOG_TAIL_BYTES = 512 * 1024


def newest_log(kind):
    files = glob.glob(os.path.join(KIT_DIR, "logs", LOG_KINDS[kind]))
    if kind in ("comfyui", "helper"):
        files = [f for f in files if not f.endswith(".err")]
    return max(files, key=os.path.getmtime) if files else None


def log_listing():
    result = []
    for kind in LOG_KINDS:
        path = newest_log(kind)
        if path:
            stat = os.stat(path)
            result.append({"name": kind, "file": os.path.basename(path), "size": stat.st_size,
                           "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(stat.st_mtime))})
    return result


def log_tail(kind, lines):
    path = newest_log(kind)
    if not path:
        return {"name": kind, "file": None, "lines": []}
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - LOG_TAIL_BYTES))
        data = f.read()
    text = data.decode("utf-8", errors="replace")
    return {"name": kind, "file": os.path.basename(path), "size": size,
            "lines": text.splitlines()[-lines:]}


def watcher_alive():
    """True when the kit's update watcher (worker.ps1 watch) is running."""
    try:
        with open(os.path.join(KIT_DIR, "watcher.pid"), encoding="utf-8-sig") as f:
            pid = int(f.read().strip())
    except Exception:
        return False
    if os.name != "nt":
        return True
    out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"],
                         capture_output=True, text=True).stdout
    return ('"%d"' % pid) in out


def ensure_watcher():
    """Start the watcher if it died, so an update request is never lost."""
    if os.name != "nt" or watcher_alive():
        return False
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
         os.path.join(KIT_DIR, "worker.ps1"), "watch"],
        cwd=KIT_DIR, creationflags=flags, close_fds=True,
    )
    return True


def catalog_file():
    return os.path.join(MODELS_DIR, ".image-gen-catalog.json")


def read_catalog():
    try:
        with open(catalog_file(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "gpu-worker-helper"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def _json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 10 * 1024 * 1024:
            raise ValueError("Request too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/runpod/helper/status":
            return self._json(200, {
                "ok": True,
                "version": HELPER_VERSION,
                "message": "GPU worker helper ready",
                "comfyModelsDir": MODELS_DIR,
            })
        if path == "/api/runpod/helper/catalog":
            return self._json(200, {"catalog": read_catalog()})
        if path == "/api/runpod/helper/downloads":
            return self._json(200, {"downloads": downloads_snapshot()})
        if path == "/api/worker/update":
            return self._json(200, update_state())
        if path == "/api/worker/logs":
            if not self._authorized():
                return self._json(401, {"error": "bad token"})
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = (query.get("name") or [""])[0]
            if not name:
                return self._json(200, {"logs": log_listing()})
            if name not in LOG_KINDS:
                return self._json(400, {"error": "name must be one of %s" % ", ".join(LOG_KINDS)})
            try:
                lines = max(1, min(5000, int((query.get("lines") or ["300"])[0])))
            except ValueError:
                lines = 300
            return self._json(200, log_tail(name, lines))
        return self._json(404, {"error": "Not found"})

    def _authorized(self):
        expected = worker_token()
        given = (self.headers.get("Authorization") or "").replace("Bearer ", "", 1).strip()
        return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._body()
        except Exception as error:
            return self._json(400, {"error": str(error)})
        if path == "/api/worker/update":
            if not self._authorized():
                return self._json(401, {"error": "bad token"})
            # "from" only reorders the worker's configured depots; it never adds one.
            with open(UPDATE_FLAG, "w", encoding="utf-8") as f:
                json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "from": self.client_address[0]}, f)
            try:
                restarted = ensure_watcher()
            except Exception as error:
                return self._json(500, {"error": "update watcher not running: %s" % error})
            return self._json(202, {"ok": True, "watcherRestarted": restarted, **update_state()})
        try:
            if path == "/api/runpod/helper/files":
                files = [str(f) for f in body.get("files") or []]
                result = []
                for f in files:
                    try:
                        exists = os.path.isfile(model_path(f))
                    except ValueError:
                        exists = False
                    result.append({"path": f, "exists": exists})
                return self._json(200, {"files": result})

            if path == "/api/runpod/helper/download":
                target = model_path(body.get("targetFile"))
                download_to_file(target, str(body.get("downloadUrl") or "").strip(),
                                 str(body.get("token") or ""), lambda d, t: None)
                return self._json(200, {"path": body.get("targetFile")})

            if path == "/api/runpod/helper/download/stream":
                return self._download_stream(body)

            if path == "/api/runpod/helper/catalog":
                entries = body.get("entries") or {}
                if not isinstance(entries, dict):
                    raise ValueError("entries must be an object")
                with CATALOG_LOCK:
                    catalog = read_catalog()
                    catalog.update(entries)
                    with open(catalog_file(), "w", encoding="utf-8") as f:
                        json.dump(catalog, f, ensure_ascii=False, indent=2)
                return self._json(200, {"ok": True, "count": len(catalog)})

            if path == "/api/runpod/helper/model-capabilities":
                target = model_path(body.get("file"))
                caps = safetensors_capabilities(target) if os.path.isfile(target) else None
                return self._json(200, {"capabilities": caps})

            if path == "/api/runpod/helper/restart-comfy":
                # ComfyUI rescans model folders on its own; nothing to restart.
                return self._json(200, {"ok": True, "restarted": False})

            return self._json(404, {"error": "Not supported on a GPU worker: %s" % path})
        except Exception as error:
            return self._json(400, {"error": str(error)})

    def _download_stream(self, body):
        raw_target = body.get("targetFile")
        target = model_path(raw_target)
        url = str(body.get("downloadUrl") or "").strip()
        if not url:
            raise ValueError("Download URL is required.")
        rel = _relative(target)
        start_background_download(target, url, str(body.get("token") or ""))

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def send(event):
            self.wfile.write(("data: %s\n\n" % json.dumps(event)).encode("utf-8"))
            self.wfile.flush()

        # Report the background download until it settles. If the caller goes
        # away (app restarted, Mac asleep), the download keeps going; only
        # this report loop ends.
        try:
            while True:
                with DOWNLOADS_LOCK:
                    entry = dict(DOWNLOADS.get(rel) or {})
                state = entry.get("state", "downloading")
                if state == "done":
                    send({"type": "complete", "path": raw_target, "percent": 100})
                    return
                if state == "error":
                    send({"type": "status", "message": "Download failed: %s" % entry.get("error", "")})
                    return
                total = entry.get("total") or 0
                done = entry.get("downloaded") or 0
                send({
                    "type": "progress",
                    "path": raw_target,
                    "downloaded": done,
                    "total": total,
                    "percent": min(100, round(done * 100 / total)) if total else 0,
                })
                time.sleep(0.5)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return


ACTIVE = set()
ACTIVE_LOCK = threading.Lock()


def start_background_download(target, url, token):
    """Runs the download in its own thread so it survives the caller leaving.
    A second request for a file already downloading just attaches to it."""
    rel = _relative(target)
    with ACTIVE_LOCK:
        if rel in ACTIVE:
            return
        ACTIVE.add(rel)
    _track(target, os.path.getsize(target + ".download") if os.path.exists(target + ".download") else 0, 0)

    def run():
        try:
            download_to_file(target, url, token, lambda d, t: None)
        except Exception:
            pass  # recorded in DOWNLOADS by download_to_file
        finally:
            with ACTIVE_LOCK:
                ACTIVE.discard(rel)

    threading.Thread(target=run, name="download " + rel, daemon=True).start()


def keep_awake():
    """While the worker runs, stop Windows from going to idle sleep.

    A locked screen is fine (processes keep running); sleep/hibernate is not,
    because the GPU and network go away. This only asks Windows to stay awake
    while this process lives (no power settings are changed) and it ends when
    stop-worker.bat closes the helper. The display may still turn off and lock.
    """
    if os.name != "nt":
        return
    try:
        import ctypes
        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
        print("Idle sleep blocked while the worker runs.", flush=True)
    except Exception as error:
        print("Could not block idle sleep: %s" % error, flush=True)


def main():
    global MODELS_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8189)
    args = parser.parse_args()
    MODELS_DIR = os.path.abspath(args.models)
    os.makedirs(MODELS_DIR, exist_ok=True)
    keep_awake()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print("GPU worker helper on %s:%d, models=%s" % (args.host, args.port, MODELS_DIR), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
