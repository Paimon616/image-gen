import "server-only";

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { hostname } from "os";
import { dirname, join } from "path";
import { fetchRunpodDesiredStatusMap, postRunpodHelper } from "@/lib/runpod";
import { readSettings, type RunpodPodSettings } from "@/lib/settings";
import {
  getCharacter,
  isValidCharacterId,
  upsertCharacter,
} from "@/lib/characters";
import {
  addFilesToWorkspace,
  addImagesToWorkspace,
  getWorkspaceFilenames,
  isValidWorkspaceId,
  listWorkspaceSummaries,
  upsertWorkspace,
} from "@/lib/workspaces";
import {
  OUTPUT_DIR,
  isValidImageFilename,
  linkImageToCharacter,
  listImagesForCharacter,
} from "@/lib/server-images";
import {
  AUDIO_OUTPUT_DIR,
  isValidAudioFilename,
  isValidVideoFilename,
  videoOutputDir,
  videoSidecarPath,
  type VideoMedia,
} from "@/lib/server-videos";
import type { Character } from "@/lib/types";

const UPLOAD_DIR = join(process.cwd(), "uploads");
// Machine-local: it maps a workspace/character to the pod it was shared to, which
// only makes sense against this machine's configured pod list (same reason
// settings live under .local/ rather than data/).
const SHARE_STATE_FILE = join(process.cwd(), ".local", "runpod-shares.json");

// Images go up one request at a time per file; a few in flight keeps a large
// workspace from taking minutes without hammering the pod's stdlib http.server.
const UPLOAD_CONCURRENCY = 3;
// A single edit in the character studio fires several PATCHes (its save is
// debounced per field). Collapse the resulting pushes into one.
const SYNC_DEBOUNCE_MS = 1500;

export type ShareKind = "workspaces" | "characters";

export function isShareKind(value: unknown): value is ShareKind {
  return value === "workspaces" || value === "characters";
}

export function isValidShareId(kind: ShareKind, id: unknown): id is string {
  return kind === "workspaces"
    ? isValidWorkspaceId(id)
    : isValidCharacterId(id);
}

export interface ShareImageEntry {
  filename: string;
  timestamp: number;
  situationId: string | null;
  // The image's metadata sidecar (generation params, civitai origin, character
  // links…), inlined so a download restores the full record without a second
  // round-trip per image.
  meta: Record<string, unknown> | null;
}

// A workspace can also hold generated videos (the ComfyUI video screen and the
// SeeDance screen share the same workspaces as the gallery), so a share carries
// them alongside the images. `media` says which output folder the file belongs
// in on the receiving machine.
export interface ShareVideoEntry {
  filename: string;
  media: VideoMedia;
  timestamp: number;
  meta: Record<string, unknown> | null;
}

// A ComfyUI video run can emit its soundtrack as a separate file that the
// video's sidecar points at; ship those too or a downloaded clip loses its audio.
export interface ShareAudioEntry {
  filename: string;
  meta: Record<string, unknown> | null;
}

export interface ShareManifest {
  kind: ShareKind;
  id: string;
  name: string;
  updatedAt: number;
  sharedBy: string;
  imageCount: number;
  /** Absent on manifests written before videos could be shared. */
  videoCount?: number;
  // Every blob stored alongside the manifest on the pod. The pod prunes files
  // that drop out of this list, so it doubles as the delete instruction.
  files: string[];
  images: ShareImageEntry[];
  videos?: ShareVideoEntry[];
  audios?: ShareAudioEntry[];
  character?: Character;
  thumbnailFile?: string | null;
  thumbnailSource?: "images" | "uploads" | null;
}

export interface ShareRecord {
  podId: string;
  name: string;
  sharedAt: number;
  syncedAt: number;
  /** Last sync failure, "" once a sync succeeds. Surfaced in the share menu. */
  error: string;
}

export interface ShareState {
  workspaces: Record<string, ShareRecord>;
  characters: Record<string, ShareRecord>;
}

