import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";

const AUDIO_OUTPUT_DIR = join(process.cwd(), "output", "audios");

function contentTypeFor(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  return "audio/wav";
}

export async function GET() {
  try {
    const files = await readdir(AUDIO_OUTPUT_DIR).catch(() => [] as string[]);
    const audioFiles = files.filter((file) =>
      /\.(wav|mp3|flac|m4a|aac|ogg|opus)$/i.test(file)
    );

    const audios = await Promise.all(
      audioFiles.map(async (filename) => {
        const metaPath = join(AUDIO_OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));

        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));

          return {
            id: meta.id,
            url: `/api/audios/${filename}`,
            filename,
            params: meta.params,
            timestamp: meta.timestamp,
            contentType: meta.contentType ?? contentTypeFor(filename),
          };
        } catch {
          return {
            id: filename,
            url: `/api/audios/${filename}`,
            filename,
            params: null,
            timestamp: 0,
            contentType: contentTypeFor(filename),
          };
        }
      })
    );

    audios.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ audios });
  } catch {
    return NextResponse.json({ audios: [] });
  }
}
