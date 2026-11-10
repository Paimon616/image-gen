import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import {
  analyzeWithVision,
  PaimonLlmError,
  resolvePaimonLlm,
} from "@/lib/paimon-llm";
import { removePromptFragments, type VariationPlan } from "@/lib/reference-variations";

export const dynamic = "force-dynamic";

// Plans the "varied batch" from the on-screen prompt. The prompt itself is kept
// as written (style, character, outfit, quality tags); only its pose, expression,
// background and camera parts are taken out and replaced per image with
// variations of them. The reference image is sent too, so a prompt without a
// place still gets backgrounds that fit the character's world.

const INSTRUCTION = `You help vary an image-generation prompt. The user's prompt is below, with the character reference image it is used with.
Return a single JSON object only, no markdown, with these fields:
- "remove": an array of exact fragments copied character-for-character from the prompt (tags or phrases, without the separating comma) that describe ONLY the pose, body position, hand position, gesture, facial expression, gaze direction, camera / shot / framing / angle / lens, or the background / place / scenery / room. Do not list anything about the art style, quality, the character's body, face features (eyes, fangs, ears, tail, hair), clothing or accessories, even when they also appear next to the pose or expression.
- "gender": "female" or "male" (the character's apparent gender).
- "setting": 1 short phrase naming the place the prompt's background describes, as a whole place with its grounds (e.g. "a British castle and its grounds"). If the prompt names no place, a place that fits the character and the reference image.
- "backgrounds": an array of 12 different spots in and around the setting (8-16 English words each): at least 4 outdoor and at least 6 indoor, including private rooms (bedroom, living room / drawing room). For a British castle, for example: the rose garden, the drawing room, a canopy bedroom, the stone terrace, the library, the great hall, the battlements, the courtyard fountain.
- "poses": an array of 12 English poses (one sentence each, written with she/he) that are variations of the pose in the prompt (or in the image if the prompt has none). Keep the attitude and personality but change the whole body: at most 2 stay close to the original; the rest spread over standing, walking, sitting on a chair or bed, leaning on furniture or a railing, kneeling, lying down, and holding a prop, each with different hands. Never name a room or place in a pose. Every pose must differ clearly from the others.
- "expressions": an array of 12 English facial expressions (short phrases) that are variations of the expression in the prompt (or in the image): keep the same personality (a smug fanged grin becomes a teasing smirk, a sly wink, a proud laugh), with a few contrasting moods.

The user's prompt:
"""PROMPT"""`;

function parseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) =>
  Array.isArray(value) ? value.map(str).filter(Boolean).slice(0, 40) : [];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { imageUrl?: string; prompt?: string };
    const imageUrl = (body.imageUrl ?? "").trim();
    const prompt = (body.prompt ?? "").trim();
    if (!imageUrl) {
      return NextResponse.json({ error: "캐릭터 참조 이미지가 없습니다." }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json(
        { error: "프롬프트가 비어 있습니다. 캐릭터 · 화풍을 적은 프롬프트를 넣고 다시 누르세요." },
        { status: 400 }
      );
    }

    const source = imageUrl.startsWith("/") ? `${req.nextUrl.origin}${imageUrl}` : imageUrl;
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `참조 이미지를 읽지 못했습니다 (HTTP ${res.status}).` },
        { status: 502 }
      );
    }
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const llm = await resolvePaimonLlm();
    const content = [
      { type: "text" as const, text: INSTRUCTION.replace("PROMPT", prompt.slice(0, 4000)) },
      {
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
      },
    ];

    // The model occasionally returns prose or cut-off JSON; one retry is cheaper
    // than failing a 100-image batch.
    let parsed: Record<string, unknown> | null = null;
    let lastErrors: string[] = [];
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const { analysis, errors } = await analyzeWithVision(llm, content, {
        maxTokens: 3000,
        timeoutMs: 60_000,
      });
      lastErrors = errors;
      parsed = analysis ? parseJson(analysis) : null;
    }
    if (!parsed) {
      return NextResponse.json(
        {
          error: `모델이 프롬프트를 분석하지 못했습니다. ${lastErrors.slice(0, 2).join(" / ")}`.trim(),
        },
        { status: 502 }
      );
    }

    const removed = list(parsed.remove).filter((fragment) => prompt.includes(fragment));
    const plan: VariationPlan = {
      gender: str(parsed.gender).toLowerCase() === "male" ? "male" : "female",
      base: removePromptFragments(prompt, removed),
      removed,
      setting: str(parsed.setting),
      backgrounds: list(parsed.backgrounds),
      poses: list(parsed.poses),
      expressions: list(parsed.expressions),
    };
    if (!plan.base || plan.backgrounds.length === 0) {
      return NextResponse.json(
        { error: "프롬프트 분석 결과가 비어 있습니다. 다시 시도하세요." },
        { status: 502 }
      );
    }

    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaimonLlmError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("reference-analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "프롬프트 분석에 실패했습니다." },
      { status: 500 }
    );
  }
}
