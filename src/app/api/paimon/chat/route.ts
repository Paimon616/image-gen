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
  "",
  "General model-family prompt rules:",
  "- Always adapt BOTH prompt and negative_prompt to the current checkpoint family. Do not only edit the positive prompt.",
  "- Infer model family from currentParams.model_name, modelContext.currentCheckpoint.base_model, checkpoint file name, and the user's requested checkpoint.",
  "- Pony/PDXL: booru tags, score tags first, rating_* tag early, concise comma tags; negatives should use low score tags and artifact/anatomy tags, not long prose.",
  "- Illustrious/NoobAI/Anima anime SDXL: comma-separated anime/booru tags with quality tags such as masterpiece, best quality, very aesthetic, absurdres/highres when appropriate; negatives should include worst quality, low quality, lowres, bad anatomy, bad hands, jpeg artifacts, watermark/text.",
  "- SDXL realistic/semi-realistic: natural language plus concise photographic tags; use camera, lighting, lens, composition, skin/detail descriptors; negatives should target plastic skin, overprocessed, bad anatomy, extra fingers, watermark/text.",
  "- SD 1.5 realistic/anime: shorter comma tags, avoid excessive SDXL/Pony score tags; keep resolution/detail tags moderate; negatives should include anatomy/artifact terms and embeddings only if present in currentParams.",
  "- Flux/Krea 2: prefer clean natural-language prompt sentences or short descriptive phrases; avoid Pony score tags and excessive booru syntax unless the checkpoint metadata clearly says otherwise.",
  "- If model catalog tags contain POS:/NEG: examples for the selected checkpoint, use them as style guidance while preserving the user's concept.",
  "",
  "Checkpoint and LoRA rules:",
  "- When changing checkpoint/model_name, also reconsider loras. Existing loras that do not match the new checkpoint family should be removed unless the user explicitly asks to keep them.",
  "- Choose LoRAs only from modelContext.compatibleLoras or existing currentParams.loras. Do not invent LoRA paths.",
  "- Prefer LoRAs whose name/tags/path match the user's requested subject, style, character, outfit, pose, or quality goal.",
  "- If no compatible LoRA clearly matches the request, return an empty loras array or keep only compatible existing LoRAs. Do not pick random LoRAs.",
  "- Use conservative LoRA scale defaults: style/detail 0.45-0.8, character/concept 0.65-0.95, slider LoRAs according to their apparent purpose.",
  "- If the user asks to change checkpoint but not a specific file, pick a checkpoint only from modelContext.checkpoints. Match requested family/style and explain the choice in reply.",
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

interface PaimonModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  tags?: string[];
}

interface PaimonModelContext {
  currentCheckpoint?: PaimonModelAsset;
  compatibleLoras?: PaimonModelAsset[];
  checkpoints?: PaimonModelAsset[];
}

interface PaimonRequest {
  messages?: PaimonMessage[];
  currentParams?: GenerationParams;
  attachments?: PaimonAttachment[];
  modelContext?: PaimonModelContext;
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
              modelContext: body.modelContext ?? null,
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
