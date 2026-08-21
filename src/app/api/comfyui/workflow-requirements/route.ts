import { NextRequest } from "next/server";

import {
  catalogSourceUrl,
  isDiffusionOnlyImageCheckpointName,
  modelFileExists,
  requiredSupportFiles,
  resolveCheckpointFamily,
  type Krea2WorkflowVariant,
} from "@/lib/comfyui-model-files";
import { supportAsset } from "@/lib/support-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKFLOW_VARIANTS: Krea2WorkflowVariant[] = [
  "generic",
  "refined",
  "pornmaster",
  "moody",
];

export interface WorkflowRequirement {
  /** models/<folder> the file belongs in. */
  folder: string;
  filename: string;
  /** Display path, e.g. "ComfyUI/models/vae/qwen_image_vae.safetensors". */
  label: string;
  /** Present on this machine already. */
  exists: boolean;
  /** Download source, or "" when nothing can fetch it automatically. */
  url: string;
  kind: "checkpoint" | "support";
}

// What the selected checkpoint + workflow needs on THIS machine, and where each
// missing piece can be fetched from. The RunPod equivalent is the pod file check
// (checkRunpodGenerationFiles), which reports the same set for the pod's disk.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    model_name?: unknown;
    krea2_workflow?: unknown;
    upscale_model_name?: unknown;
  };
  const checkpoint =
    typeof body.model_name === "string" ? body.model_name.trim() : "";
  const workflow = WORKFLOW_VARIANTS.includes(
    body.krea2_workflow as Krea2WorkflowVariant
  )
    ? (body.krea2_workflow as Krea2WorkflowVariant)
    : "generic";
  const upscaleModelName =
    typeof body.upscale_model_name === "string" ? body.upscale_model_name : "";

  const support = await requiredSupportFiles(
    checkpoint,
    workflow,
    upscaleModelName
  );
  const requirements: WorkflowRequirement[] = await Promise.all(
    support.map(async (file) => ({
      folder: file.folder,
      filename: file.name,
      label: file.label,
      exists: await modelFileExists(file.folder, file.name),
      url: supportAsset(file.folder, file.name)?.url ?? "",
      kind: "support" as const,
    }))
  );

  // The checkpoint itself only counts as a requirement when the pipeline needs
  // support files at all (i.e. it is one of the dedicated families) — otherwise this
  // would flag every SDXL merge the user simply hasn't downloaded yet.
  if (checkpoint && requirements.length > 0) {
    const family = await resolveCheckpointFamily(checkpoint);
    const folder =
      family === "krea2" ||
      family === "zimage" ||
      isDiffusionOnlyImageCheckpointName(checkpoint)
        ? "diffusion_models"
        : "checkpoints";
    // Either folder is a valid install location for these weights, so a file present
    // in the other one must not be reported as missing.
    const exists =
      (await modelFileExists(folder, checkpoint)) ||
      (await modelFileExists(
        folder === "diffusion_models" ? "checkpoints" : "diffusion_models",
        checkpoint
      ));
    requirements.unshift({
      folder,
      filename: checkpoint.replace(/^.*\//, ""),
      label: `ComfyUI/models/${folder}/${checkpoint}`,
      exists,
      url: exists ? "" : await catalogSourceUrl(checkpoint),
      kind: "checkpoint",
    });
  }

  const missing = requirements.filter((item) => !item.exists);

  return Response.json(
    {
      requirements,
      missing: missing.length,
      installable: missing.filter((item) => Boolean(item.url)).length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
