import { createWriteStream } from "fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { basename, extname, join, normalize } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextRequest, NextResponse } from "next/server";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".safetensors"]);
const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  [`Comfy${"UI"}`, "models"].join("/");
const MODEL_CATALOG_PATH = "data/model-catalog.json";
const CIVITAI_API_BASE = "https://civitai.com/api/v1";

interface LocalModelMetadata {
  name: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
}

interface CivitaiFile {
  id: number;
  name: string;
  type: string;
  primary?: boolean;
  sizeKB?: number;
  downloadUrl?: string;
  hashes?: {
    SHA256?: string;
    AutoV2?: string;
  };
  metadata?: {
    format?: string;
    size?: string;
    fp?: string;
  };
}

interface CivitaiModelVersion {
  id: number;
  modelId: number;
  name: string;
  baseModel?: string;
  description?: string | null;
  trainedWords?: string[];
  model?: {
    name?: string;
    type?: string;
    nsfw?: boolean;
  };
  files?: CivitaiFile[];
  images?: Array<{
    url?: string;
    type?: string;
    nsfwLevel?: number;
  }>;
}

interface CivitaiImportFile {
  id: number;
  name: string;
  type: string;
  primary: boolean;
  sizeKB: number | null;
  downloadUrl: string | null;
  sha256: string | null;
  format: string;
  precision: string;
  localPath: string | null;
  isDownloaded: boolean;
}

const DEFAULT_MODEL_CATALOG: Record<string, LocalModelMetadata> = {
  "checkpoints/waiIllustriousSDXL_v140.safetensors": {
    name: "WAI-illustrious-SDXL",
    version: "v1.4.0",
    base_model: "Illustrious / SDXL",
    thumbnail_url: null,
  },
  "loras/p0nyd1sney1ncasev1x0n2-v2.safetensors": {
    name: "Incase + Vixon's Gothic Neon + Disney Style",
    version: "v2",
    base_model: "Pony / Illustrious",
    thumbnail_url: null,
  },
  "loras/vcalicia-anima-nvwls-v1.safetensors": {
    name: "VCalicia Anima NVWLS",
    version: "v1",
    base_model: "Illustrious",
    thumbnail_url: null,
  },
};

function civitaiHeaders() {
  const token = process.env.CIVITAI_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function extractModelVersionId(input: string) {
  try {
    const url = new URL(input);
    const fromQuery = url.searchParams.get("modelVersionId");
    if (fromQuery) return fromQuery;

    const apiMatch = url.pathname.match(/\/model-versions\/(\d+)/);
    if (apiMatch) return apiMatch[1];
  } catch {
    return /^\d+$/.test(input.trim()) ? input.trim() : null;
  }

  return /^\d+$/.test(input.trim()) ? input.trim() : null;
}

function folderForModelType(type?: string) {
  const normalized = (type ?? "").toLowerCase();
  if (normalized.includes("lora")) return "loras";
  if (normalized.includes("textual") || normalized.includes("embedding")) {
    return "embeddings";
  }
  if (normalized.includes("controlnet")) return "controlnet";
  if (normalized.includes("vae")) return "vae";
  return "checkpoints";
}

function safeFilename(name: string) {
  return basename(name).replace(/[^\w .@()[\]+-]/g, "_").trim();
}

function hasModelExtension(filename: string) {
  return MODEL_EXTENSIONS.has(extname(filename).toLowerCase());
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      LocalModelMetadata
    >;
  } catch {
    return DEFAULT_MODEL_CATALOG;
  }
}

async function writeCatalog(catalog: Record<string, LocalModelMetadata>) {
  await mkdir("data", { recursive: true });
  await writeFile(MODEL_CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

async function listFilesRecursive(root: string, prefix = ""): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) return listFilesRecursive(fullPath, relativePath);
        return [relativePath];
      })
    );

    return files.flat();
  } catch {
    return [];
  }
}

async function findLocalModelPath(folder: string, filename: string) {
  const root = join(COMFYUI_MODELS_DIR, folder);
  const files = await listFilesRecursive(root);
  const match = files.find((file) => basename(file) === filename);
  return match ?? null;
}

