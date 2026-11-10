import type { NextRequest } from "next/server";
import {
  fetchGpuWorkerLog,
  getGpuWorkers,
  GPU_WORKER_LOG_KINDS,
  type GpuWorkerLogKind,
} from "@/lib/gpu-workers";

export const dynamic = "force-dynamic";

const LOG_LABELS: Record<GpuWorkerLogKind, string> = {
  watch: "업데이트",
  comfyui: "ComfyUI",
  "comfyui-err": "ComfyUI 오류",
  helper: "헬퍼",
  "helper-err": "헬퍼 오류",
};

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// GET ?workerId=&name=watch|comfyui|comfyui-err|helper|helper-err&lines=300[&format=json]
// Tail of a GPU worker's kit log, read through its helper with the worker token.
// Default output is a small HTML page (opened from the generator's worker list).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const workers = await getGpuWorkers();
  const worker = workers.find((w) => w.id === params.get("workerId")) ?? workers[0];
  if (!worker) return Response.json({ error: "No GPU worker" }, { status: 404 });
  const rawName = params.get("name") ?? "watch";
  const name = (GPU_WORKER_LOG_KINDS as readonly string[]).includes(rawName)
    ? (rawName as GpuWorkerLogKind)
    : "watch";
  const lines = Math.min(5000, Math.max(1, Number(params.get("lines")) || 300));

  let body: string;
  let file: string | null = null;
  let failed = false;
  try {
    const tail = await fetchGpuWorkerLog(worker, name, lines);
    file = tail.file;
    if (params.get("format") === "json") return Response.json(tail);
    body = tail.lines.length > 0 ? tail.lines.join("\n") : "(로그 없음)";
  } catch (error) {
    if (params.get("format") === "json") {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
    failed = true;
    body = `로그를 가져오지 못함: ${error instanceof Error ? error.message : String(error)}`;
  }

  const link = (kind: GpuWorkerLogKind) => {
    const q = new URLSearchParams({ workerId: worker.id, name: kind, lines: String(lines) });
    const current = kind === name ? ' aria-current="page"' : "";
    return `<a href="?${q}"${current}>${LOG_LABELS[kind]}</a>`;
  };
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(worker.label)} 로그</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--muted:#666;--line:#ddd;--err:#b00}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--muted:#999;--line:#333;--err:#f77}}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,Menlo,monospace}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
a{color:var(--muted);text-decoration:none}a[aria-current]{color:var(--fg);font-weight:600}
.meta{color:var(--muted);margin-left:auto}
pre{margin:0;padding:12px 16px;white-space:pre-wrap;word-break:break-all}
.fail{color:var(--err)}
</style></head><body>
<header><strong>${escapeHtml(worker.label)}</strong>${GPU_WORKER_LOG_KINDS.map(link).join("")}
<span class="meta">${escapeHtml(file ?? "")} · 최근 ${lines}줄 · <a href="">새로고침</a></span></header>
<pre${failed ? ' class="fail"' : ""}>${escapeHtml(body)}</pre>
<script>scrollTo(0,document.body.scrollHeight)</script>
</body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
