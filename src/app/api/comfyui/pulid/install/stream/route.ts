import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { isComfyInstalled, isLocalComfy } from "@/lib/comfyui-process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Streams `setup:pulid` (custom node + insightface deps + the SDXL weight) for the
// LOCAL ComfyUI, forwarding the script's stdout/stderr to the client as SSE. Only
// valid when this app manages a loopback ComfyUI — a remote/override URL is not
// ours to modify (use the RunPod install path for pods).
export async function POST() {
  if (!isLocalComfy()) {
    return Response.json(
      {
        error:
          "로컬 ComfyUI가 아닙니다. RunPod 대상에는 'RunPod에 설치'를 사용하세요. (Not a local ComfyUI — use the RunPod install for pods.)",
      },
      { status: 400 }
    );
  }
  if (!isComfyInstalled()) {
    return Response.json(
      {
        error:
          "로컬 ComfyUI가 설치되어 있지 않습니다. 먼저 `npm run setup:comfyui`를 실행하세요. (Local ComfyUI is not installed — run `npm run setup:comfyui` first.)",
      },
      { status: 400 }
    );
  }

  const windows = process.platform === "win32";
  const script = join(
    process.cwd(),
    "scripts",
    windows ? "setup-comfyui-pulid.ps1" : "setup-comfyui-pulid.sh"
  );
  if (!existsSync(script)) {
    return Response.json(
      { error: `PuLID setup script not found at ${script}.` },
      { status: 500 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeSend = (data: unknown) => {
        if (!closed) send(controller, data);
      };

      safeSend({ type: "status", message: "Starting PuLID install (node + weight)..." });

      const child = spawn(
        windows ? "powershell.exe" : "bash",
        windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script],
        { cwd: process.cwd(), env: process.env }
      );

      // Forward each stdout/stderr line as a log event.
      let buffer = "";
      const pump = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) safeSend({ type: "log", message: line });
        }
      };
      child.stdout?.on("data", pump);
      child.stderr?.on("data", pump);

      child.on("error", (err) => {
        safeSend({ type: "error", message: err.message });
        if (!closed) {
          closed = true;
          controller.close();
        }
      });

      child.on("close", (code) => {
        if (buffer.trim()) safeSend({ type: "log", message: buffer });
        if (code === 0) {
          safeSend({
            type: "complete",
            message:
              "PuLID 설치 완료. ComfyUI를 재시작한 뒤 다시 생성하세요. (PuLID installed — restart ComfyUI, then generate again.)",
          });
        } else {
          safeSend({
            type: "error",
            message: `PuLID install exited with code ${code}. See logs above.`,
          });
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      });

      return () => {
        closed = true;
        child.kill();
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
