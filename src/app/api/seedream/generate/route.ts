import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import {
  DEFAULT_SEEDREAM_PARAMS,
  resolveSeedreamAspectRatio,
  resolveSeedreamModel,
  resolveSeedreamTier,
  seedreamSize,
  SEEDREAM_MAX_PROMPT_CHARS,
  type SeedreamParams,
} from "@/lib/seedream";
import {
  generateSeedreamImage,
  persistSeedreamImage,
  prepareSeedreamReference,
  resolveSeedreamArkModel,
  seedreamApiKey,
  seedreamBaseUrl,
} from "@/lib/seedream-server";
import { isValidWorkspaceId, workspaceExists } from "@/lib/workspaces";
import { DEFAULT_PARAMS } from "@/lib/types";

export const runtime = "nodejs";
// A 4K render with a dozen references can take a few minutes, and the finished
// image still has to be downloaded from ModelArk afterwards.
export const maxDuration = 600;

// ModelArk's /images/generations is synchronous — there is no task to poll — so
// the stream emits a heartbeat on this cadence purely so the client's progress
// bar moves and no proxy kills the idle connection.
const HEARTBEAT_MS = 2000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function asDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/") ? trimmed : null;
}

function normalizeParams(raw: Record<string, unknown>): SeedreamParams {
  const model = resolveSeedreamModel(raw.model);
  return {
    model: model.id,
    prompt: (typeof raw.prompt === "string" ? raw.prompt : "")
      .trim()
      .slice(0, SEEDREAM_MAX_PROMPT_CHARS),
    tier: resolveSeedreamTier(model, raw.tier),
    ratio: resolveSeedreamAspectRatio(raw.ratio),
    references: Array.isArray(raw.references)
      ? raw.references
          .map(asDataUrl)
          .filter((value): value is string => Boolean(value))
          // Over the model's own ceiling ModelArk rejects the whole request,
          // so the extras are dropped rather than sent.
          .slice(0, model.maxReferences)
      : [],
    watermark:
      raw.watermark === undefined
        ? DEFAULT_SEEDREAM_PARAMS.watermark
        : Boolean(raw.watermark),
    workspaceId: isValidWorkspaceId(raw.workspaceId) ? raw.workspaceId : "",
  };
}

export async function POST(req: NextRequest) {
  const apiKey = seedreamApiKey();

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
  const model = resolveSeedreamModel(params.model);
  const clientId =
    typeof rawBody.clientId === "string" ? rawBody.clientId : randomUUID();
  // Only honour a workspace target that still exists, so a stale id from the
  // client can't create a dangling assignment.
  const workspaceId =
    params.workspaceId && (await workspaceExists(params.workspaceId))
      ? params.workspaceId
      : "";

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
            "SEEDANCE_API_KEY가 설정되지 않았습니다. .env.local에 ARK 키를 넣고 서버를 재시작하세요.",
        });
        close();
        return;
      }
      if (!params.prompt) {
        send("error", { id: clientId, message: "프롬프트를 입력하세요." });
        close();
        return;
      }

      send("queued", { id: clientId });

      let heartbeat: ReturnType<typeof setInterval> | null = null;
      try {
        // Shrink/validate the references before the call: one unusable picture
        // would otherwise fail the whole request after the upload.
        const prepared: string[] = [];
        for (const reference of params.references) {
          const ready = await prepareSeedreamReference(reference);
          if (ready) prepared.push(ready);
        }
        const dropped = params.references.length - prepared.length;

        const size = seedreamSize(model, params.tier, params.ratio);

        let ticks = 0;
        heartbeat = setInterval(() => {
          ticks += 1;
          send("tick", { id: clientId, ticks });
        }, HEARTBEAT_MS);

        const result = await generateSeedreamImage({
          apiKey,
          baseUrl: seedreamBaseUrl(),
          arkModel: resolveSeedreamArkModel(model),
          prompt: params.prompt,
          references: prepared,
          size,
          watermark: params.watermark,
          signal: abortSignal,
        });

        clearInterval(heartbeat);
        heartbeat = null;
        send("saving", { id: clientId });

        const [width, height] = size.includes("x")
          ? size.split("x").map(Number)
          : [undefined, undefined];

        const image = await persistSeedreamImage({
          result,
          params: {
            ...DEFAULT_PARAMS,
            // Seedream is a hosted model — never record the local default LoRA on it.
            loras: [],
            ...(width && height ? { width, height } : {}),
            prompt: params.prompt,
            model: `seedream/${model.id}`,
            model_name: model.label,
            generation_mode:
              prepared.length > 0 ? "image_to_image" : "text_to_image",
            source_image: null,
          },
          workspaceId,
          sidecar: {
            seedream_model: resolveSeedreamArkModel(model),
            seedream_size: size,
            seedream_tier: params.tier,
            seedream_ratio: params.ratio,
            seedream_reference_count: prepared.length,
          },
        });

        send("complete", { id: clientId, image, droppedReferences: dropped });
        close();
      } catch (error) {
        if (heartbeat) clearInterval(heartbeat);
        if (abortSignal.aborted) {
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
