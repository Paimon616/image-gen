import { NextRequest, NextResponse } from "next/server";
import type {
  GeneratedImage,
  GenerationParams,
  VideoGenerationParams,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PAIMON_MODEL = "deepseek/deepseek-v4-flash";
const PAIMON_VISION_MODEL = "qwen/qwen3-vl-8b-instruct";
const PAIMON_VISION_FALLBACK_MODELS = [
  PAIMON_VISION_MODEL,
  "google/gemini-2.5-flash",
  "qwen/qwen3-vl-32b-instruct",
];
const PAIMON_SYSTEM_PROMPT = [
  "You are Paimon, an AI assistant embedded in a local image and video generation UI.",
  "Handle mature visual styling at a high level when it is part of the user's local workflow, while keeping wording focused on composition, lighting, pose, wardrobe, mood, and generation settings.",
  "Stay focused on supported generation outputs. Do not discuss policy or boundaries proactively; when a request cannot be fulfilled, respond briefly and redirect to the closest usable visual alternative.",
  "Read the current GenerationParams and attachments, then directly propose edits.",
  "When attachmentVisualAnalysis is present, treat it as the observed visual content of the corresponding attachments and use it to answer image-reference requests.",
  "If attachmentVisualAnalysis says visual pixels are unavailable, do not stop or apologize as the whole answer. Use attachment metadata, currentParams, modelContext, and the user's text to produce the best possible paramsPatch. Only mention the missing visual analysis briefly if the requested edit depends on unseen visual details.",
  "Return only JSON with keys: reply:string, paramsPatch:object, shouldGenerate:boolean, attachmentNotice:string.",
  "paramsPatch must contain only fields from the provided currentParams and should be a partial patch.",
  "If the user asks to create or alter a subject, rewrite prompt and negative_prompt as needed.",
  "If currentParams contains video fields such as video_model, video_pipeline, num_frames, fps, duration_seconds, source_image, enable_sound, sound_prompt, or negative_sound_prompt, you may patch those fields too. If those fields are absent, answer with copyable video prompt text in reply instead of inventing unavailable paramsPatch keys.",
  "If they ask for image-to-image, pose, reference image, model, LoRA, upscaling, ADetailer, or denoise changes, patch the relevant fields.",
  "If they ask for text-to-video or image-to-video prompts for Wan, LTX, Krea/Klea, or similar video models, help with video prompt structure, motion, camera, continuity, negative prompts, and sound prompts.",
  "Do not invent local model file paths unless the user names them or current params already include them.",
  "",
  "Video prompt rules:",
  "- Decide whether the request is T2V or I2V from currentParams.video_model, currentParams.source_image, attachments, and the user's wording.",
  "- For I2V, preserve the start image identity, wardrobe, environment, composition, color palette, and visible object layout unless the user explicitly asks to transform them.",
  "- Write a short time-aware shot plan: opening frame, subject motion, camera motion, interaction with environment, ending frame. Prefer one clear action arc over a list of disconnected actions.",
  "- Put the most important subject and motion early. Then camera/framing, environment, lighting, style, and quality.",
  "- Use physically plausible motion and continuity. Avoid impossible body mechanics, sudden unmotivated cuts, contradictory camera angles, and multiple simultaneous views unless requested.",
  "- Keep prompts concise enough for video models: concrete verbs, visible actions, camera terms, lighting, and material details. Do not keyword-spam image-only quality tags.",
  "- Always provide or patch a matching negative_prompt for video: low quality, blurry, flicker, jitter, warped motion, temporal inconsistency, morphing face, extra limbs, bad hands, duplicate subject, text, watermark, subtitles, sudden cuts, frozen frame.",
  "- When sound is enabled or requested, write sound_prompt as audible atmosphere, Foley, dialogue, and music cues only. Keep it synchronized with the visible shot.",
  "- For dialogue, quote only the exact line to be spoken and specify voice/tone briefly. Do not add subtitles unless the user asks for visible text.",
  "- If the user asks for model-specific help, mention the target model in reply and adapt syntax without fabricating unsupported parameters.",
  "- Wan 2.2 / Wan I2V: prioritize start-frame preservation, single clear subject motion, explicit camera movement, stable framing, and negative prompts for flicker/warping/extra limbs. Use an opening-shot -> action -> camera move -> ending-frame structure.",
  "- LTX / LTX 2.x: use natural-language cinematic shot descriptions with clear temporal progression, continuity, character consistency, lighting, lens/framing, and final beat. Avoid overloading the prompt with too many simultaneous actions.",
  "- Krea/Klea style models: use concrete art direction, mood, lighting, composition, lens/style references, and a clean action phrase. Prefer aesthetic specificity over rigid technical clutter.",
  "- If a requested video_model is present, respect it. If the user asks to switch models, only patch video_model when that field exists in currentParams and the requested value is one of the available values.",
  "- For ltx-10eros, emphasize cinematic adult mood, character consistency, motion continuity, lighting, and final beat.",
  "",
  "Pony/PDXL prompt conversion rules:",
  "- If the user mentions Pony, PDXL, Pony Diffusion, or the current model_name/model implies pony, rewrite the full prompt into Pony tag style.",
  "- Do not merely append 'pony style', 'pony art style', or 'pony aesthetic'. Those are low-quality edits.",
  "- Start Pony prompts with score tags such as: score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up.",
  "- Then add an appropriate rating tag such as rating_safe or rating_questionable.",
  "- Preserve the user's subject, action, outfit, nudity, composition, and important details, but convert them into concise comma-separated booru/Pony tags.",
  "- Put quality tags and score tags at the front, not as a trailing afterthought.",
  "- Remove generic suffixes like 'pony style' when converting to Pony format.",
  "- Example safe structure: score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, rating_safe, 1girl, solo, beautiful woman, looking at viewer, smile, long wavy hair, brown hair, elegant dress, soft lighting, bokeh, depth of field, simple background, studio portrait.",
  "",
  "General model-family prompt rules:",
  "- Always adapt BOTH prompt and negative_prompt to the current checkpoint family. Do not only edit the positive prompt.",
  "- Infer model family from currentParams.model_name, modelContext.currentCheckpoint.base_model, checkpoint file name, and the user's requested checkpoint.",
  "- Pony/PDXL: booru tags, score tags first, rating_* tag early, concise comma tags; negatives should use low score tags and artifact/anatomy tags, not long prose.",
  "- Illustrious/NoobAI/Anima anime SDXL: comma-separated anime/booru tags with quality tags such as masterpiece, best quality, very aesthetic, absurdres/highres when appropriate; negatives should include worst quality, low quality, lowres, bad anatomy, bad hands, jpeg artifacts, watermark/text.",
  "- SDXL realistic/semi-realistic: natural language plus concise photographic tags; use camera, lighting, lens, composition, skin/detail descriptors; negatives should target plastic skin, overprocessed, bad anatomy, extra fingers, watermark/text.",
  "- SD 1.5 realistic/anime: shorter comma tags, avoid excessive SDXL/Pony score tags; keep resolution/detail tags moderate; negatives should include anatomy/artifact terms and embeddings only if present in currentParams.",
  "- Flux/Krea 2: prefer clean natural-language prompt sentences or short descriptive phrases; avoid Pony score tags and excessive booru syntax unless the checkpoint metadata clearly says otherwise.",
  "- If model catalog tags contain POS:/NEG: examples for the selected checkpoint, use them as style guidance while preserving the user's concept.",
  "",
  "Checkpoint and LoRA rules:",
  "- When changing checkpoint/model_name, also reconsider loras. Existing loras that do not match the new checkpoint family should be removed unless the user explicitly asks to keep them.",
  "- Choose LoRAs only from modelContext.compatibleLoras or existing currentParams.loras. Do not invent LoRA paths.",
  "- Prefer LoRAs whose name/tags/path match the user's requested subject, style, character, outfit, pose, or quality goal.",
  "- If no compatible LoRA clearly matches the request, return an empty loras array or keep only compatible existing LoRAs. Do not pick random LoRAs.",
  "- Use conservative LoRA scale defaults: style/detail 0.45-0.8, character/concept 0.65-0.95, slider LoRAs according to their apparent purpose.",
  "- If the user asks to change checkpoint but not a specific file, pick a checkpoint only from modelContext.checkpoints. Match requested family/style and explain the choice in reply.",
  "",
  "Universal prompt editing workflow (highest priority; mandatory for every request):",
  "- Never rely on a fixed keyword list or a single example. Apply semantic reasoning to ANY visual concept the user requests.",
  "- Treat the latest user message as authoritative. A newer correction overrides conflicting conversation history and current prompt text.",
  "- Translate conversational, indirect, multilingual, or failure-report language into effective visual concepts instead of copying words mechanically.",
  "- Internally classify the request as MUST INCLUDE, MUST EXCLUDE, MUST PRESERVE, and OPTIONAL across subject, count, identity, anatomy, clothing, pose/action, expression/gaze, view/framing, spatial relationships, setting, objects, lighting, color, style, medium, text, and quality.",
  "- Preserve details the user did not ask to change unless they conflict with or causally undermine a new requirement.",
  "- Rewrite the full prompt when needed; never implement a meaningful change by appending one token to contradictory prompt text.",
  "- Put defining subjects and hard constraints early. Use concise synonyms or moderate weights only when useful for the detected model family.",
  "- For every exclusion, remove the concept, synonyms, and indirect cues from positive prompt and add targeted model-appropriate terms to negative_prompt. Omission alone is insufficient for likely failure modes.",
  "- Detect and resolve direct and indirect conflicts across every visual dimension, not only camera angle, person count, objects, or color.",
  "- Preserve relevant quality/anatomy/artifact negatives, remove negatives that oppose desired content, and add only targeted request-specific failure negatives.",
  "- Whenever visual content changes, return complete prompt AND negative_prompt values in paramsPatch.",
  "- Adapt syntax, ordering, weights, score/rating tags, and negatives to the checkpoint family without mixing incompatible conventions.",
  "- Reinforce true hard constraints without excessive weights, keyword spam, duplicate tags, or irrelevant negative lists.",
  "- Do not invent unrequested subjects, attributes, props, settings, styles, or camera details unless a supporting detail is necessary to make the request unambiguous.",
  "- For failed generations, strengthen every reported mismatch and remove its likely contradictory causes rather than repeating the same prompt structure.",
  "- Before returning, silently verify requirement coverage, exclusions, preservation, contradictions, duplicates, model-family fit, and unrelated parameter changes.",
  "- In reply, report only changes actually present in paramsPatch; never claim that an unmet requirement was handled.",
  "",
  "",
  "Scene coherence and pose planning rules (mandatory):",
  "- Before writing tags, build one coherent internal scene plan: exact subject count and identity, camera position, framing, body orientation, pose, gaze, each limb's action, clothing state, object contacts, background, and lighting.",
  "- Treat each requested person as one continuous body in one spatial location. Never turn alternate views, body details, or pose clauses into extra people.",
  "- When exactly one subject is intended, explicitly prevent duplicate subjects, multiple views of the same subject, reflections, insets, split compositions, diptychs, collages, character sheets, and before/after panels unless requested.",
  "- A pose correction replaces every incompatible old pose, action, gaze, view, and framing cue. Do not preserve stale clauses merely because the user did not name each one.",
  "- Check physical mechanics: torso direction, pelvis direction, weight support, hand placement, foot placement, and object contact must describe a pose one body can actually perform.",
  "- Derive camera and visibility together. A strict rear view cannot retain front-facing gaze or facial emphasis; a full-body action cannot retain incompatible face close-up framing.",
  "- Choose framing and camera height that can visibly communicate all hard constraints. Remove composition terms that would crop out required hands, clothing, props, or body relationships.",
  "- If the user requires a garment or detail to be visible, state the clothing layer and the viewpoint/action that exposes it without inventing a second view or second subject.",
  "- Distinguish the subject from furniture, props, and other entities. Assign every requested hand/object relationship unambiguously, including which surface or part is touched when context permits.",
  "- Order the final prompt coherently: quality/model tokens, subject count and identity, camera/framing, unified pose and limb actions, clothing/visibility, environment and props, then lighting/style.",
  "- Add targeted negatives for the most likely structural failures: contradictory view, wrong pose, misplaced hands, missing contact, cropped required details, extra limbs, duplicate subject, and multi-panel composition.",
  "- Preserve aesthetic details only after spatial constraints are consistent. Spatial and action requirements outrank expression, decorative details, and old composition cues.",
  "- Never use multiple panels or simultaneous alternate views as a workaround for mutually conflicting prompt clauses. Resolve the conflict and output one intended scene.",
  "- Silently simulate the final scene from the camera's viewpoint. If any requested relationship is invisible, impossible, ambiguous, duplicated, or contradicted, rewrite before returning.",
  "Attachment reference and composition rules:",
  "- Attachments are ordered and carry referenceId values such as 참조1, 참조2. Treat referenceId and array order as authoritative.",
  "- Resolve names such as 참조1, 참조 1, reference 1, first reference, 첫 번째 참조, and 첫 이미지 to the same attachment when the intent is clear.",
  "- Each gallery attachment metadata.params is an independent source. Track field provenance internally and never blend fields from different references unless requested.",
  "- Copy only the fields the user assigns to each reference. Preserve all unrelated currentParams fields.",
  "- A request for a reference's model configuration means model/backend, model_name/checkpoint, loras, embeddings, and checkpoint-dependent VAE only when present and compatible. Never substitute a similarly named local asset.",
  "- A request for a reference's prompt means prompt and negative_prompt together unless the user explicitly limits it to one.",
  "- Determine the final target checkpoint after applying requested model changes. Then validate and wash the sourced prompt and negative_prompt for that final model family, preserving visual intent while fixing syntax, order, score/rating tags, incompatible tags, duplicates, and contradictions.",
  "- When prompt and model come from different references, do not copy the prompt verbatim if their families differ. Convert it to the final target family's prompting convention.",
  "- Do not copy seed, dimensions, sampler, scheduler, ControlNet, source images, or other settings unless the user explicitly assigns those fields.",
  "- If a named reference or required metadata field is missing, explain exactly what is unavailable and do not fabricate it.",
  "- In reply, identify provenance clearly, for example: 참조1의 체크포인트·LoRA + 참조2의 프롬프트·네거티브, then state that the prompts were normalized for the final checkpoint.",
  "",
  "Character library rules:",
  "- characterLibrary is the user's saved characters. Each has: name, summary, appearancePrompt (identity), outfits[{name,prompt}], backgrounds[{name,prompt}], and situations[{name,prompt,outfitName,backgroundName}].",
  "- When the user names a character (e.g. '아리아로 만들어줘', 'use the elf character on the beach'), compose the prompt from that character's appearancePrompt + the chosen outfit prompt + the chosen background prompt + the chosen situation prompt.",
  "- If the user names a situation, pick it by name; a situation may declare its own outfitName/backgroundName — prefer those for the outfit and background. If the user names an outfit or background directly, that overrides. Otherwise pick the most fitting entry, or the first if unspecified. Mention which outfit/background/situation you used in reply.",
  "- Merge the character's identity as the leading subject of the prompt, then outfit, then background/situation, then adapt the whole thing to the current checkpoint family (score/rating tags, ordering, negatives) exactly like any other prompt edit.",
  "- Preserve identity tags faithfully; do not drop or contradict them when applying outfit/background/situation. Put the composed result into paramsPatch.prompt and update negative_prompt as needed.",
  "- The situation drives the COMPOSITION. Foreground the situation's specific action, body pose, camera framing, camera angle, gaze, and expression in the composed prompt — do not bury them under identity/quality tags and do not silently default every character render to an upper-body front-facing portrait. The framing must match the action.",
  "- If the situation prompt is vague about pose or camera (only a mood or a one-word action), do NOT fall back to a generic bust shot. Infer a concrete, fitting shot from the action and the background: choose an explicit framing (full body / cowboy / upper body / close-up), an explicit camera angle (front / side / from behind / from above / from below), and what the hands and limbs are doing, so this situation renders a distinctly composed image rather than looking like every other situation for the same character.",
  "- When the user applies several situations of the same character in a row, actively vary the framing and pose from the previous render instead of repeating one composition.",
  "- Only use characters present in characterLibrary. Never invent a character that is not listed.",

].join("\n");
interface PaimonMessage {
  role: "user" | "assistant";
  content: string;
}

interface PaimonAttachment {
  kind: "clipboard_image" | "gallery_image";
  referenceId?: string;
  url?: string;
  dataUrl?: string;
  metadata?: Partial<GeneratedImage>;
}

interface PaimonModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  tags?: string[];
}

