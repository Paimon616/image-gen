import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import type { CharacterSituationVideo, WorkspaceMedia } from "@/lib/types";

export type { CharacterSituationVideo } from "@/lib/types";

// The two video screens write to their own output folders, so a workspace's
// membership map is keyed per media and every lookup starts from here.
export const VIDEO_OUTPUT_DIR = join(process.cwd(), "output", "videos");
export const SEEDANCE_OUTPUT_DIR = join(process.cwd(), "output", "seedance");
// ComfyUI video runs can emit a separate audio track next to the clip; the
// video's sidecar references it, so a share has to carry it too.
export const AUDIO_OUTPUT_DIR = join(process.cwd(), "output", "audios");

const VIDEO_FILENAME_PATTERN = /^[^\\/]+\.(?:mp4|webm|gif)$/i;
const AUDIO_FILENAME_PATTERN = /^[^\\/]+\.(?:mp3|wav|flac|m4a|ogg|opus)$/i;

export type VideoMedia = Extract<WorkspaceMedia, "videos" | "seedance">;

export function isVideoMedia(value: unknown): value is VideoMedia {
  return value === "videos" || value === "seedance";
}

export function videoOutputDir(media: VideoMedia) {
  return media === "seedance" ? SEEDANCE_OUTPUT_DIR : VIDEO_OUTPUT_DIR;
}

export function videoUrl(media: VideoMedia, filename: string) {
  return media === "seedance"
    ? `/api/seedance/videos/${filename}`
    : `/api/videos/${filename}`;
}

export function isValidVideoFilename(filename: string) {
  return VIDEO_FILENAME_PATTERN.test(filename) && !filename.includes("..");
}

export function isValidAudioFilename(filename: string) {
  return AUDIO_FILENAME_PATTERN.test(filename) && !filename.includes("..");
}

export function videoContentType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".gif")) return "image/gif";
  return "video/mp4";
}

export async function listVideoFilenames(media: VideoMedia): Promise<string[]> {
  const files = await readdir(videoOutputDir(media)).catch(() => [] as string[]);
  return files.filter(isValidVideoFilename);
}

// The sidecar holding a clip's params sits next to it under the same stem.
export function videoSidecarPath(media: VideoMedia, filename: string) {
  return join(videoOutputDir(media), filename.replace(/\.\w+$/, ".json"));
}

const VIDEO_MEDIAS: VideoMedia[] = ["videos", "seedance"];

// Scans one media folder's metadata sidecars for clips tagged with a character
// id. Sidecar-only (the small `{id}.json` files), mirroring the image scanner.
async function listMediaVideosForCharacter(
  media: VideoMedia,
  characterId: string
): Promise<CharacterSituationVideo[]> {
  const dir = videoOutputDir(media);
  const files = await readdir(dir).catch(() => [] as string[]);
  const sidecars = files.filter((name) => name.endsWith(".json"));

  const results = await Promise.all(
    sidecars.map(async (name) => {
      try {
        const meta = JSON.parse(await readFile(join(dir, name), "utf-8"));
        if (
          meta?.character_id !== characterId ||
          typeof meta?.filename !== "string" ||
          !isValidVideoFilename(meta.filename)
        ) {
          return null;
        }
        // Confirm the clip file still exists (a deleted clip leaves no file).
        const info = await stat(join(dir, meta.filename)).catch(() => null);
        if (!info?.isFile()) return null;

        return {
          id: typeof meta.id === "string" ? meta.id : meta.filename,
          media,
          filename: meta.filename,
          url: videoUrl(media, meta.filename),
          situationId:
            typeof meta.situation_id === "string" ? meta.situation_id : null,
          timestamp:
            typeof meta.timestamp === "number" ? meta.timestamp : info.mtimeMs,
        } satisfies CharacterSituationVideo;
      } catch {
        return null;
      }
    })
  );

  return results.filter((item): item is CharacterSituationVideo =>
    Boolean(item)
  );
}

// Every clip generated for (or linked to) a character across both video
// surfaces, newest first, each carrying its situation id so the character
// studio can group clips under each situation — the video counterpart of
// listImagesForCharacter.
export async function listVideosForCharacter(
  characterId: string
): Promise<CharacterSituationVideo[]> {
  const perMedia = await Promise.all(
    VIDEO_MEDIAS.map((media) => listMediaVideosForCharacter(media, characterId))
  );
  return perMedia.flat().sort((a, b) => b.timestamp - a.timestamp);
}

// Links an existing clip to a character/situation by writing the ids into its
// metadata sidecar — the same fields the generators write when a Paimon
// situation run produces the clip, so a linked clip shows up in the situation
// strip exactly like a generated one. Clips without a (readable) sidecar get a
// minimal one created here so the link can still be stored.
export async function linkVideoToCharacter(
  media: VideoMedia,
  characterId: string,
  situationId: string,
  filename: string
): Promise<boolean> {
  if (!isValidVideoFilename(filename)) return false;

  const info = await stat(join(videoOutputDir(media), filename)).catch(
    () => null
  );
  if (!info?.isFile()) return false;

  const metaPath = videoSidecarPath(media, filename);
  const raw = await readFile(metaPath, "utf-8").catch(() => null);

  let meta: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // Unreadable sidecar: fall through and rewrite it from scratch.
    }
  }

  if (typeof meta.id !== "string") meta.id = filename;
  meta.filename = filename;
  if (typeof meta.timestamp !== "number") meta.timestamp = info.mtimeMs;
  meta.character_id = characterId;
  meta.situation_id = situationId;
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return true;
}

// Clears the character/situation link on a clip's sidecar so it leaves that
// situation, without deleting the clip. Only unlinks when the sidecar actually
// belongs to the given character (guards against stale ids).
export async function unlinkVideoFromCharacter(
  media: VideoMedia,
  characterId: string,
  filename: string
): Promise<boolean> {
  if (!isValidVideoFilename(filename)) return false;

  const metaPath = videoSidecarPath(media, filename);
  const raw = await readFile(metaPath, "utf-8").catch(() => null);
  if (!raw) return false;

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(raw);
  } catch {
    return false;
  }

  if (meta.character_id !== characterId) return false;

  delete meta.character_id;
  delete meta.situation_id;
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return true;
}
