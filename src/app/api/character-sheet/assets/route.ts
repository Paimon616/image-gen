import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";

import { IPADAPTER_ASSETS, IPADAPTER_NODE_REPO } from "@/lib/character-sheet";
import { checkIpAdapterSheetSetup, type ComfyClientOptions } from "@/lib/comfyui";
import { isComfyInstalled, isLocalComfy } from "@/lib/comfyui-process";
import { invalidateGpuWorkerModels } from "@/lib/gpu-workers";
import { streamRunpodResourceDownload } from "@/lib/runpod";
import { getRunpodPod, readSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BETA 캐릭터 기준 시트 — IP-Adapter setup on a generation target.
//   GET  ?targetId=<worker or pod id>  (omitted = local ComfyUI)
//        → node installed? which model files are listed? what is missing?
//   POST { targetId? } (SSE)
//        → local: runs scripts/setup-comfyui-ipadapter (node + models)
//        → GPU worker / pod: downloads the missing model files through the
//          existing helper download flow (helper writes only inside its models
//          folder, https only). The custom node is never installed remotely:
//          on a GPU worker it comes from the kit's pinned list on start-worker.bat.

async function resolveTarget(targetId: string | null) {
  if (!targetId) return { kind: "local" as const, label: "로컬 ComfyUI", options: undefined };
  const pod = await getRunpodPod(targetId);
  if (!pod?.comfyUrl) return null;
  const settings = await readSettings();
  const isWorker = settings.gpuWorkers.some((worker) => worker.id === pod.id);
  const options: ComfyClientOptions = {
    baseUrl: pod.comfyUrl,
    remoteKind: isWorker ? "gpu-worker" : "runpod",
  };
  return {
    kind: isWorker ? ("worker" as const) : ("runpod" as const),
    id: pod.id,
    label: pod.label || pod.id,
    options,
  };
}

export async function GET(req: NextRequest) {
  const target = await resolveTarget(req.nextUrl.searchParams.get("targetId"));
  if (!target) return Response.json({ error: "Unknown target." }, { status: 404 });
  const status = await checkIpAdapterSheetSetup(target.options);
  return Response.json(
    {
      target: { kind: target.kind, label: target.label },
      node: IPADAPTER_NODE_REPO,
      assets: IPADAPTER_ASSETS,
      ...status,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

function localInstallStream() {
  const windows = process.platform === "win32";
  const script = join(
    process.cwd(),
    "scripts",
    windows ? "setup-comfyui-ipadapter.ps1" : "setup-comfyui-ipadapter.sh"
  );
  if (!existsSync(script)) {
    return Response.json({ error: `Setup script not found: ${script}` }, { status: 500 });
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeSend = (data: unknown) => {
        if (!closed) send(controller, data);
      };
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      safeSend({ type: "status", message: "IP-Adapter 설치 시작 (노드 + 모델 ~3.4GB)" });
      const child = spawn(
        windows ? "powershell.exe" : "bash",
        windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script],
        { cwd: process.cwd(), env: process.env }
      );
      let buffer = "";
      const pump = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) safeSend({ type: "log", message: line });
      };
      child.stdout?.on("data", pump);
      child.stderr?.on("data", pump);
      child.on("error", (error) => {
        safeSend({ type: "error", message: error.message });
        close();
      });
      child.on("close", (code) => {
        if (code === 0) {
          safeSend({
            type: "complete",
            message: "설치 완료. 로컬 ComfyUI 재시작 후 사용 (restart ComfyUI so the node loads).",
          });
        } else {
          safeSend({ type: "error", message: `setup-comfyui-ipadapter exited with code ${code}` });
        }
        close();
      });
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { targetId?: unknown };
  const targetId = typeof body.targetId === "string" && body.targetId ? body.targetId : null;
  const target = await resolveTarget(targetId);
  if (!target) return Response.json({ error: "Unknown target." }, { status: 404 });

  if (target.kind === "local") {
    if (!isLocalComfy()) {
      return Response.json(
        { error: "로컬 ComfyUI가 아님 (Not a local ComfyUI)." },
        { status: 400 }
      );
    }
    if (!isComfyInstalled()) {
      return Response.json(
        { error: "로컬 ComfyUI 미설치 — npm run setup:comfyui 먼저 실행." },
        { status: 400 }
      );
    }
    return localInstallStream();
  }

  const remoteId = target.id;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const status = await checkIpAdapterSheetSetup(target.options);
        if (!status.reachable) throw new Error(`${target.label} ComfyUI 응답 없음.`);
        // Fetch only what is missing; an existing helper file is skipped anyway.
        const wanted = IPADAPTER_ASSETS.filter((asset) =>
          asset.targetFile.startsWith("ipadapter/")
            ? status.missing.includes("ipadapter")
            : status.missing.includes("clip_vision")
        );
        for (const asset of wanted) {
          send(controller, { type: "status", message: `다운로드: ${asset.targetFile}` });
          await streamRunpodResourceDownload(
            remoteId,
            { type: "other", name: asset.fileName, url: asset.downloadUrl },
            asset.targetFile,
            (event) => send(controller, { ...event, file: asset.targetFile })
          );
        }
        invalidateGpuWorkerModels(remoteId);
        send(controller, {
          type: "complete",
          message: status.nodeInstalled
            ? "모델 준비 완료."
            : target.kind === "worker"
              ? "모델 준비 완료. 노드는 워커 PC에서 최신 worker-kit으로 start-worker.bat 재실행 필요."
              : "모델 준비 완료. 노드(ComfyUI_IPAdapter_plus)는 pod에 별도 설치 필요.",
        });
      } catch (error) {
        send(controller, {
          type: "error",
          message: error instanceof Error ? error.message : "Download failed.",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