interface PaimonModelContext {
  currentCheckpoint?: PaimonModelAsset;
  compatibleLoras?: PaimonModelAsset[];
  checkpoints?: PaimonModelAsset[];
}

// A compact snapshot of the user's saved characters, sent so Paimon can compose
// a character's identity + outfit + background + situation into the prompt when
// the user references one by name.
interface PaimonCharacterOutfit {
  name: string;
  prompt: string;
}

interface PaimonCharacterBackground {
  name: string;
  prompt: string;
}

interface PaimonCharacterSituation {
  name: string;
  prompt: string;
  outfitName?: string;
  backgroundName?: string;
}

interface PaimonCharacter {
  name: string;
  summary: string;
  appearancePrompt: string;
  outfits: PaimonCharacterOutfit[];
  backgrounds: PaimonCharacterBackground[];
  situations: PaimonCharacterSituation[];
}

interface PaimonRequest {
  messages?: PaimonMessage[];
  currentParams?: GenerationParams | VideoGenerationParams;
  attachments?: PaimonAttachment[];
  modelContext?: PaimonModelContext;
  characterLibrary?: PaimonCharacter[];
}

interface OpenRouterTextPart { type: "text"; text: string; }
interface OpenRouterImagePart { type: "image_url"; image_url: { url: string }; }
type OpenRouterContentPart = OpenRouterTextPart | OpenRouterImagePart;
const LOCAL_IMAGE_PATHS = ["/api/uploads/", "/api/images/"];

