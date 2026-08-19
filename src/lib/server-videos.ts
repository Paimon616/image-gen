import { readdir } from "fs/promises";
import { join } from "path";
import type { WorkspaceMedia } from "@/lib/types";

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
