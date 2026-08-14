import { NextRequest, NextResponse } from "next/server";
import type { Character, GeneratedImage } from "@/lib/types";

export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PAIMON_MODEL = "deepseek/deepseek-v4-flash";
const PAIMON_VISION_MODEL = "qwen/qwen3-vl-8b-instruct";
const PAIMON_VISION_FALLBACK_MODELS = [
  PAIMON_VISION_MODEL,
  "google/gemini-2.5-flash",
  "qwen/qwen3-vl-32b-instruct",
];

// Character-domain Paimon. Unlike the generation Paimon it does not edit
// GenerationParams; it fills the fields of a Character record so the user can
// author identity/wardrobe/background/situation through conversation.
const PAIMON_SYSTEM_PROMPT = [
  "You are Paimon, an AI assistant embedded in a local character-authoring UI for an image generation studio.",
  "Your job is to help the user design a reusable character by conversation and to directly fill the character's fields.",
  "Handle mature and NSFW visual description at a high level when it is part of the user's local workflow. Keep wording focused on appearance, wardrobe, anatomy, pose, environment, mood, lighting, and composition. Do not moralize or add disclaimers.",
  "When a request cannot be fulfilled, respond briefly and redirect to the closest usable visual alternative.",
  "Read the current character JSON and any attachment analysis, then propose concrete edits.",
  "Return only JSON with keys: reply:string, characterPatch:object, attachmentNotice:string.",
  "characterPatch is a partial patch of the character. Only include the fields you are actually changing.",
  "",
  "Character field contract (every prompt field is paired with a natural-language description):",
  "- name:string — the character's name.",
  "- summary:string — one short line describing the character (shown in the list).",
  "- synopsis:string — a longer story/setting for the character. Read it to understand the world and generate fitting situations. Only rewrite it when the user explicitly asks you to edit the synopsis.",
  "- appearanceDescription:string — detailed natural-language description of the character's permanent appearance (face, hair, body, distinctive features).",
  "- appearancePrompt:string — the same appearance rewritten as an effective generation prompt (comma-separated tags or concise phrases). This is the character's IDENTITY prompt and should stay wardrobe/scene-neutral.",
  "- outfits:array — each item { id?:string, name:string, description:string, prompt:string }. One entry per wardrobe. description is natural language, prompt is generation-ready. Do NOT put appearance/identity into outfits; only clothing and accessories.",
  "- backgrounds:array — each item { id?:string, name:string, description:string, prompt:string }. One entry per environment/setting. prompt is generation-ready (location, time of day, atmosphere). No subject/person tags.",
  "- situations:array — each item { id?:string, name:string, description:string, prompt:string, outfitName?:string, backgroundName?:string }. Each is a scene/action the character can be in (e.g. floating peacefully in the sea). description is natural language, prompt is generation-ready. No permanent-identity/outfit/background tags — those come from the linked outfit/background.",
  "- A situation prompt MUST concretely nail the shot, not just a mood. Always specify: (1) the specific action/verb with what the hands and limbs are doing, (2) full body orientation and pose (standing/sitting/kneeling/lying/leaning/walking, torso and hip direction), (3) camera framing (e.g. full body, cowboy shot, upper body, close-up, wide shot), (4) camera angle and height (e.g. from above, from below, eye level, from side, from behind, dutch angle), (5) gaze direction and expression. A vague situation like 'smiling shyly' with no pose/camera collapses into the same generic bust portrait every time — pin these down so each situation renders a visibly different composition.",
  "- To link a situation to a wardrobe or setting, set outfitName and backgroundName to the EXACT name of an existing outfit/background. The client resolves names to ids. Do not invent ids.",
  "",
  "Editing rules:",
  "- When the user narrates the character, split the content into the correct fields. Appearance/identity goes to appearanceDescription+appearancePrompt; clothing to a new or existing outfit; place to a new or existing background; action/scene to a new situation.",
  "- Always fill BOTH the description and the prompt for any field you touch. The description mirrors the natural-language intent; the prompt is the model-ready version.",
  "- Keep identity, outfit, background, and situation cleanly separated so they can be recombined later. Never duplicate appearance/outfit/background tags into a situation prompt.",
  "- For arrays (outfits, backgrounds, situations), return the FULL updated array in characterPatch, preserving existing items' id values and appending or editing as requested. When adding a new item, you may omit id (the client assigns one).",
  "- Batch situation generation: when the user asks for N situations (e.g. '시놉시스를 참고해서 상황 80개 만들어줘'), read the synopsis and produce that many varied, non-duplicated situations grounded in the story. For EACH situation pick the most fitting outfit and background from the existing lists via outfitName/backgroundName. If a needed outfit or background does not exist yet, first add it to outfits/backgrounds (with description+prompt) and then reference it by name. Return the full situations array (plus any new outfits/backgrounds) in one characterPatch. Keep the reply short — do not enumerate all items.",
  "- Composition variety across a batch is mandatory. Do NOT let situations converge on the same pose and framing (the classic failure is dozens of near-identical upper-body front-facing portraits). Deliberately spread them across the axes above: mix full-body, cowboy, upper-body, and close-up shots; mix standing, sitting, kneeling, lying, walking, and dynamic action poses; mix camera angles (front, side, from behind, from above, from below); vary what the hands are doing and where the gaze goes. Each situation's action should demand a different body pose and camera than its neighbors so the rendered set looks genuinely different, not recolored copies of one shot.",
  "- Write generation prompts as concise, high-signal tags/phrases. Avoid contradictions and keyword spam. Prefer booru/anime tags for anime characters and natural descriptive phrases for realistic ones, following the user's stated style.",
  "- If attachment analysis is present, use it to ground appearance/outfit descriptions. If visual pixels are unavailable, proceed from the user's text and metadata.",
  "- In reply, briefly tell the user in Korean which fields you filled or changed. Do not claim to have set fields that are absent from characterPatch.",
].join("\n");