// The actual image bytes travel as `image_url` parts (vision call) — never as
// text. Strip the multi-MB base64 `dataUrl` before an attachment is stringified
// into any prompt, so we don't dump hundreds of thousands of junk tokens into
// the payload. Keep the short `url` path as a lightweight reference marker.
function redactAttachments(attachments: PaimonAttachment[]) {
  return attachments.map((attachment) => {
    const { dataUrl, ...rest } = attachment;
    void dataUrl;
    return rest;
  });
}

function validateImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Attached image data URL is invalid.");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64 = match[2];
  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength > 15 * 1024 * 1024) throw new Error("Attached image is larger than 15 MB.");
  return `data:${mimeType};base64,${base64}`;
}

// Vision inference time scales with the image's pixel dimensions, so oversized
// attachments (2K–4K clipboard/gallery originals) make the qwen-vl analysis
// noticeably slower. Downscale ONLY the copy sent to the vision model — the
// stored original used for img2img/pose references is never touched. NSFW
// analysis stays on qwen-vl; only the resolution shrinks.
const VISION_MAX_EDGE = 1280;

async function resizeDataUrlForVision(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return dataUrl;
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(match[1], "base64");
    const meta = await sharp(input).metadata();
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    // Already within budget: skip re-encoding to avoid needless quality loss.
    if (longestEdge > 0 && longestEdge <= VISION_MAX_EDGE) return dataUrl;
    const output = await sharp(input)
      .rotate() // bake EXIF orientation so the model sees it upright
      .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch (error) {
    // Any decode/encode failure: fall back to the full-size image untouched.
    // Most often this is a missing/broken native `sharp` binary on this PC — log
    // it so the silent "not downscaled on some machines" case is diagnosable.
    // The client already downscales clipboard/dataUrl attachments via <canvas>
    // (src/lib/image-resize.ts), so this path stays a best-effort safety net.
    console.warn(
      "[paimon] vision downscale skipped (sharp unavailable?):",
      error instanceof Error ? error.message : error
    );
    return dataUrl;
  }
}

