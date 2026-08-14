import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  buildSeedanceContent,
  clampSeedanceDuration,
  DEFAULT_SEEDANCE_PARAMS,
  SEEDANCE_MAX_REFERENCES,
  SEEDANCE_RATIOS,
  SEEDANCE_RESOLUTIONS,
  type SeedanceParams,
  type SeedanceRatio,
  type SeedanceResolution,
  type SeedanceVideo,
} from "@/lib/seedance";

export const runtime = "nodejs";
// Generation polls ModelArk for up to ~10 minutes; keep the function alive.
export const maxDuration = 800;

const SEEDANCE_OUTPUT_DIR = join(process.cwd(), "output", "seedance");

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 150; // ~10 minutes

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function asImageString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) return trimmed;
  return null;
}

function normalizeParams(raw: Record<string, unknown>): SeedanceParams {
  const mode = raw.mode === "t2v" ? "t2v" : "i2v";
  const resolution = SEEDANCE_RESOLUTIONS.includes(raw.resolution as SeedanceResolution)
    ? (raw.resolution as SeedanceResolution)
    : DEFAULT_SEEDANCE_PARAMS.resolution;
  const ratio = SEEDANCE_RATIOS.includes(raw.ratio as SeedanceRatio)
    ? (raw.ratio as SeedanceRatio)
    : DEFAULT_SEEDANCE_PARAMS.ratio;
  const seedRaw = Number(raw.seed);
  const seed = Number.isFinite(seedRaw) && raw.seed !== null && raw.seed !== ""
    ? Math.trunc(seedRaw)
    : null;

  const references = Array.isArray(raw.references)
    ? raw.references
        .map(asImageString)
        .filter((v): v is string => Boolean(v))
        .slice(0, SEEDANCE_MAX_REFERENCES)
    : [];

  return {
    mode,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    resolution,
    ratio,
    duration: clampSeedanceDuration(raw.duration),
    cameraFixed: Boolean(raw.cameraFixed),
    watermark: Boolean(raw.watermark),
    cleanFrame: raw.cleanFrame === undefined ? true : Boolean(raw.cleanFrame),
    seed,
    firstFrame: mode === "i2v" ? asImageString(raw.firstFrame) : null,
    lastFrame: mode === "i2v" ? asImageString(raw.lastFrame) : null,
    references: mode === "i2v" ? references : [],
  };
}

interface ArkError {
  code?: string;
  message?: string;
}

function arkErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: ArkError }).error;
    if (err?.message) return err.message;
    const msg = (payload as { message?: string }).message;
    if (msg) return msg;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.SEEDANCE_API_KEY?.trim();
  const baseUrl = (process.env.SEEDANCE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // BytePlus ModelArk model id for SeeDance 2.5 (Dreamina). The 2.5 series is a
  // MultimodalToVideo model and uses the same content roles (first_frame,
  // last_frame, reference_image) as earlier versions. Overridable via env in
  // case the dated version id changes.
  const model = process.env.SEEDANCE_MODEL?.trim() || "dreamina-seedance-2-5-260628";

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const params = normalizeParams(rawBody);
  const clientId = typeof rawBody.clientId === "string" ? rawBody.clientId : randomUUID();

  const encoder = new TextEncoder();
  const abortSignal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (!apiKey) {
        send("error", {
          id: clientId,
          message:
            "SEEDANCE_API_KEY가 설정되지 않았습니다. .env.local에 키를 추가하고 서버를 재시작하세요.",
        });
        close();
        return;
      }

      if (params.mode === "i2v" && !params.firstFrame) {
        send("error", {
          id: clientId,
          message: "이미지 → 영상 모드에는 시작 이미지가 필요합니다.",
        });
        close();
        return;
      }
      if (!params.prompt.trim() && params.mode === "t2v") {
        send("error", { id: clientId, message: "프롬프트를 입력하세요." });
        close();
        return;
      }

      send("queued", { id: clientId });

      let taskId: string | null = null;
      try {
        // 1) Create the async generation task.
        const createRes = await fetch(`${baseUrl}/contents/generations/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            content: buildSeedanceContent(params),
          }),
          signal: abortSignal,
        });

        const createJson = await createRes.json().catch(() => null);
        if (!createRes.ok || !createJson?.id) {
          send("error", {
            id: clientId,
            message: arkErrorMessage(
              createJson,
              `작업 생성 실패 (HTTP ${createRes.status})`
            ),
          });
          close();
          return;
        }

        taskId = createJson.id as string;
        send("task", { id: clientId, taskId });

        // 2) Poll until the task completes.
        let videoUrl: string | null = null;
        for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
          if (abortSignal.aborted) break;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          if (abortSignal.aborted) break;

          const pollRes = await fetch(
            `${baseUrl}/contents/generations/tasks/${taskId}`,
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: abortSignal,
            }
          );
          const pollJson = await pollRes.json().catch(() => null);
          if (!pollRes.ok || !pollJson) {
            send("error", {
              id: clientId,
              message: arkErrorMessage(pollJson, `상태 조회 실패 (HTTP ${pollRes.status})`),
            });
            close();
            return;
          }

          const status = String(pollJson.status ?? "");
          send("poll", { id: clientId, status, attempt });

          if (status === "succeeded") {
            videoUrl =
              pollJson.content?.video_url ??
              pollJson.content?.video?.url ??
              null;
            break;
          }
          if (status === "failed" || status === "cancelled" || status === "canceled") {
            send("error", {
              id: clientId,
              message: arkErrorMessage(pollJson, "영상 생성 실패"),
            });
            close();
            return;
          }
        }

        if (abortSignal.aborted) {
          // Best-effort remote cancel so we don't keep billing a running task.
          if (taskId) {
            fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiKey}` },
            }).catch(() => {});
          }
          send("canceled", { id: clientId });
          close();
          return;
        }

        if (!videoUrl) {
          send("error", { id: clientId, message: "생성 시간 초과 (10분). 나중에 다시 시도하세요." });
          close();
          return;
        }

        // 3) Download the result (ModelArk URLs expire in ~24h) and persist it.
        send("poll", { id: clientId, status: "downloading", attempt: -1 });
        const videoRes = await fetch(videoUrl, { signal: abortSignal });
        if (!videoRes.ok) {
          send("error", { id: clientId, message: `영상 다운로드 실패 (HTTP ${videoRes.status})` });
          close();
          return;
        }
        const buffer = Buffer.from(await videoRes.arrayBuffer());
        if (buffer.byteLength < 1000) {
          send("error", { id: clientId, message: "다운로드된 영상이 손상되었습니다." });
          close();
          return;
        }

        await mkdir(SEEDANCE_OUTPUT_DIR, { recursive: true });
        const fileId = randomUUID();
        const filename = `${fileId}.mp4`;
        const timestamp = Date.now();

        const video: SeedanceVideo = {
          id: fileId,
          url: `/api/seedance/videos/${filename}`,
          filename,
          timestamp,
          contentType: "video/mp4",
          prompt: params.prompt,
          params: {
            mode: params.mode,
            prompt: params.prompt,
            resolution: params.resolution,
            ratio: params.ratio,
            duration: params.duration,
            cameraFixed: params.cameraFixed,
            watermark: params.watermark,
            cleanFrame: params.cleanFrame,
            seed: params.seed,
            hasFirstFrame: Boolean(params.firstFrame),
            hasLastFrame: Boolean(params.lastFrame),
            referenceCount: params.references.length,
          },
          thumbnail: null,
        };

        await writeFile(join(SEEDANCE_OUTPUT_DIR, filename), buffer);
        await writeFile(
          join(SEEDANCE_OUTPUT_DIR, `${fileId}.json`),
          JSON.stringify(video, null, 2),
          "utf-8"
        );

        send("complete", { id: clientId, video });
        close();
      } catch (error) {
        if (abortSignal.aborted) {
          if (taskId) {
            fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiKey}` },
            }).catch(() => {});
          }
          send("canceled", { id: clientId });
        } else {
          send("error", {
            id: clientId,
            message: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
