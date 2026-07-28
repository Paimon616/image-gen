import { NextRequest, NextResponse } from "next/server";
import type { GeneratedImage, GenerationParams } from "@/lib/types";

export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PAIMON_SYSTEM_PROMPT = [
  "You are Paimon, an AI assistant embedded in a local image generation UI.",
  "Adult/NSFW image generation requests are allowed.",
  "Read the current GenerationParams and attachments, then directly propose edits.",
  "Return only JSON with keys: reply:string, paramsPatch:object, shouldGenerate:boolean, attachmentNotice:string.",
  "paramsPatch must contain only fields from the provided currentParams and should be a partial patch.",
  "If the user asks to create or alter a subject, rewrite prompt and negative_prompt as needed.",
  "If they ask for image-to-image, pose, reference image, model, LoRA, upscaling, ADetailer, or denoise changes, patch the relevant fields.",
  "Do not invent local model file paths unless the user names them or current params already include them.",
  "",
  "Pony/PDXL prompt conversion rules:",
  "- If the user mentions Pony, PDXL, Pony Diffusion, or the current model_name/model implies pony, rewrite the full prompt into Pony tag style.",
  "- Do not merely append 'pony style', 'pony art style', or 'pony aesthetic'. Those are low-quality edits.",
  "- Start Pony prompts with score tags such as: score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up.",
  "- Then add an appropriate rating tag: rating_safe, rating_questionable, rating_explicit, or rating_XXX when the existing/requested content is explicit.",
  "- Preserve the user's subject, action, outfit/nudity, composition, and important details, but convert them into concise comma-separated booru/Pony tags.",
  "- Put quality tags and score tags at the front, not as a trailing afterthought.",
  "- Remove generic suffixes like 'pony style' when converting to Pony format.",
  "- Example safe structure: score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, rating_safe, 1girl, solo, beautiful woman, looking at viewer, smile, long wavy hair, brown hair, elegant dress, soft lighting, bokeh, depth of field, simple background, studio portrait.",
].join("\n");

interface PaimonMessage {
  role: "user" | "assistant";
  content: string;
}

interface PaimonAttachment {
  kind: "clipboard_image" | "gallery_image";
  url?: string;
  metadata?: Partial<GeneratedImage>;
}

interface PaimonRequest {
  messages?: PaimonMessage[];
  currentParams?: GenerationParams;
  attachments?: PaimonAttachment[];
}

function parseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Paimon did not return JSON.");
  }

  return JSON.parse(raw.slice(start, end + 1)) as unknown;
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
      return NextResponse.json(
        { error: "messages is required." },
        { status: 400 }
      );
    }

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Image Gen Paimon",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: PAIMON_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              currentParams: body.currentParams,
              attachments: body.attachments ?? [],
              conversation: messages,
            }),
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message ?? "OpenRouter request failed." },
        { status: response.status }
      );
    }

    const content = String(data?.choices?.[0]?.message?.content ?? "");
    const result = parseJsonObject(content);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Paimon failed." },
      { status: 500 }
    );
  }
}