async function imageInputUrl(attachment: PaimonAttachment, requestUrl: URL) {
  if (attachment.dataUrl) {
    return resizeDataUrlForVision(validateImageDataUrl(attachment.dataUrl));
  }

  const attachmentUrl = attachment.url;
  if (!attachmentUrl) return "";
  const parsed = new URL(attachmentUrl, requestUrl.origin);
  // Match app-served images by path only, NOT by origin: a start image URL can
  // carry a different host than the incoming request (localhost vs 127.0.0.1 vs
  // a LAN IP), which previously made us forward the unreachable localhost URL to
  // the remote vision model instead of inlining the bytes. The embedded host is
  // ignored — we always fetch the path from THIS server's origin.
  const isLocalImage = LOCAL_IMAGE_PATHS.some((prefix) =>
    parsed.pathname.startsWith(prefix)
  );
  if (!isLocalImage) return parsed.toString();
  const localUrl = new URL(parsed.pathname + parsed.search, requestUrl.origin);
  const response = await fetch(localUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load attached image (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/")) throw new Error("Attached URL did not return an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("Attached image is larger than 15 MB.");
  return resizeDataUrlForVision(`data:${mimeType};base64,${bytes.toString("base64")}`);
}

async function createMultimodalContent(body: PaimonRequest, requestUrl: URL, messages: PaimonMessage[]): Promise<OpenRouterContentPart[]> {
  const attachments = body.attachments ?? [];
  const content: OpenRouterContentPart[] = [{ type: "text", text: JSON.stringify({
    currentParams: body.currentParams, attachments: redactAttachments(attachments), modelContext: body.modelContext ?? null, conversation: messages,
  }) }];
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.url && !attachment.dataUrl) continue;
    const referenceId = attachment.referenceId || `참조${index + 1}`;
    try {
      const url = await imageInputUrl(attachment, requestUrl);
      if (!url) continue;
      content.push({ type: "text", text: `${referenceId}의 실제 이미지:` }, { type: "image_url", image_url: { url } });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      content.push({ type: "text", text: `${referenceId} 이미지는 불러오지 못했습니다: ${reason}` });
    }
  }
  return content;
}

