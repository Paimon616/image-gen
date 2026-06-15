import { access, readFile } from "fs/promises";
import { isAbsolute, join } from "path";
import { NextResponse } from "next/server";

function configuredWorkflowPath() {
  const workflowPath = process.env.COMFYUI_VIDEO_WORKFLOW_PATH?.trim();

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

export async function GET() {
  const workflowPath = configuredWorkflowPath();

  if (!workflowPath) {
    return NextResponse.json({
      configured: false,
      exists: false,
      message: "Set COMFYUI_VIDEO_WORKFLOW_PATH to enable video generation.",
    });
  }

  try {
    await access(workflowPath);
    const missing = await missingModelFiles(workflowPath);

    if (missing.length > 0) {
      return NextResponse.json({
        configured: true,
        exists: true,
        ready: false,
        missing,
        message: `Video workflow is missing model files: ${missing.join(", ")}`,
      });
    }

    return NextResponse.json({
      configured: true,
      exists: true,
      ready: true,
      missing: [],
      message: "",
    });
  } catch {
    return NextResponse.json({
      configured: true,
      exists: false,
      message: "COMFYUI_VIDEO_WORKFLOW_PATH does not point to a readable file.",
    });
  }
}