// ---- Local share state ------------------------------------------------------

let stateChain: Promise<unknown> = Promise.resolve();

function normalizeRecord(raw: unknown): ShareRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.podId !== "string" || !record.podId) return null;
  return {
    podId: record.podId,
    name: typeof record.name === "string" ? record.name : "",
    sharedAt: typeof record.sharedAt === "number" ? record.sharedAt : 0,
    syncedAt: typeof record.syncedAt === "number" ? record.syncedAt : 0,
    error: typeof record.error === "string" ? record.error : "",
  };
}

function normalizeState(raw: unknown): ShareState {
  const state: ShareState = { workspaces: {}, characters: {} };
  if (!raw || typeof raw !== "object") return state;
  const record = raw as Record<string, unknown>;

  for (const kind of ["workspaces", "characters"] as const) {
    const group = record[kind];
    if (!group || typeof group !== "object") continue;
    for (const [id, value] of Object.entries(group as Record<string, unknown>)) {
      const normalized = normalizeRecord(value);
      if (normalized && isValidShareId(kind, id)) state[kind][id] = normalized;
    }
  }
  return state;
}

export async function readShareState(): Promise<ShareState> {
  try {
    return normalizeState(JSON.parse(await readFile(SHARE_STATE_FILE, "utf8")));
  } catch {
    return { workspaces: {}, characters: {} };
  }
}

// Serialized read-modify-write, matching how workspaces/characters guard their
// own JSON files against concurrent mutations.
function mutateState(
  updater: (state: ShareState) => ShareState
): Promise<ShareState> {
  const next = stateChain.then(async () => {
    const state = updater(await readShareState());
    await mkdir(dirname(SHARE_STATE_FILE), { recursive: true });
    await writeFile(SHARE_STATE_FILE, JSON.stringify(state, null, 2));
    return state;
  });
  stateChain = next.catch(() => {});
  return next;
}

async function getShareRecord(kind: ShareKind, id: string) {
  return (await readShareState())[kind][id] ?? null;
}

// ---- Pod resolution ---------------------------------------------------------

async function imagePods(): Promise<RunpodPodSettings[]> {
  const settings = await readSettings();
  return settings.runpodPods.filter((pod) => pod.kind !== "video");
}

export async function listSharePods() {
  return (await imagePods()).map((pod) => ({
    id: pod.id,
    label: pod.label || pod.podId,
    podId: pod.podId,
  }));
}

// Picks the pod a share lives on. An explicit id always wins; otherwise a lone
// configured pod is used as-is, and with several we prefer one RunPod reports as
// running (the helper is only reachable there) before falling back to the first.
export async function resolveSharePod(
  podId?: string | null
): Promise<RunpodPodSettings> {
  const pods = await imagePods();
  if (pods.length === 0) {
    throw new Error(
      "설정에 이미지용 RunPod 포드가 없습니다. 설정 화면에서 포드를 먼저 추가하세요."
    );
  }

  if (podId) {
    const match = pods.find((pod) => pod.id === podId || pod.podId === podId);
    if (!match) throw new Error("선택한 RunPod 포드를 찾을 수 없습니다.");
    return match;
  }

  if (pods.length === 1) return pods[0];

  const statusMap = await fetchRunpodDesiredStatusMap().catch(
    () => ({}) as Record<string, string>
  );
  const running = pods.find(
    (pod) => (statusMap[pod.podId] ?? "").toUpperCase() === "RUNNING"
  );
  return running ?? pods[0];
}

// A pod still running an older helper has no /share/* routes and answers 404
// "Not found." — useless on its own, so name the actual fix (the RunPod panel on
// the image screen offers a redeploy once it sees the version mismatch).
const HELPER_TOO_OLD =
  "이 포드의 RunPod 헬퍼가 오래되어 공유 기능이 없습니다. 이미지 생성 화면의 RunPod 패널에서 헬퍼를 다시 배포한 뒤 시도하세요.";

