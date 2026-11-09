import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import sharp from "sharp";
import {
  analyzeWithVision,
  PaimonLlmError,
  resolvePaimonLlm,
} from "@/lib/paimon-llm";

export const dynamic = "force-dynamic";

// Turns an image URL (or a page URL that points at one) into a local upload the
// generator can use as character_image. With `describe`, a vision model also
// writes an English prompt that recreates the picture, for the "copy" button.

const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_BYTES = 30 * 1024 * 1024;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const DESCRIBE_INSTRUCTION = `You write prompts for the Krea-2 image model, which reads plain English sentences (not tag lists).
Describe this image so the model can redraw it as closely as possible. Cover, in this order:
1. Art style and rendering (anime / cel-shaded / painterly / 3D / photo, line art, shading, color grading, lighting).
2. The character: apparent adult age, hair color, length and style, eye color, face, body type.
3. Outfit and accessories in detail (every garment, colors, materials), or state nudity plainly if the subject is nude.
4. Pose, hand positions, head direction and facial expression.
5. Camera: shot type, angle and framing.
6. Background and props.
Write one paragraph of 120-220 words. Output only the prompt text, no headings, no quotes, no preamble.`;

class ReferenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isCivitaiUrl(url: URL) {
  return /(^|\.)civitai\.(com|red|green)$/i.test(url.hostname) && /\/images\/\d+/.test(url.pathname);
}

function metaContent(html: string, keys: string[]) {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1].replace(/&amp;/g, "&").trim();
    }
  }
  return null;
}

async function fetchUrl(url: string, accept: string) {
  try {
    return await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code ?? error.message : "";
    throw new ReferenceError(`URL에 접속하지 못했습니다 (${reason || "network error"}).`, 502);
  }
}

function blockedMessage(status: number) {
  return `이 사이트는 페이지 주소로는 가져올 수 없습니다 (봇 차단, HTTP ${status}). 브라우저에서 이미지를 이 칸으로 끌어다 놓거나, 이미지 우클릭 → '이미지 복사' 후 이 칸에 Ctrl+V, 또는 '이미지 주소 복사'한 주소를 넣으세요.`;
}

async function readImage(response: Response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new ReferenceError("이미지가 30MB보다 큽니다.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new ReferenceError("이미지가 30MB보다 큽니다.");
  return buffer;
}

// Resolves the URL to image bytes plus whatever prompt text the source publishes.
async function resolveImage(rawUrl: string, origin: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ReferenceError("올바른 URL이 아닙니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReferenceError("http(s) URL만 쓸 수 있습니다.");
  }

  let sourcePrompt: string | null = null;
  let imageUrl = url.toString();

  if (isCivitaiUrl(url)) {
    const res = await fetch(`${origin}/api/civitai/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      imageUrl?: string;
      params?: { prompt?: string };
      error?: string;
    };
    if (!res.ok || !data.imageUrl) {
      throw new ReferenceError(data.error || "Civitai 이미지를 찾지 못했습니다.", 502);
    }
    imageUrl = data.imageUrl;
    sourcePrompt = data.params?.prompt?.trim() || null;
  }

  let response = await fetchUrl(imageUrl, "image/avif,image/webp,image/*,text/html;q=0.8,*/*;q=0.5");
  if (!response.ok) throw new ReferenceError(blockedMessage(response.status), 502);

  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    const html = await response.text();
    const ogImage = metaContent(html, ["og:image", "twitter:image", "og:image:url"]);
    if (!ogImage) {
      throw new ReferenceError(
        "페이지에서 이미지를 찾지 못했습니다. 이미지 위를 우클릭 → '이미지 주소 복사'로 이미지 파일 주소를 붙여넣으세요."
      );
    }
    sourcePrompt ??= metaContent(html, ["og:description", "description"]);
    imageUrl = new URL(ogImage, imageUrl).toString();
    response = await fetchUrl(imageUrl, "image/*");
    if (!response.ok) throw new ReferenceError(blockedMessage(response.status), 502);
  }

  const buffer = await readImage(response);
  return { buffer, sourcePrompt, imageUrl };
}

async function describeImage(buffer: Buffer) {
  // Keep the upload to the vision model small; detail past ~1MP adds nothing.
  const jpeg = await sharp(buffer)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const llm = await resolvePaimonLlm();
  const { analysis, errors } = await analyzeWithVision(llm, [
    { type: "text", text: DESCRIBE_INSTRUCTION },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
  ]);
  if (!analysis) {
    throw new ReferenceError(
      `비전 모델이 이미지를 설명하지 못했습니다. ${errors.slice(0, 2).join(" / ")}`.trim(),
      502
    );
  }
  return analysis.replace(/^["']|["']$/g, "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string; describe?: boolean };
    const rawUrl = (body.url ?? "").trim();
    if (!rawUrl) throw new ReferenceError("URL을 입력하세요.");

    const { buffer, sourcePrompt, imageUrl } = await resolveImage(rawUrl, req.nextUrl.origin);

    let image: sharp.Sharp;
    let meta: sharp.Metadata;
    try {
      image = sharp(buffer, { animated: false }).rotate();
      meta = await image.metadata();
    } catch {
      throw new ReferenceError("이미지 파일이 아닙니다. 이미지 파일 주소를 넣어주세요.");
    }
    if (!meta.width || !meta.height) {
      throw new ReferenceError("이미지 크기를 읽지 못했습니다.");
    }
    const swap = (meta.orientation ?? 1) >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;

    // Always store a PNG so ComfyUI gets a format it reads, whatever the source was
    // (webp / avif / gif first frame).
    const filename = `${randomUUID()}.png`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, filename), await image.png().toBuffer());

    const prompt = body.describe ? await describeImage(buffer) : null;

    return NextResponse.json(
      {
        url: `${req.nextUrl.origin}/api/uploads/${filename}`,
        sourceImageUrl: imageUrl,
        width,
        height,
        sourcePrompt,
        prompt,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof ReferenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PaimonLlmError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("reference-from-url error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "이미지를 가져오지 못했습니다." },
      { status: 500 }
    );
  }
}