async function fetchVersion(input: string) {
  const versionId = extractModelVersionId(input);
  if (!versionId) {
    throw new Error("Civitai URL에서 modelVersionId를 찾지 못했습니다.");
  }

  const res = await fetch(`${CIVITAI_API_BASE}/model-versions/${versionId}`, {
    headers: civitaiHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Civitai 조회 실패: ${res.status}`);
  }

  return (await res.json()) as CivitaiModelVersion;
}

async function buildImportInfo(version: CivitaiModelVersion) {
  const folder = folderForModelType(version.model?.type);
  const files = await Promise.all(
    (version.files ?? [])
      .filter((file) => file.type === "Model" && hasModelExtension(file.name))
      .map(async (file): Promise<CivitaiImportFile> => {
        const filename = safeFilename(file.name);
        const localPath = await findLocalModelPath(folder, filename);

        return {
          id: file.id,
          name: filename,
          type: file.type,
          primary: Boolean(file.primary),
          sizeKB: file.sizeKB ?? null,
          downloadUrl: file.downloadUrl ?? null,
          sha256: file.hashes?.SHA256 ?? null,
          format: file.metadata?.format ?? "",
          precision: file.metadata?.fp ?? "",
          localPath,
          isDownloaded: Boolean(localPath),
        };
      })
  );

  return {
    id: version.id,
    modelId: version.modelId,
    name: version.model?.name ?? `Civitai ${version.modelId}`,
    version: version.name,
    type: version.model?.type ?? "Checkpoint",
    folder,
    baseModel: version.baseModel ?? "",
    description: version.description ?? "",
    trainedWords: version.trainedWords ?? [],
    nsfw: Boolean(version.model?.nsfw),
    thumbnailUrl: version.images?.find((image) => image.url)?.url ?? null,
    files,
  };
}

function downloadUrlWithToken(downloadUrl: string) {
  const token = process.env.CIVITAI_API_TOKEN;
  if (!token) return downloadUrl;

  const url = new URL(downloadUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

async function saveCatalogEntry(
  folder: string,
  path: string,
  version: CivitaiModelVersion
) {
  const catalog = await readCatalog();
  catalog[`${folder}/${path}`] = {
    name: version.model?.name ?? basename(path, extname(path)),
    version: version.name,
    base_model: version.baseModel ?? "",
    thumbnail_url: version.images?.find((image) => image.url)?.url ?? null,
  };
  await writeCatalog(catalog);
}

async function downloadFile(version: CivitaiModelVersion, fileId?: number) {
  const folder = folderForModelType(version.model?.type);
  const modelFiles = (version.files ?? []).filter(
    (file) => file.type === "Model" && hasModelExtension(file.name)
  );
  const selectedFile =
    modelFiles.find((file) => file.id === fileId) ??
    modelFiles.find((file) => file.primary) ??
    modelFiles[0];

  if (!selectedFile?.downloadUrl) {
    throw new Error("다운로드 가능한 모델 파일을 찾지 못했습니다.");
  }

  const filename = safeFilename(selectedFile.name);
  const existingPath = await findLocalModelPath(folder, filename);
  if (existingPath) {
    await saveCatalogEntry(folder, existingPath, version);
    return { downloaded: false, folder, path: existingPath };
  }

  const folderRoot = join(COMFYUI_MODELS_DIR, folder);
  await mkdir(folderRoot, { recursive: true });

  const targetPath = normalize(join(folderRoot, filename));
  if (!targetPath.startsWith(folderRoot)) {
    throw new Error("잘못된 파일 경로입니다.");
  }

  const tempPath = `${targetPath}.download`;
  const res = await fetch(downloadUrlWithToken(selectedFile.downloadUrl), {
    headers: civitaiHeaders(),
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    throw new Error(`다운로드 실패: ${res.status}`);
  }

  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(tempPath)
    );
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  await saveCatalogEntry(folder, filename, version);
  return { downloaded: true, folder, path: filename };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url?: string;
      action?: "preview" | "download";
      fileId?: number;
    };

    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const version = await fetchVersion(body.url);

    if (body.action === "download") {
      const result = await downloadFile(version, body.fileId);
      const info = await buildImportInfo(version);
      return NextResponse.json({ ok: true, result, model: info });
    }

    return NextResponse.json({ ok: true, model: await buildImportInfo(version) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Civitai import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
