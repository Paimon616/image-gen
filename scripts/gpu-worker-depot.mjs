#!/usr/bin/env node
// GPU worker depot: the only thing a colleague's GPU PC talks to on marc's Mac.
//
// The image-gen app itself binds 127.0.0.1 and has no auth, so it must not be
// exposed on the LAN. This tiny server is: it hands the worker its manifest
// (pinned ComfyUI ref, custom nodes, model list) and streams the model files,
// proxying Civitai/HuggingFace downloads with this Mac's tokens so the tokens
// never leave this machine. Every request needs the shared worker token.
//
//   GPU_WORKER_TOKEN=... npm run gpu-worker:depot
//
// Env:
//   GPU_WORKER_TOKEN      required, shared with worker-config.json on the PC
//   GPU_DEPOT_HOST        bind address (default 0.0.0.0)
//   GPU_DEPOT_PORT        default 5354
//   GPU_DEPOT_ALLOW       optional comma list of client IPs (e.g. 10.0.0.80,10.0.0.60)
//   COMFYUI_MODELS_DIR    local models tree (default ComfyUI/models)
//
// See docs/gpu-workers.md.

import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const TOKEN = process.env.GPU_WORKER_TOKEN?.trim() ?? "";
const HOST = process.env.GPU_DEPOT_HOST ?? "0.0.0.0";
const PORT = Number(process.env.GPU_DEPOT_PORT ?? 5354);
const ALLOW = (process.env.GPU_DEPOT_ALLOW ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const MODELS_DIR = resolve(ROOT, process.env.COMFYUI_MODELS_DIR ?? "ComfyUI/models");
const MODEL_FOLDERS = new Set([
  "checkpoints",
  "loras",
  "vae",
  "embeddings",
  "upscale_models",
  "controlnet",
  "ultralytics",
  "sams",
  "pulid",
  "insightface",
  "clip_vision",
  "ipadapter",
]);

// Kit files a worker replaces on its own when it updates. The .bat launchers
// are only replaced on an update restart (no cmd is reading them then).
// firewall.ps1 (runs as admin) and worker-config.json stay manual.
// worker.ps1 keeps its own copy of this list.
export const KIT_AUTO_FILES = [
  "worker.ps1",
  "helper.py",
  "custom-nodes.json",
  "start-worker.bat",
  "stop-worker.bat",
  "uninstall-worker.bat",
];
const KIT_DIR = join(ROOT, "worker-kit", "windows");

if (TOKEN.length < 16) {
  console.error("GPU_WORKER_TOKEN is required (16+ chars). e.g. export GPU_WORKER_TOKEN=$(openssl rand -hex 24)");
  process.exit(1);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  } catch {
    return fallback;
  }
}

function readTokens() {
  const settings = readJson(".local/settings.json", {});
  return {
    civitai: settings.civitaiApiKey || process.env.CIVITAI_API_TOKEN || "",
    huggingface:
      settings.huggingfaceApiKey || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "",
  };
}

/** Civitai page / API and HF blob URLs → a direct download URL. */
export function downloadUrlFor(sourceUrl) {
  if (!sourceUrl) return "";
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return "";
  }
  if (/(^|\.)civitai\.(com|red)$/i.test(url.hostname)) {
    if (url.pathname.startsWith("/api/download/models/")) {
      url.hostname = "civitai.com";
      return url.toString();
    }
    const versionId = url.searchParams.get("modelVersionId");
    return versionId ? `https://civitai.com/api/download/models/${versionId}` : "";
  }
  if (/(^|\.)huggingface\.co$/i.test(url.hostname)) {
    url.pathname = url.pathname.replace("/blob/", "/resolve/");
    return url.toString();
  }
  return url.toString();
}

function validModelPath(folder, name) {
  if (!MODEL_FOLDERS.has(folder)) return false;
  if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\")) return false;
  return true;
}

async function localFile(folder, name) {
  const path = resolve(MODELS_DIR, folder, name);
  if (!path.startsWith(MODELS_DIR + sep)) return null;
  try {
    const info = await stat(path);
    return info.isFile() ? { path, size: info.size } : null;
  } catch {
    return null;
  }
}

/** Kit file bytes as the worker should store them (.ps1/.bat with CRLF line ends). */
export function kitFileBytes(name, raw = readFileSync(join(KIT_DIR, name))) {
  if (!/\.(ps1|bat)$/.test(name)) return raw;
  return Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "utf8");
}