async function helperPost(
  pod: RunpodPodSettings,
  path: string,
  body: unknown
) {
  try {
    return await postRunpodHelper(pod, `/api/runpod/helper/share/${path}`, body);
  } catch (error) {
    // Exactly the router's fallback text — the share routes' own 404s say
    // "Share not found." / "Shared file not found." and must pass through.
    const message = error instanceof Error ? error.message.trim() : "";
    if (message === "Not found.") throw new Error(HELPER_TOO_OLD);
    throw error;
  }
}

// ---- Manifest building ------------------------------------------------------

function sidecarPath(filename: string) {
  return join(OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));
}

async function readSidecar(
  filename: string
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(sidecarPath(filename), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function imageEntry(
  filename: string,
  situationId: string | null = null
): Promise<ShareImageEntry | null> {
  if (!isValidImageFilename(filename)) return null;
  const info = await stat(join(OUTPUT_DIR, filename)).catch(() => null);
  if (!info?.isFile()) return null;

  const meta = await readSidecar(filename);
  return {
    filename,
    timestamp: typeof meta?.timestamp === "number" ? meta.timestamp : info.mtimeMs,
    situationId,
    meta,
  };
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function videoEntry(
  media: VideoMedia,
  filename: string
): Promise<ShareVideoEntry | null> {
  if (!isValidVideoFilename(filename)) return null;
  const info = await stat(join(videoOutputDir(media), filename)).catch(() => null);
  if (!info?.isFile()) return null;

  const meta = await readJsonFile(videoSidecarPath(media, filename));
  return {
    filename,
    media,
    timestamp: typeof meta?.timestamp === "number" ? meta.timestamp : info.mtimeMs,
    meta,
  };
}

// Pulls the audio filenames a ComfyUI video sidecar references. SeeDance clips
// carry their sound inside the mp4, so they contribute nothing here.
function audioFilenamesOf(entry: ShareVideoEntry): string[] {
  const audios = entry.meta?.audios;
  if (!Array.isArray(audios)) return [];
  return audios
    .map((audio) =>
      audio && typeof audio === "object"
        ? (audio as { filename?: unknown }).filename
        : null
    )
    .filter(
      (filename): filename is string =>
        typeof filename === "string" && isValidAudioFilename(filename)
    );
}

async function audioEntry(filename: string): Promise<ShareAudioEntry | null> {
  const info = await stat(join(AUDIO_OUTPUT_DIR, filename)).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    filename,
    meta: await readJsonFile(
      join(AUDIO_OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"))
    ),
  };
}

// The workspace is one record shared by every screen, so its share carries all
// of its media at once: the gallery images plus the ComfyUI and SeeDance clips.
async function buildWorkspaceManifest(
  workspaceId: string
): Promise<ShareManifest | null> {
  const workspace = (await listWorkspaceSummaries()).find(
    (item) => item.id === workspaceId
  );
  if (!workspace) return null;

  const filenames = [...(await getWorkspaceFilenames(workspaceId))].sort();
  const entries = await Promise.all(
    filenames.map((filename) => imageEntry(filename))
  );
  const images = entries.filter((entry): entry is ShareImageEntry =>
    Boolean(entry)
  );

  const videos: ShareVideoEntry[] = [];
  for (const media of ["videos", "seedance"] as const) {
    const names = [...(await getWorkspaceFilenames(workspaceId, media))].sort();
    const built = await Promise.all(
      names.map((filename) => videoEntry(media, filename))
    );
    for (const entry of built) if (entry) videos.push(entry);
  }

  const audioNames = Array.from(
    new Set(videos.flatMap(audioFilenamesOf))
  ).sort();
  const audios = (await Promise.all(audioNames.map(audioEntry))).filter(
    (entry): entry is ShareAudioEntry => Boolean(entry)
  );

  return {
    kind: "workspaces",
    id: workspaceId,
    name: workspace.name,
    updatedAt: Date.now(),
    sharedBy: hostname(),
    imageCount: images.length,
    videoCount: videos.length,
    files: [
      ...images.map((entry) => entry.filename),
      ...videos.map((entry) => entry.filename),
      ...audios.map((entry) => entry.filename),
    ],
    images,
    videos,
    audios,
  };
}

// Splits "/api/images/x.png" or "/api/uploads/x.png" into the directory the file
// actually lives in plus its basename. Anything else (or a traversal attempt)
// yields null so it is simply left out of the share.
function thumbnailRef(thumbnail: string | null) {
  if (!thumbnail) return null;
  for (const [prefix, source] of [
    ["/api/images/", "images"],
    ["/api/uploads/", "uploads"],
  ] as const) {
    if (!thumbnail.startsWith(prefix)) continue;
    const filename = thumbnail.slice(prefix.length).split(/[?#]/)[0];
    if (!filename || filename.includes("/") || filename.includes("..")) return null;
    return { filename, source };
  }
  return null;
}

async function buildCharacterManifest(
  characterId: string
): Promise<ShareManifest | null> {
  const character = await getCharacter(characterId);
  if (!character) return null;

  const linked = await listImagesForCharacter(characterId);
  const entries = await Promise.all(
    linked.map((image) => imageEntry(image.filename, image.situationId))
  );
  const images = entries.filter((entry): entry is ShareImageEntry =>
    Boolean(entry)
  );

  const files = images.map((entry) => entry.filename);
  const thumbnail = thumbnailRef(character.mainImage?.url ?? null);
  // The 메인 이미지 is usually one of the linked images, but it can also be an
  // image that was later unlinked (or a legacy upload) — ship it either way.
  if (thumbnail && !files.includes(thumbnail.filename)) {
    files.push(thumbnail.filename);
  }

  return {
    kind: "characters",
    id: characterId,
    name: character.name,
    updatedAt: Date.now(),
    sharedBy: hostname(),
    imageCount: images.length,
    files,
    images,
    character,
    thumbnailFile: thumbnail?.filename ?? null,
    thumbnailSource: thumbnail?.source ?? null,
  };
}

function buildManifest(kind: ShareKind, id: string) {
  return kind === "workspaces"
    ? buildWorkspaceManifest(id)
    : buildCharacterManifest(id);
}

// Every file in a manifest is uploaded from a different folder depending on what
// it is, so resolve each one up front rather than guessing from its name.
function buildLocalFileIndex(manifest: ShareManifest) {
  const index = new Map<string, string>();

  for (const entry of manifest.images ?? []) {
    index.set(entry.filename, join(OUTPUT_DIR, entry.filename));
  }
  for (const entry of manifest.videos ?? []) {
    index.set(entry.filename, join(videoOutputDir(entry.media), entry.filename));
  }
  for (const entry of manifest.audios ?? []) {
    index.set(entry.filename, join(AUDIO_OUTPUT_DIR, entry.filename));
  }
  if (manifest.thumbnailFile) {
    index.set(
      manifest.thumbnailFile,
      join(
        manifest.thumbnailSource === "uploads" ? UPLOAD_DIR : OUTPUT_DIR,
        manifest.thumbnailFile
      )
    );
  }
  return index;
}

// ---- Push (share / re-sync) -------------------------------------------------

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
    async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await worker(item);
      }
    }
  );
  await Promise.all(runners);
}

export async function pushShare(
  kind: ShareKind,
  id: string,
  podId?: string | null
) {
  const existing = await getShareRecord(kind, id);
  const pod = await resolveSharePod(podId ?? existing?.podId ?? null);
  const manifest = await buildManifest(kind, id);
  if (!manifest) {
    throw new Error(
      kind === "workspaces"
        ? "워크스페이스를 찾을 수 없습니다."
        : "캐릭터를 찾을 수 없습니다."
    );
  }

  // The pod answers with the files it doesn't have yet, so a re-sync after a
  // rename or a single new image costs one request plus that one image.
  const response = await helperPost(pod, "manifest", { kind, id, manifest });
  const missing = Array.isArray(response.missing)
    ? response.missing.map(String)
    : [];

  const fileIndex = buildLocalFileIndex(manifest);
  let uploaded = 0;
  await runPool(missing, async (filename) => {
    const buffer = await readFile(
      fileIndex.get(filename) ?? join(OUTPUT_DIR, filename)
    ).catch(() => null);
    if (!buffer) return;
    await helperPost(pod, "put", {
      kind,
      id,
      filename,
      data: buffer.toString("base64"),
    });
    uploaded += 1;
  });

  const now = Date.now();
  await mutateState((state) => ({
    ...state,
    [kind]: {
      ...state[kind],
      [id]: {
        podId: pod.id,
        name: manifest.name,
        sharedAt: existing?.sharedAt ?? now,
        syncedAt: now,
        error: "",
      },
    },
  }));

  return {
    pod,
    manifest,
    uploaded,
    imageCount: manifest.imageCount,
    videoCount: manifest.videoCount ?? 0,
  };
}

// Deletes a share straight off the given pod, whoever pushed it — the download
// picker's "제거" button. Unlike unshare(), a dead pod is a hard error here: the
// user is looking at the pod's list and expects the row to actually disappear.
// If this machine's own record points at that pod, drop it too so auto-sync
// doesn't immediately re-push the share.
export async function deleteRemoteShare(
  kind: ShareKind,
  id: string,
  podId?: string | null
) {
  const pod = await resolveSharePod(podId);
  await helperPost(pod, "delete", { kind, id });

  await mutateState((state) => {
    if (state[kind][id]?.podId !== pod.id) return state;
    const group = { ...state[kind] };
    delete group[id];
    return { ...state, [kind]: group };
  });

  return pod;
}

export async function unshare(kind: ShareKind, id: string) {
  const record = await getShareRecord(kind, id);
  if (record) {
    // Best effort: a stopped pod shouldn't block dropping the local record, or
    // the share would be stuck "shared" forever.
    await resolveSharePod(record.podId)
      .then((pod) => helperPost(pod, "delete", { kind, id }))
      .catch(() => {});
  }

  await mutateState((state) => {
    const group = { ...state[kind] };
    delete group[id];
    return { ...state, [kind]: group };
  });

  return Boolean(record);
}

// ---- Pull (download) --------------------------------------------------------

export async function listRemoteShares(kind: ShareKind, podId?: string | null) {
  const pod = await resolveSharePod(podId);
  const response = await helperPost(pod, "list", { kind });
  const items = Array.isArray(response.items) ? response.items : [];
  return {
    pod,
    items: items.filter(
      (item): item is ShareManifest =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as ShareManifest).id === "string"
    ),
  };
}