async function analyzeAttachments(
  apiKey: string,
  body: PaimonRequest,
  requestUrl: URL,
  messages: PaimonMessage[]
) {
  if (!(body.attachments ?? []).some((attachment) => attachment.url)) return "";
  const fallbackAnalysis = (reason: string) => {
    const attachments = body.attachments ?? [];
    const safeReason = isSensitiveInputError(reason)
      ? "The vision model declined the reference image analysis."
      : reason;
    const summaries = attachments.map((attachment, index) => {
      const referenceId = attachment.referenceId || `참조${index + 1}`;
      const params = attachment.metadata?.params;
      const metadataSummary = params
        ? {
            model_name: params.model_name,
            loras: params.loras,
            embeddings: params.embeddings,
            prompt: params.prompt,
            negative_prompt: params.negative_prompt,
            sampler_name: params.sampler_name,
            scheduler: params.scheduler,
            num_inference_steps: params.num_inference_steps,
            guidance_scale: params.guidance_scale,
            seed: params.seed,
            width: params.width,
            height: params.height,
          }
        : null;

      return {
        referenceId,
        kind: attachment.kind,
        hasImageUrl: Boolean(attachment.url),
        metadata: metadataSummary,
      };
    });

    return [
      `Visual pixels unavailable for automatic analysis: ${safeReason}`,
      "This is not a blocking error. Continue the assistant task using attachment metadata, currentParams, modelContext, and the user's explicit text.",
      "If metadata.params exists for a reference, it is authoritative for model_name, loras, embeddings, prompt, negative_prompt, sampler, scheduler, seed, steps, CFG, and dimensions.",
      "If metadata is absent, still update prompt/negative_prompt from the user's text and preserve existing model settings unless the user asks to change them.",
      `Attachment fallback metadata: ${JSON.stringify(summaries)}`,
    ].join("\n");
  };

  const content = await createMultimodalContent(body, requestUrl, messages);
  content[0] = {
    type: "text",
    text: [
      "Analyze every attached reference image for another image or video generation assistant.",
      "Describe visible content objectively and focus on reusable generation attributes.",
      "If a detail is not useful for supported generation, summarize it at a high level and continue with visual attributes.",
      "For each referenceId, report subjects, clothing coverage, pose, action, expression, camera angle, framing, composition, environment, lighting, colors, style, motion cues, and important spatial relationships.",
      "Keep references separate and do not infer generation settings that are not visually observable.",
      `Attachment metadata: ${JSON.stringify(redactAttachments(body.attachments ?? []))}`,
    ].join("\n"),
  };

  const errors: string[] = [];
  for (const model of PAIMON_VISION_FALLBACK_MODELS) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Image Gen Paimon Vision",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 900,
        messages: [{ role: "user", content }],
      }),
    }).catch((error) => {
      return {
        ok: false,
        json: async () => ({
          error: {
            message: error instanceof Error ? error.message : "Paimon vision request failed.",
          },
        }),
      } as Response;
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      errors.push(`${model}: ${result?.error?.message ?? "request failed"}`);
      continue;
    }

    const analysis = result?.choices?.[0]?.message?.content;
    if (typeof analysis === "string" && analysis.trim()) {
      return analysis.trim();
    }
    errors.push(`${model}: empty analysis`);
  }

  return fallbackAnalysis(errors.join("; ") || "Paimon vision analysis failed.");
}

function parseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Paimon did not return JSON.");
  }

  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

const JSON_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

// Pull the decoded value of the `reply` string out of a still-streaming JSON
// buffer. Returns as much of the reply as has arrived (monotonically growing),
// or null before the `reply` key appears. Tolerates an incomplete trailing
// escape by stopping short until the next chunk completes it.
function extractPartialReply(buffer: string): string | null {
  const keyMatch = buffer.match(/"reply"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return null;

  let i = keyMatch.index + keyMatch[0].length;
  let out = "";

  while (i < buffer.length) {
    const ch = buffer[i];

    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break; // incomplete escape at buffer end
      if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) break; // incomplete unicode escape
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += JSON_ESCAPES[next] ?? next;
      i += 2;
      continue;
    }

    if (ch === '"') return out; // closing quote → reply is complete

    out += ch;
    i += 1;
  }

  return out;
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isSensitiveInputError(message: string) {
  return /may contain sensitive information|sensitive information|content\[\d+\]/i.test(message);
}

function paimonErrorMessage(message: string) {
  if (isSensitiveInputError(message)) {
    return "파이몬이 첨부 이미지 또는 프롬프트 일부를 분석 모델에 보낼 수 없어 차단되었습니다. 민감한 세부 묘사를 줄이거나 첨부 없이 다시 요청해 주세요.";
  }
  return message;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured." },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as PaimonRequest;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "messages is required." },
        { status: 400 }
      );
    }

    const hasImageAttachments = (body.attachments ?? []).some(
      (attachment) => attachment.url || attachment.dataUrl
    );

    const encoder = new TextEncoder();

    // Vision analysis and the main completion both run INSIDE the stream so we
    // can emit progress immediately. Previously the whole vision round-trip was
    // awaited before the Response even returned, so attaching an image left the
    // client on a blank spinner for the entire (slow) analysis with no feedback.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(sse(event, data)));

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let contentBuffer = "";
        let sentLength = 0;

        try {
          if (hasImageAttachments) {
            send("status", { message: "첨부 이미지를 분석하는 중" });
          }
          const attachmentVisualAnalysis = await analyzeAttachments(
            apiKey,
            body,
            req.nextUrl,
            messages
          );

          send("status", { message: "답변을 작성하는 중" });

          const upstream = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "Image Gen Paimon",
            },
            body: JSON.stringify({
              model: PAIMON_MODEL,
              temperature: 0.2,
              stream: true,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: PAIMON_SYSTEM_PROMPT,
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    currentParams: body.currentParams,
                    attachments: redactAttachments(body.attachments ?? []),
                    attachmentVisualAnalysis,
                    modelContext: body.modelContext ?? null,
                    characterLibrary: body.characterLibrary ?? [],
                    conversation: messages,
                  }),
                },
              ],
            }),
          });

          if (!upstream.ok || !upstream.body) {
            const errorData = await upstream.json().catch(() => null);
            const rawMessage = errorData?.error?.message ?? "OpenRouter request failed.";
            send("error", {
              error: paimonErrorMessage(rawMessage),
            });
            return;
          }

          const reader = upstream.body.getReader();

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const payload = trimmed.slice("data:".length).trim();
              if (!payload || payload === "[DONE]") continue;

              try {
                const chunk = JSON.parse(payload);
                const delta = chunk?.choices?.[0]?.delta?.content;
                if (typeof delta !== "string" || !delta) continue;

                contentBuffer += delta;
                const reply = extractPartialReply(contentBuffer);
                if (reply !== null && reply.length > sentLength) {
                  send("delta", { text: reply.slice(sentLength) });
                  sentLength = reply.length;
                }
              } catch {
                // Ignore keep-alive comments / non-JSON lines from OpenRouter.
              }
            }
          }

          // Authoritatively parse the completed JSON for the patch and final
          // reply; fall back to the streamed reply text if parsing fails.
          let reply = "";
          let paramsPatch: unknown = {};
          let attachmentNotice = "";
          let shouldGenerate = false;

          try {
            const result = parseJsonObject(contentBuffer) as Record<
              string,
              unknown
            >;
            reply = typeof result.reply === "string" ? result.reply : "";
            paramsPatch = result.paramsPatch ?? {};
            attachmentNotice =
              typeof result.attachmentNotice === "string"
                ? result.attachmentNotice
                : "";
            shouldGenerate = Boolean(result.shouldGenerate);
          } catch {
            reply = extractPartialReply(contentBuffer) ?? "";
          }

          send("done", { reply, paramsPatch, attachmentNotice, shouldGenerate });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Paimon failed.";
          send("error", {
            error: paimonErrorMessage(message),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paimon failed.";
    return NextResponse.json(
      { error: paimonErrorMessage(message) },
      { status: 500 }
    );
  }
}
