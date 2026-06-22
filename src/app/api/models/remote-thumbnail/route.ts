import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "image.civitai.com",
  "image-b2.civitai.com",
]);

function parseThumbnailUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid thumbnail URL");
  }

  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Unsupported thumbnail host");
  }

  return url;
}

async function proxyThumbnail(req: NextRequest, method: "GET" | "HEAD") {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim() ?? "";

  try {
    const url = parseThumbnailUrl(rawUrl);
    const upstreamHeaders = new Headers({
      Accept: "video/*,image/*,*/*",
      "User-Agent": "image-gen-model-thumbnail/1.0",
    });
    const range = req.headers.get("range");

    if (range) {
      upstreamHeaders.set("Range", range);
    }

    const upstream = await fetch(url, {
      method,
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });
    const headers = new Headers();

    [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
    ].forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    });

    headers.set("Cache-Control", "public, max-age=3600");

    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load remote thumbnail",
      },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxyThumbnail(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return proxyThumbnail(req, "HEAD");
}