async function downloadShareFile(
  pod: RunpodPodSettings,
  kind: ShareKind,
  id: string,
  filename: string,
  target: string
) {
  // Image filenames are uuids, so a name that already exists locally is the same
  // image — skip the transfer rather than re-downloading megabytes.
  if (await stat(target).then((info) => info.isFile()).catch(() => false)) {
    return false;
  }

  const response = await helperPost(pod, "file", { kind, id, filename });
  if (typeof response.data !== "string") return false;

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(response.data, "base64"));
  return true;
}

// Restores an image's metadata sidecar. An image that is already local keeps its
// own sidecar (it may have local workspace/character links the sharer never had).
async function writeSidecarIfMissing(entry: ShareImageEntry) {
  const path = sidecarPath(entry.filename);
  if (await stat(path).then((info) => info.isFile()).catch(() => false)) return;

  const meta: Record<string, unknown> = { ...(entry.meta ?? {}) };
  if (typeof meta.id !== "string") meta.id = entry.filename;
  meta.filename = entry.filename;
  if (typeof meta.timestamp !== "number") meta.timestamp = entry.timestamp;
  await writeFile(path, JSON.stringify(meta, null, 2));
}

// Same rule as the image sidecar: a file that is already on this machine keeps
// its own sidecar, which may hold local edits the sharer never had.
async function writeVideoSidecarIfMissing(entry: ShareVideoEntry) {
  const path = videoSidecarPath(entry.media, entry.filename);
  if (await stat(path).then((info) => info.isFile()).catch(() => false)) return;

  const meta: Record<string, unknown> = { ...(entry.meta ?? {}) };
  if (typeof meta.id !== "string") meta.id = entry.filename;
  meta.filename = entry.filename;
  if (typeof meta.timestamp !== "number") meta.timestamp = entry.timestamp;
  // The url is machine-local, so re-derive it rather than trusting the sharer's.
  meta.url =
    entry.media === "seedance"
      ? `/api/seedance/videos/${entry.filename}`
      : `/api/videos/${entry.filename}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(meta, null, 2));
}

async function writeAudioSidecarIfMissing(entry: ShareAudioEntry) {
  if (!entry.meta) return;
  const path = join(
    AUDIO_OUTPUT_DIR,
    entry.filename.replace(/\.\w+$/, ".json")
  );
  if (await stat(path).then((info) => info.isFile()).catch(() => false)) return;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entry.meta, null, 2));
}

async function fetchManifest(
  pod: RunpodPodSettings,
  kind: ShareKind,
  id: string
) {
  const response = await helperPost(pod, "get", { kind, id });
  const manifest = response.manifest as ShareManifest | undefined;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("공유 정보를 읽을 수 없습니다.");
  }
  return manifest;
}

export async function pullShare(
  kind: ShareKind,
  id: string,
  podId?: string | null
) {
  const pod = await resolveSharePod(podId);
  const manifest = await fetchManifest(pod, kind, id);
  const images = Array.isArray(manifest.images) ? manifest.images : [];

  let downloaded = 0;
  await runPool(images, async (entry) => {
    if (!entry || !isValidImageFilename(entry.filename)) return;
    const added = await downloadShareFile(
      pod,
      kind,
      id,
      entry.filename,
      join(OUTPUT_DIR, entry.filename)
    );
    if (added) downloaded += 1;
    await writeSidecarIfMissing(entry);
  });

  const filenames = images
    .filter((entry) => entry && isValidImageFilename(entry.filename))
    .map((entry) => entry.filename);

  if (kind === "workspaces") {
    const workspace = await upsertWorkspace(
      id,
      manifest.name || "공유 워크스페이스"
    );
    await addImagesToWorkspace(filenames, id);

    // The clips land in the folder their own screen reads from, and each one is
    // added to the workspace under that media so the video / SeeDance galleries
    // pick it up on their next refresh.
    const videos = (Array.isArray(manifest.videos) ? manifest.videos : []).filter(
      (entry): entry is ShareVideoEntry =>
        Boolean(entry) &&
        isValidVideoFilename(entry.filename) &&
        (entry.media === "videos" || entry.media === "seedance")
    );

    await runPool(videos, async (entry) => {
      const added = await downloadShareFile(
        pod,
        kind,
        id,
        entry.filename,
        join(videoOutputDir(entry.media), entry.filename)
      );
      if (added) downloaded += 1;
      await writeVideoSidecarIfMissing(entry);
    });

    // Soundtracks a ComfyUI run wrote next to the clip, so a downloaded video
    // keeps the audio its sidecar points at.
    const audios = (Array.isArray(manifest.audios) ? manifest.audios : []).filter(
      (entry): entry is ShareAudioEntry =>
        Boolean(entry) && isValidAudioFilename(entry.filename)
    );
    await runPool(audios, async (entry) => {
      const added = await downloadShareFile(
        pod,
        kind,
        id,
        entry.filename,
        join(AUDIO_OUTPUT_DIR, entry.filename)
      );
      if (added) downloaded += 1;
      await writeAudioSidecarIfMissing(entry);
    });

    for (const media of ["videos", "seedance"] as const) {
      const names = videos
        .filter((entry) => entry.media === media)
        .map((entry) => entry.filename);
      if (names.length > 0) await addFilesToWorkspace(media, names, id);
    }

    return {
      pod,
      name: workspace.name,
      downloaded,
      imageCount: filenames.length,
      videoCount: videos.length,
    };
  }

  const thumbnail = manifest.thumbnailFile;
  if (thumbnail && manifest.thumbnailSource === "uploads") {
    await downloadShareFile(
      pod,
      kind,
      id,
      thumbnail,
      join(UPLOAD_DIR, thumbnail)
    ).catch(() => false);
  } else if (thumbnail) {
    await downloadShareFile(
      pod,
      kind,
      id,
      thumbnail,
      join(OUTPUT_DIR, thumbnail)
    ).catch(() => false);
  }

  const character = await upsertCharacter(manifest.character);
  if (!character) throw new Error("공유된 캐릭터 정보를 저장하지 못했습니다.");

  // Re-link the downloaded images to this character/situation. Sidecars that
  // already existed locally get their link written here rather than overwritten
  // wholesale, so nothing else in them is lost.
  for (const entry of images) {
    if (!entry?.situationId || !isValidImageFilename(entry.filename)) continue;
    await linkImageToCharacter(id, entry.situationId, entry.filename).catch(
      () => false
    );
  }

  return {
    pod,
    name: character.name,
    downloaded,
    imageCount: filenames.length,
    videoCount: 0,
  };
}

// ---- Auto-sync --------------------------------------------------------------

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function runSync(kind: ShareKind, id: string) {
  try {
    await pushShare(kind, id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "RunPod 동기화에 실패했습니다.";
    await mutateState((state) => {
      const record = state[kind][id];
      if (!record) return state;
      return {
        ...state,
        [kind]: { ...state[kind], [id]: { ...record, error: message } },
      };
    }).catch(() => ({ workspaces: {}, characters: {} }) as ShareState);
  }
}

// Fire-and-forget re-push of one share, debounced. Nothing is queued for a
// workspace/character that was never shared, so this is free in the common case.
export function queueShareSync(kind: ShareKind, id: string) {
  const key = `${kind}:${id}`;
  const existing = syncTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    syncTimers.delete(key);
    void runSync(kind, id);
  }, SYNC_DEBOUNCE_MS);
  // Don't hold the process open just for a pending sync.
  timer.unref?.();
  syncTimers.set(key, timer);
}

async function queueAllShared(kinds: ShareKind[]) {
  const state = await readShareState();
  for (const kind of kinds) {
    for (const id of Object.keys(state[kind])) queueShareSync(kind, id);
  }
}

// Called whenever a file's workspace membership changes (assignment edit, a
// fresh generation landing in a workspace, or a deletion) — images and videos
// alike. Re-pushing every shared workspace is one cheap manifest request each —
// the pod answers with what it is missing, so unchanged shares transfer no bytes.
export function notifyWorkspaceFilesChanged() {
  void queueAllShared(["workspaces"]).catch(() => {});
}

/** @deprecated Use {@link notifyWorkspaceFilesChanged}; kept for the image routes. */
export const notifyWorkspaceImagesChanged = notifyWorkspaceFilesChanged;

// An image deletion can affect a shared workspace *and* a shared character's
// situation strip, so both are refreshed.
export function notifyImageDeleted() {
  void queueAllShared(["workspaces", "characters"]).catch(() => {});
}

export async function notifyCharacterChanged(characterId: string) {
  const record = await getShareRecord("characters", characterId).catch(
    () => null
  );
  if (record) queueShareSync("characters", characterId);
}

export async function notifyWorkspaceChanged(workspaceId: string) {
  const record = await getShareRecord("workspaces", workspaceId).catch(
    () => null
  );
  if (record) queueShareSync("workspaces", workspaceId);
}
