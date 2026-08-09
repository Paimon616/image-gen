import { access, readFile } from "fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_ROOT = process.cwd();
const WORKFLOWS_DIR = join(/*turbopackIgnore: true*/ PROJECT_ROOT, "workflows");
const DEFAULT_MODELS_DIR = join(
  /*turbopackIgnore: true*/ PROJECT_ROOT,
  "ComfyUI",
  "models"
);
const DEFAULT_VIDEO_WORKFLOW_PATH = "ltx23-10eros-t2v-api.json";

function isInsideDirectory(parent: string, child: string) {
  const relativePath = relative(parent, child);
  return Boolean(
    relativePath &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
  );
}

function configuredWorkflowPath(envName: string) {
  const workflowPath =
    process.env[envName]?.trim() ||
    (envName === "COMFYUI_VIDEO_WORKFLOW_PATH" ? DEFAULT_VIDEO_WORKFLOW_PATH : "");

  if (!workflowPath) return "";

  if (isAbsolute(workflowPath)) return workflowPath;

  const relativeWorkflowPath = normalize(workflowPath).replace(/^workflows[\\/]/, "");
  const resolvedWorkflowPath = resolve(WORKFLOWS_DIR, relativeWorkflowPath);

  return isInsideDirectory(WORKFLOWS_DIR, resolvedWorkflowPath)
    ? resolvedWorkflowPath
    : "";
}

function collectRequiredModelFiles(workflow: unknown) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return [];
  }

  return Object.values(workflow).flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];

    const record = node as {
      class_type?: unknown;
      inputs?: Record<string, unknown>;
    };
    const classType = String(record.class_type ?? "");
    const inputs = record.inputs ?? {};

    if (classType === "UNETLoader" && typeof inputs.unet_name === "string") {
      return [join("diffusion_models", inputs.unet_name)];
    }

    if (classType === "CLIPLoader" && typeof inputs.clip_name === "string") {
      return [join("text_encoders", inputs.clip_name)];
    }

    if (classType === "VAELoader" && typeof inputs.vae_name === "string") {
      return [join("vae", inputs.vae_name)];
    }

    if (typeof inputs.ckpt_name === "string") {
      return [join("checkpoints", inputs.ckpt_name)];
    }

    if (typeof inputs.clip_name === "string") {
      return [join("text_encoders", inputs.clip_name)];
    }

    if (typeof inputs.text_encoder === "string") {
      return [join("text_encoders", inputs.text_encoder)];
    }

    if (typeof inputs.model_name === "string") {
      return [join("latent_upscale_models", inputs.model_name)];
    }

    if (
      (classType === "LoraLoader" || classType === "LoraLoaderModelOnly") &&
      typeof inputs.lora_name === "string"
    ) {
      return [join("loras", inputs.lora_name)];
    }

    return [];
  });
}

async function missingModelFiles(workflowPath: string) {
  const rawWorkflow = JSON.parse(await readFile(workflowPath, "utf-8")) as unknown;
  const workflow =
    rawWorkflow && typeof rawWorkflow === "object" && "prompt" in rawWorkflow
      ? (rawWorkflow as { prompt: unknown }).prompt
      : rawWorkflow;
  const modelsDir = process.env.COMFYUI_MODELS_DIR?.trim();
  const absoluteModelsDir = modelsDir
    ? isAbsolute(modelsDir)
      ? modelsDir
      : resolve(PROJECT_ROOT, modelsDir)
    : DEFAULT_MODELS_DIR;
  const requiredFiles = collectRequiredModelFiles(workflow);
  const missing: string[] = [];

  for (const file of requiredFiles) {
    try {
      await access(join(absoluteModelsDir, file));
    } catch {
      missing.push(file);
    }
  }

  return missing;
}

function workflowRequiresSourceImage(workflow: unknown) {
  return JSON.stringify(workflow).includes("{{source_image}}");
}

function workflowIncludesAudio(workflow: unknown) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return false;
  }

  return Object.values(workflow).some((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;

    const record = node as {
      class_type?: unknown;
      inputs?: Record<string, unknown>;
    };
    const classType = String(record.class_type ?? "");

    // A muxing node (CreateVideo / VHS_VideoCombine) fed an `audio` input embeds
    // sound in the output. The LTXV audio decode path is a strong signal too.
    if (
      (classType === "CreateVideo" || classType === "VHS_VideoCombine") &&
      Boolean(record.inputs?.audio)
    ) {
      return true;
    }

    return classType.startsWith("LTXVAudio");
  });
}

async function workflowStatus(envName: string, label: string) {
  const workflowPath = configuredWorkflowPath(envName);

  if (!workflowPath) {
    return {
      configured: false,
      exists: false,
      ready: false,
      missing: [],
      message: `Set ${envName} to enable ${label} generation.`,
    };
  }

  try {
    await access(workflowPath);
    const rawWorkflow = JSON.parse(await readFile(workflowPath, "utf-8")) as unknown;
    const workflow =
      rawWorkflow && typeof rawWorkflow === "object" && "prompt" in rawWorkflow
        ? (rawWorkflow as { prompt: unknown }).prompt
        : rawWorkflow;
    const missing = await missingModelFiles(workflowPath);

    if (missing.length > 0) {
      return {
        configured: true,
        exists: true,
        ready: false,
        missing,
        requiresSourceImage: workflowRequiresSourceImage(workflow),
        includesAudio: workflowIncludesAudio(workflow),
        message: `${label} workflow is missing model files: ${missing.join(", ")}`,
      };
    }

    return {
      configured: true,
      exists: true,
      ready: true,
      missing: [],
      requiresSourceImage: workflowRequiresSourceImage(workflow),
      includesAudio: workflowIncludesAudio(workflow),
      message: "",
    };
  } catch {
    return {
      configured: true,
      exists: false,
      ready: false,
      missing: [],
      message: `${envName} does not point to a readable file.`,
    };
  }
}

export async function GET() {
  const video = await workflowStatus("COMFYUI_VIDEO_WORKFLOW_PATH", "Video");
  const audio = await workflowStatus("COMFYUI_AUDIO_WORKFLOW_PATH", "Sound");

  return NextResponse.json({
    ...video,
    audio,
  });
}
