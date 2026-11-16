// Portable "style" spec: a ComfyUI API-format workflow tuned in image-gen, plus the
// list of inputs a product (ONEchat) fills per request. The consumer needs no
// image-gen code: clone `workflow`, write the user's values into the bound inputs,
// POST it to ComfyUI `/prompt` (a RunPod pod or a serverless ComfyUI worker).
//
// Kept free of `@/` imports so the standalone runner (scripts/run-style.ts) and
// node:test can import it directly.

export const STYLE_SPEC_SCHEMA = "image-gen.style/v1";

/** Where the user's text goes inside a style prompt template. */
export const USER_PROMPT_TOKEN = "{prompt}";

// Values put into the generation params before building the workflow, so the
// exporter can find every node input they ended up in.
export const PROMPT_SENTINEL = "__STYLE_USER_PROMPT__";
export const SEED_SENTINEL = 731_904_265_118;

export type ComfyApiWorkflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }
>;

export interface StyleInputBinding {
  node: string;
  input: string;
  /** Text inputs only: the full value with {prompt} where the user's text goes. */
  template?: string;
}

export interface StyleSpec {
  schema: typeof STYLE_SPEC_SCHEMA;
  id: string;
  version: number;
  name: { ko: string; en: string };
  description: string;
  createdAt: string;
  /** The style prompt as written in image-gen, with {prompt} for the user's text. */
  promptTemplate: string;
  negativePrompt: string;
  defaults: { width: number; height: number };
  /** False when the graph derives sizes (e.g. Hires fix): the size is then fixed. */
  sizeAdjustable: boolean;
  inputs: {
    prompt: StyleInputBinding[];
    seed: StyleInputBinding[];
    width: StyleInputBinding[];
    height: StyleInputBinding[];
  };
  /** Representative image for a style picker (the image the style was exported from). */
  thumbnail?: { dataUrl: string; width: number; height: number };
  /** Model files the ComfyUI host must have (bake into the RunPod image / volume). */
  requiredFiles: string[];
  /** Human-readable summary of the image-gen settings this was built from. */
  source: {
    model_name: string;
    loras: { path: string; scale: number }[];
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
  };
  workflow: ComfyApiWorkflow;
}

export interface StyleRequest {
  prompt: string;
  seed?: number;
  width?: number;
  height?: number;
}

const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i;
const STYLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidStyleId(id: string) {
  return STYLE_ID_PATTERN.test(id);
}

/** The prompt image-gen should build with: the template with the sentinel in place of {prompt}. */
export function sentinelPrompt(promptTemplate: string) {
  const template = ensurePromptToken(promptTemplate);
  return template.split(USER_PROMPT_TOKEN).join(PROMPT_SENTINEL);
}

/** Templates without {prompt} get the user's text appended. */
export function ensurePromptToken(promptTemplate: string) {
  const trimmed = promptTemplate.trim();
  if (trimmed.includes(USER_PROMPT_TOKEN)) return trimmed;
  return trimmed ? `${trimmed}, ${USER_PROMPT_TOKEN}` : USER_PROMPT_TOKEN;
}

export function extractStyleSpec({
  workflow,
  meta,
  promptTemplate,
  negativePrompt,
  width,
  height,
  source,
  now = new Date(),
}: {
  workflow: ComfyApiWorkflow;
  meta: { id: string; version: number; name: { ko: string; en: string }; description?: string };
  promptTemplate: string;
  negativePrompt: string;
  width: number;
  height: number;
  source: StyleSpec["source"];
  now?: Date;
}): StyleSpec {
  if (!isValidStyleId(meta.id)) {
    throw new Error("Style id must be lowercase letters, digits and dashes (e.g. soft-anime).");
  }
  const copy = structuredClone(workflow);
  const inputs: StyleSpec["inputs"] = { prompt: [], seed: [], width: [], height: [] };
  const files = new Set<string>();

  for (const [nodeId, node] of Object.entries(copy)) {
    for (const [inputName, value] of Object.entries(node.inputs ?? {})) {
      if (typeof value === "string") {
        if (value.includes(PROMPT_SENTINEL)) {
          const template = value.split(PROMPT_SENTINEL).join(USER_PROMPT_TOKEN);
          node.inputs[inputName] = template;
          inputs.prompt.push({ node: nodeId, input: inputName, template });
        } else if (MODEL_FILE_PATTERN.test(value)) {
          files.add(value.replaceAll("\\", "/"));
        }
      } else if (typeof value === "number") {
        if (value === SEED_SENTINEL) {
          node.inputs[inputName] = 0;
          inputs.seed.push({ node: nodeId, input: inputName });
        } else if (inputName === "width" && value === width) {
          inputs.width.push({ node: nodeId, input: inputName });
        } else if (inputName === "height" && value === height) {
          inputs.height.push({ node: nodeId, input: inputName });
        }
      }
    }
  }

  if (inputs.prompt.length === 0) {
    throw new Error(
      "The built workflow does not carry the prompt in any node input, so the user's text could not be bound."
    );
  }

  return {
    schema: STYLE_SPEC_SCHEMA,
    id: meta.id,
    version: meta.version,
    name: meta.name,
    description: meta.description?.trim() ?? "",
    createdAt: now.toISOString(),
    promptTemplate: ensurePromptToken(promptTemplate),
    negativePrompt,
    defaults: { width, height },
    sizeAdjustable: inputs.width.length > 0 && inputs.height.length > 0,
    inputs,
    requiredFiles: [...files].sort(),
    source,
    workflow: copy,
  };
}

/** A ready-to-queue ComfyUI API workflow for one request. */
export function applyStyle(spec: StyleSpec, request: StyleRequest): ComfyApiWorkflow {
  if (spec.schema !== STYLE_SPEC_SCHEMA) {
    throw new Error(`Unsupported style schema: ${spec.schema}`);
  }
  const userPrompt = request.prompt.trim();
  if (!userPrompt) throw new Error("prompt is required");

  const workflow = structuredClone(spec.workflow);
  const set = (binding: StyleInputBinding, value: unknown) => {
    const node = workflow[binding.node];
    if (!node) throw new Error(`Style ${spec.id}: node ${binding.node} is missing`);
    node.inputs[binding.input] = value;
  };

  for (const binding of spec.inputs.prompt) {
    set(binding, (binding.template ?? USER_PROMPT_TOKEN).split(USER_PROMPT_TOKEN).join(userPrompt));
  }

  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 48);
  for (const binding of spec.inputs.seed) set(binding, seed);

  if (spec.sizeAdjustable) {
    const width = request.width ?? spec.defaults.width;
    const height = request.height ?? spec.defaults.height;
    for (const binding of spec.inputs.width) set(binding, width);
    for (const binding of spec.inputs.height) set(binding, height);
  }

  return workflow;
}
