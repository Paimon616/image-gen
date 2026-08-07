import { basename, join, normalize, relative, resolve } from "path";

export interface VideoPipelineDefinition {
  id: string;
  label: string;
  description: string;
  workflowPath: string;
  mode: "i2v" | "t2v";
  experimental?: boolean;
}

const PROJECT_ROOT = process.cwd();
const WORKFLOWS_DIR = join(/*turbopackIgnore: true*/ PROJECT_ROOT, "workflows");

const BUILTIN_VIDEO_PIPELINES: VideoPipelineDefinition[] = [
  {
    id: "sulphur-ltx23-i2v-distilled-fast",
    label: "Sulphur LTX 2.3 - I2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_distilled.json",
    mode: "i2v",
  },
  {
    id: "sulphur-ltx23-i2v-base-high-quality",
    label: "Sulphur LTX 2.3 - I2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_base.json",
    mode: "i2v",
  },
  {
    id: "sulphur-ltx23-t2v-distilled-fast",
    label: "Sulphur LTX 2.3 - T2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_distilled.json",
    mode: "t2v",
  },
  {
    id: "sulphur-ltx23-t2v-base-high-quality",
    label: "Sulphur LTX 2.3 - T2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_base.json",
    mode: "t2v",
  },
  {
    id: "10eros-i2v-triple-pass",
    label: "10Eros - I2V (triple-pass, experimental)",
    description: "RunPod Video 10Eros image-to-video triple-pass workflow",
    workflowPath: "workflows/10Eros_10SNodes_TripleSample_I2V.json",
    mode: "i2v",
    experimental: true,
  },
];

function isInsideDirectory(parent: string, child: string) {
  const relativePath = relative(parent, child);
  return Boolean(
    relativePath &&
      !relativePath.startsWith("..") &&
      !relativePath.includes("..\\") &&
      !relativePath.startsWith("/") &&
      !/^[a-z]:/i.test(relativePath)
  );
}

export function defaultVideoPipelineId() {
  return "sulphur-ltx23-i2v-base-high-quality";
}

export function listVideoPipelines() {
  return [...BUILTIN_VIDEO_PIPELINES];
}

export function resolveVideoPipeline(idOrPath: string | undefined) {
  const requested = String(idOrPath ?? "").trim();
  const pipelines = listVideoPipelines();
  const matched =
    pipelines.find((pipeline) => pipeline.id === requested) ??
    pipelines.find((pipeline) => pipeline.workflowPath === requested) ??
    pipelines.find((pipeline) => basename(pipeline.workflowPath) === requested) ??
    pipelines.find((pipeline) => pipeline.id === defaultVideoPipelineId()) ??
    pipelines[0];

  return matched;
}

export async function resolveVideoWorkflowPath(idOrPath: string | undefined) {
  const pipeline = await resolveVideoPipeline(idOrPath);
  const normalized = normalize(pipeline.workflowPath).replace(/^workflows[\\/]/, "");
  const resolved = resolve(WORKFLOWS_DIR, normalized);

  if (!isInsideDirectory(WORKFLOWS_DIR, resolved)) {
    throw new Error("Video workflow path is outside the workflows directory.");
  }

  return { pipeline, absolutePath: resolved };
}
