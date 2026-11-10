import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import {
  analyzeWithVision,
  PaimonLlmError,
  resolvePaimonLlm,
} from "@/lib/paimon-llm";
import type { ReferenceAnalysis } from "@/lib/reference-variations";

export const dynamic = "force-dynamic";

// Reads the character reference once and returns the pieces the batch buttons
// combine into varied prompts: a detailed art-style description (the part that
// keeps Krea 2 on the reference style without extra LoRAs), the character, and
// backgrounds that belong to the reference's world.

const INSTRUCTION = `You analyze a character illustration so an image model can redraw the same character in the exact same art style in new scenes.
Return a single JSON object only, no markdown, with these English string fields:
- "style": 2-3 sentences on the art style only: line art (thickness, color, uniformity), coloring (flat / cel / gradient / painterly), shading amount, color palette with concrete color names, highlights, overall medium. Be concrete, e.g. "thin uniform black line art, completely flat colors with no gradients".
- "face": 1-2 sentences on how the face is drawn: eye shape, iris color, lashes, nose and mouth drawing, blush.
- "hair": 1 sentence: color, length, cut, bangs, how strands and highlights are drawn.
- "gender": "female" or "male" (the character's apparent gender).
- "body": 1 short sentence: apparent adult age and body type. Always describe an adult.
- "outfit": 1-2 sentences listing every garment and accessory with colors. If the character is nude, say "nude".
- "referencePose": 1 short phrase naming the pose in the reference image, e.g. "touching her hair with one hand, leaning against a wall".
- "referenceBackground": 1 short phrase naming the background in the reference image, e.g. "a purple brick wall with graffiti".
- "backgroundStyle": 1 sentence on how backgrounds are rendered in this style (line work, fill, palette, lighting, texture).
- "backgrounds": an array of 12 short background descriptions (8-16 words each) that fit this character's world and mood, mixing indoor and outdoor and different times of day. Never use the reference background itself.`;

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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { imageUrl?: string };
    const imageUrl = (body.imageUrl ?? "").trim();
    if (!imageUrl) {
      return NextResponse.json({ error: "캐릭터 참조 이미지가 없습니다." }, { status: 400 });
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
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const llm = await resolvePaimonLlm();
    const content = [
      { type: "text" as const, text: INSTRUCTION },
      {
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
      },
    ];

    // The vision pass occasionally returns prose or cut-off JSON; one retry is
    // cheaper than failing a 100-image batch.
    let parsed: Record<string, unknown> | null = null;
    let lastErrors: string[] = [];
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const { analysis, errors } = await analyzeWithVision(llm, content);
      lastErrors = errors;
      parsed = analysis ? parseJson(analysis) : null;
    }
    if (!parsed) {
      return NextResponse.json(
        {
          error: `비전 모델이 레퍼런스를 분석하지 못했습니다. ${lastErrors.slice(0, 2).join(" / ")}`.trim(),
        },
        { status: 502 }
      );
    }

    const analysis: ReferenceAnalysis = {
      gender: str(parsed.gender).toLowerCase() === "male" ? "male" : "female",
      style: str(parsed.style),
      face: str(parsed.face),
      hair: str(parsed.hair),
      body: str(parsed.body),
      outfit: str(parsed.outfit),
      referencePose: str(parsed.referencePose),
      referenceBackground: str(parsed.referenceBackground),
      backgroundStyle: str(parsed.backgroundStyle),
      backgrounds: Array.isArray(parsed.backgrounds)
        ? parsed.backgrounds.map(str).filter(Boolean).slice(0, 20)
        : [],
    };
    if (!analysis.style || analysis.backgrounds.length === 0) {
      return NextResponse.json(
        { error: "레퍼런스 분석 결과가 비어 있습니다. 다시 시도하세요." },
        { status: 502 }
      );
    }

    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaimonLlmError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("reference-analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "레퍼런스 분석에 실패했습니다." },
      { status: 500 }
    );
  }
}