function kitManifest() {
  const files = [];
  for (const name of KIT_AUTO_FILES) {
    try {
      const bytes = kitFileBytes(name);
      files.push({ name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } catch {
      // missing in this checkout: the worker keeps its copy
    }
  }
  return { files };
}

async function buildManifest() {
  const profile = readJson("data/gpu-worker-profile.json", {});
  const catalog = readJson("data/model-catalog.json", {});
  const allNodes = readJson("comfyui-config/custom-nodes.json", { custom_nodes: [] }).custom_nodes;
  const wantedNodes = new Set(profile.customNodes ?? []);
  const comfyuiRef = readFileSync(join(ROOT, "comfyui-config/comfyui-version.txt"), "utf8").trim();

  const models = [];
  const problems = [];
  for (const key of profile.models ?? []) {
    const slash = key.indexOf("/");
    const folder = key.slice(0, slash);
    const name = key.slice(slash + 1);
    if (!validModelPath(folder, name)) {
      problems.push(`${key}: invalid path`);
      continue;
    }
    const local = await localFile(folder, name);
    const remote = downloadUrlFor(catalog[key]?.source_url);
    if (!local && !remote) {
      problems.push(`${key}: not on this Mac and no download source in model-catalog.json`);
      continue;
    }
    models.push({
      folder,
      name,
      size: local?.size ?? null,
      source: local ? "depot-file" : "depot-proxy",
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    comfyui: { repo: "comfyanonymous/ComfyUI", ref: comfyuiRef },
    customNodes: allNodes
      .filter((node) => wantedNodes.has(node.name))
      .map((node) => ({ name: node.name, repo: node.repo, ref: node.ref })),
    models,
    kit: kitManifest(),
    problems,
  };
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function clientIp(req) {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

async function serveLocal(req, res, file) {
  const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0;
  if (start >= file.size && file.size > 0) {
    res.writeHead(416, { "Content-Range": `bytes */${file.size}` });
    return res.end();
  }
  res.writeHead(range ? 206 : 200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": file.size - start,
    "Accept-Ranges": "bytes",
    ...(range ? { "Content-Range": `bytes ${start}-${file.size - 1}/${file.size}` } : {}),
  });
  await pipeline(createReadStream(file.path, { start }), res);
}

async function serveProxy(req, res, sourceUrl) {
  const tokens = readTokens();
  const host = new URL(sourceUrl).hostname;
  const bearer = /civitai/i.test(host) ? tokens.civitai : /huggingface/i.test(host) ? tokens.huggingface : "";
  const upstream = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(req.headers.range ? { Range: req.headers.range } : {}),
      "User-Agent": "image-gen-gpu-worker-depot",
    },
  });
  if (!upstream.ok || !upstream.body) {
    return sendJson(res, 502, { error: `upstream ${upstream.status}` });
  }
  const headers = { "Content-Type": "application/octet-stream" };
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  await pipeline(Readable.fromWeb(upstream.body), res);
}

const server = createServer(async (req, res) => {
  const ip = clientIp(req);
  const url = new URL(req.url ?? "/", "http://depot");
  try {
    if (ALLOW.length > 0 && !ALLOW.includes(ip) && ip !== "127.0.0.1" && ip !== "::1") {
      return sendJson(res, 403, { error: "client not allowed" });
    }
    if (!authorized(req)) return sendJson(res, 401, { error: "bad token" });

    if (req.method === "GET" && url.pathname === "/manifest") {
      return sendJson(res, 200, await buildManifest());
    }

    const kitMatch = /^\/kit\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && kitMatch) {
      const name = decodeURIComponent(kitMatch[1]);
      if (!KIT_AUTO_FILES.includes(name)) return sendJson(res, 404, { error: "not a kit file" });
      const bytes = kitFileBytes(name);
      console.log(`[depot] ${ip} GET kit/${name}`);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      return res.end(bytes);
    }

    const fileMatch = /^\/files\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && fileMatch) {
      const folder = decodeURIComponent(fileMatch[1]);
      const name = decodeURIComponent(fileMatch[2]);
      const key = `${folder}/${name}`;
      const profile = readJson("data/gpu-worker-profile.json", {});
      // Only what the profile lists is downloadable, never arbitrary files.
      if (!validModelPath(folder, name) || !(profile.models ?? []).includes(key)) {
        return sendJson(res, 404, { error: "not in worker profile" });
      }
      console.log(`[depot] ${ip} GET ${key}${req.headers.range ? ` (${req.headers.range})` : ""}`);
      const local = await localFile(folder, name);
      if (local) return await serveLocal(req, res, local);
      const catalog = readJson("data/model-catalog.json", {});
      const source = downloadUrlFor(catalog[key]?.source_url);
      if (!source) return sendJson(res, 404, { error: "no source" });
      return await serveProxy(req, res, source);
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    console.error(`[depot] ${ip} ${req.method} ${url.pathname}:`, error);
    if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) });
    else res.destroy();
  }
});

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  server.listen(PORT, HOST, async () => {
    const manifest = await buildManifest();
    console.log(`[depot] listening on http://${HOST}:${PORT}`);
    console.log(
      `[depot] ComfyUI ${manifest.comfyui.ref.slice(0, 10)}, ${manifest.customNodes.length} custom nodes, ${manifest.models.length} models`
    );
    for (const problem of manifest.problems) console.warn(`[depot] skip ${problem}`);
    if (ALLOW.length === 0) {
      console.warn("[depot] GPU_DEPOT_ALLOW not set: any LAN host with the token can download.");
    }
  });
}
