import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import {
  analyzeWithVision,
  PaimonLlmError,
  resolvePaimonLlm,
} from "@/lib/paimon-llm";

export const dynamic = "force-dynamic";

// Writes an image-to-video motion prompt for one start frame: the picture stays
// exactly as it is (face, hair, outfit, art style, background, framing) and the
// character does one small natural action for the clip length. Used by the
// image gallery's "N초 영상" batch button.

const INSTRUCTION = `This image is the first frame of a SECONDS-second image-to-video clip. Write the motion prompt for it.
Rules:
- Frame 0 is this exact image. Keep the same character identity, face, hair, eye colors, body, outfit, art style, colors, lighting and background through the whole clip. Never restyle, re-stage or change the outfit.
- Mention ONLY what you can clearly see in this image. Never add body parts, features, accessories, objects, animals or people that are not visible: no animal ears, tail, wings, horns or halo unless they are clearly drawn in the image. If unsure whether something is there, leave it out.
- Describe one natural, calm action that fits the pose, expression and place in the image and fits in SECONDS seconds: e.g. breathing, blinking, a soft smile spreading, tilting the head, brushing hair behind an ear, shifting weight, turning slightly toward the viewer, reaching for an object already in the image. One clear action arc, not a list.
- Add small secondary motion only for things visible in the image (hair, fabric, steam, leaves, water, candle light, or animal ears / tail only if the character clearly has them).
- Camera: static or a very slow push-in. No cuts, no new characters, no scene change.
- Write 3 to 5 English sentences of plain natural language (no tags, no markdown, no quotes), starting with the subject and the action, ending with how the clip ends.
Reply with the prompt text only.`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      imageUrl?: string;
      seconds?: number;
    };
    const imageUrl = (body.imageUrl ?? "").trim();
    const seconds = Math.min(20, Math.max(1, Math.round(Number(body.seconds) || 5)));
    if (!imageUrl) {
      return NextResponse.json({ error: "이미지가 없습니다." }, { status: 400 });
    }

    const source = imageUrl.startsWith("/") ? `${req.nextUrl.origin}${imageUrl}` : imageUrl;
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `이미지를 읽지 못했습니다 (HTTP ${res.status}).` },
        { status: 502 }
      );
    }
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const llm = await resolvePaimonLlm();
    const { analysis, errors } = await analyzeWithVision(
      llm,
      [
        { type: "text", text: INSTRUCTION.replaceAll("SECONDS", String(seconds)) },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
        },
      ],
      { maxTokens: 600, timeoutMs: 45_000 }
    );
    const prompt = (analysis ?? "")
      .replace(/```[a-z]*|```/gi, "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim();
    if (!prompt) {
      return NextResponse.json(
        { error: `동작 프롬프트를 만들지 못했습니다. ${errors.slice(0, 2).join(" / ")}`.trim() },
        { status: 502 }
      );
    }
    return NextResponse.json({ prompt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaimonLlmError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("motion-prompt error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "동작 프롬프트 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
