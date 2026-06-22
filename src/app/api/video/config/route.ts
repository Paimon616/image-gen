import { access, readFile } from "fs/promises";
import { isAbsolute, join } from "path";
import { NextResponse } from "next/server";

function configuredWorkflowPath(envName: string) {
  const workflowPath = process.env[envName]?.trim();

  if (!workflowPath) return "";

  return isAbsolute(workflowPath)
    ? workflowPath
    : join(/*turbopackIgnore: true*/ process.cwd(), workflowPath);
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
  const modelsDir = process.env.COMFYUI_MODELS_DIR?.trim() || "ComfyUI/models";
  const absoluteModelsDir = isAbsolute(modelsDir)
    ? modelsDir
    : join(/*turbopackIgnore: true*/ process.cwd(), modelsDir);
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
    const missing = await missingModelFiles(workflowPath);

    if (missing.length > 0) {
      return {
        configured: true,
        exists: true,
        ready: false,
        missing,
        message: `${label} workflow is missing model files: ${missing.join(", ")}`,
      };
    }

    return {
      configured: true,
      exists: true,
      ready: true,
      missing: [],
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