interface PaimonMessage {
  role: "user" | "assistant";
  content: string;
}

interface PaimonAttachment {
  kind: "clipboard_image" | "gallery_image";
  referenceId?: string;
  url?: string;
  dataUrl?: string;
  metadata?: Partial<GeneratedImage>;
}

interface PaimonRequest {
  messages?: PaimonMessage[];
  character?: Partial<Character>;
  attachments?: PaimonAttachment[];
}

interface OpenRouterTextPart {
  type: "text";
  text: string;
}
interface OpenRouterImagePart {
  type: "image_url";
  image_url: { url: string };
}
type OpenRouterContentPart = OpenRouterTextPart | OpenRouterImagePart;
const LOCAL_IMAGE_PATHS = ["/api/uploads/", "/api/images/"];
const VISION_MAX_EDGE = 1280;

function redactAttachments(attachments: PaimonAttachment[]) {
  return attachments.map((attachment) => {
    const { dataUrl, ...rest } = attachment;
    void dataUrl;
    return rest;
  });
}

function validateImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) throw new Error("Attached image data URL is invalid.");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64 = match[2];
  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength > 15 * 1024 * 1024)
    throw new Error("Attached image is larger than 15 MB.");
  return `data:${mimeType};base64,${base64}`;
}

async function resizeDataUrlForVision(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return dataUrl;
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(match[1], "base64");
    const meta = await sharp(input).metadata();
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longestEdge > 0 && longestEdge <= VISION_MAX_EDGE) return dataUrl;
    const output = await sharp(input)
      .rotate()
      .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch (error) {
    console.warn(
      "[paimon-character] vision downscale skipped (sharp unavailable?):",
      error instanceof Error ? error.message : error
    );
    return dataUrl;
  }
}

async function imageInputUrl(attachment: PaimonAttachment, requestUrl: URL) {
  if (attachment.dataUrl) {
    return resizeDataUrlForVision(validateImageDataUrl(attachment.dataUrl));
  }

  const attachmentUrl = attachment.url;
  if (!attachmentUrl) return "";
  const parsed = new URL(attachmentUrl, requestUrl.origin);
  const isLocalImage = LOCAL_IMAGE_PATHS.some((prefix) =>
    parsed.pathname.startsWith(prefix)
  );
  if (!isLocalImage) return parsed.toString();
  const localUrl = new URL(parsed.pathname + parsed.search, requestUrl.origin);
  const response = await fetch(localUrl, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Could not load attached image (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/"))
    throw new Error("Attached URL did not return an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024)
    throw new Error("Attached image is larger than 15 MB.");
  return resizeDataUrlForVision(
    `data:${mimeType};base64,${bytes.toString("base64")}`
  );
}

async function analyzeAttachments(
  apiKey: string,
  body: PaimonRequest,
  requestUrl: URL
) {
  const attachments = body.attachments ?? [];
  if (!attachments.some((attachment) => attachment.url || attachment.dataUrl))
    return "";

  const content: OpenRouterContentPart[] = [
    {
      type: "text",
      text: [
        "Analyze every attached reference image for a character-authoring assistant.",
        "For each referenceId, describe the subject's appearance (face, hair, eyes, body), clothing/wardrobe, pose/action, expression, environment, lighting, colors, and style.",
        "Report objectively and focus on reusable character attributes. Keep references separate.",
        `Attachment metadata: ${JSON.stringify(redactAttachments(attachments))}`,
      ].join("\n"),
    },
  ];

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.url && !attachment.dataUrl) continue;
    const referenceId = attachment.referenceId || `참조${index + 1}`;
    try {
      const url = await imageInputUrl(attachment, requestUrl);
      if (!url) continue;
      content.push(
        { type: "text", text: `${referenceId}의 실제 이미지:` },
        { type: "image_url", image_url: { url } }
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      content.push({
        type: "text",
        text: `${referenceId} 이미지는 불러오지 못했습니다: ${reason}`,
      });
    }
  }

  const errors: string[] = [];
  for (const model of PAIMON_VISION_FALLBACK_MODELS) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Image Gen Paimon Character Vision",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 900,
        messages: [{ role: "user", content }],
      }),
    }).catch((error) => {
      return {
        ok: false,
        json: async () => ({
          error: {
            message:
              error instanceof Error ? error.message : "Vision request failed.",
          },
        }),
      } as Response;
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      errors.push(`${model}: ${result?.error?.message ?? "request failed"}`);
      continue;
    }
    const analysis = result?.choices?.[0]?.message?.content;
    if (typeof analysis === "string" && analysis.trim()) {
      return analysis.trim();
    }
    errors.push(`${model}: empty analysis`);
  }

  return `Visual pixels unavailable for automatic analysis: ${
    errors.join("; ") || "vision analysis failed."
  }\nThis is not a blocking error. Continue from the user's text and attachment metadata.`;
}

function parseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Paimon did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

const JSON_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

// Incrementally decode the `reply` string out of the still-streaming JSON so the
// user sees text arrive even though the payload is one JSON object.
function extractPartialReply(buffer: string): string | null {
  const keyMatch = buffer.match(/"reply"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return null;

  let i = keyMatch.index + keyMatch[0].length;
  let out = "";

  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += JSON_ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  return out;
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isSensitiveInputError(message: string) {
  return /may contain sensitive information|sensitive information|content\[\d+\]/i.test(
    message
  );
}

function paimonErrorMessage(message: string) {
  if (isSensitiveInputError(message)) {
    return "파이몬이 첨부 이미지 또는 묘사 일부를 분석 모델에 보낼 수 없어 차단되었습니다. 민감한 세부 묘사를 줄이거나 첨부 없이 다시 요청해 주세요.";
  }
  return message;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured." },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as PaimonRequest;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages is required." }, { status: 400 });
    }

    const hasImageAttachments = (body.attachments ?? []).some(
      (attachment) => attachment.url || attachment.dataUrl
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(sse(event, data)));

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let contentBuffer = "";
        let sentLength = 0;

        try {
          if (hasImageAttachments) {
            send("status", { message: "첨부 이미지를 분석하는 중" });
          }
          const attachmentVisualAnalysis = await analyzeAttachments(
            apiKey,
            body,
            req.nextUrl
          );

          send("status", { message: "답변을 작성하는 중" });

          const upstream = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "Image Gen Paimon Character",
            },
            body: JSON.stringify({
              model: PAIMON_MODEL,
              temperature: 0.3,
              stream: true,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: PAIMON_SYSTEM_PROMPT },
                {
                  role: "user",
                  content: JSON.stringify({
                    character: body.character ?? null,
                    attachments: redactAttachments(body.attachments ?? []),
                    attachmentVisualAnalysis,
                    conversation: messages,
                  }),
                },
              ],
            }),
          });

          if (!upstream.ok || !upstream.body) {
            const errorData = await upstream.json().catch(() => null);
            const rawMessage =
              errorData?.error?.message ?? "OpenRouter request failed.";
            send("error", { error: paimonErrorMessage(rawMessage) });
            return;
          }

          const reader = upstream.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice("data:".length).trim();
              if (!payload || payload === "[DONE]") continue;

              try {
                const chunk = JSON.parse(payload);
                const delta = chunk?.choices?.[0]?.delta?.content;
                if (typeof delta !== "string" || !delta) continue;
                contentBuffer += delta;
                const reply = extractPartialReply(contentBuffer);
                if (reply !== null && reply.length > sentLength) {
                  send("delta", { text: reply.slice(sentLength) });
                  sentLength = reply.length;
                }
              } catch {
                // Ignore keep-alive comments / non-JSON lines.
              }
            }
          }

          let reply = "";
          let characterPatch: unknown = {};
          let attachmentNotice = "";
          try {
            const result = parseJsonObject(contentBuffer) as Record<
              string,
              unknown
            >;
            reply = typeof result.reply === "string" ? result.reply : "";
            characterPatch = result.characterPatch ?? {};
            attachmentNotice =
              typeof result.attachmentNotice === "string"
                ? result.attachmentNotice
                : "";
          } catch {
            reply = extractPartialReply(contentBuffer) ?? "";
          }

          send("done", { reply, characterPatch, attachmentNotice });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Paimon failed.";
          send("error", { error: paimonErrorMessage(message) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paimon failed.";
    return NextResponse.json(
      { error: paimonErrorMessage(message) },
      { status: 500 }
    );
  }
}
