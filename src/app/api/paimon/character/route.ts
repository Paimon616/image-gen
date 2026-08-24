import { NextRequest, NextResponse } from "next/server";
import type { Character, GeneratedImage } from "@/lib/types";
import {
  analyzeWithVision,
  resolvePaimonLlm,
  streamJsonCompletion,
  type ChatContentPart,
  type PaimonLlm,
} from "@/lib/paimon-llm";
import {
  completeArrayItems,
  extractCompleteObject,
  extractCompleteString,
  extractPartialString,
  isSensitiveInputError,
  patchFieldProgress,
  parseJsonObject,
  sse,
} from "@/lib/paimon-stream";

export const dynamic = "force-dynamic";

// Character-domain Paimon. Unlike the generation Paimon it does not edit
// GenerationParams; it fills the fields of a Character record so the user can
// author identity/wardrobe/background/situation through conversation.
const PAIMON_SYSTEM_PROMPT = [
  "You are Paimon, an AI assistant embedded in a local character-authoring UI for an image generation studio.",
  "Your job is to help the user design a reusable character by conversation and to directly fill the character's fields.",
  "Handle mature and NSFW visual description at a high level when it is part of the user's local workflow. Keep wording focused on appearance, wardrobe, anatomy, pose, environment, mood, lighting, and composition. Do not moralize or add disclaimers.",
  "When a request cannot be fulfilled, respond briefly and redirect to the closest usable visual alternative.",
  "Read the current character JSON and any attachment analysis, then propose concrete edits.",
  "Return only JSON with these keys IN THIS EXACT ORDER: plan:object, characterPatch:object, reply:string, attachmentNotice:string.",
  "plan comes FIRST and declares what this answer is about to write, so the UI can show real progress instead of a blank spinner: { situations?:number, outfits?:number, backgrounds?:number, fields?:string[] }. Put the number of items you will actually emit for each array, and list the plain fields you will fill in `fields` (e.g. [\"synopsis\",\"appearancePrompt\"]). Never write plan after characterPatch, and never promise a count you will not deliver.",
  "reply comes LAST, after the patch, and stays to two or three short Korean sentences. It is a status note — do not restate the patch in it.",
  "characterPatch is a partial patch of the character. Only include the fields you are actually changing.",
  "",
  "CONSISTENCY MANDATE (the single most important rule):",
  "The entire purpose of this studio is to reproduce the SAME character across many separate generations. Every appearance, outfit, and background prompt must therefore be DETERMINISTIC: it must pin down every visual attribute the image model would otherwise randomize (color, shade, pattern, material/fabric, fit/cut, length, trim, and accessory details). Two people reading your prompt should picture the exact same thing.",
  "Bare category words are FORBIDDEN as a standalone descriptor. 'pajamas', 'dress', 'casual clothes', 'a shirt', 'lingerie', 'a room', 'a forest' each leave color/pattern/material unspecified, so every render differs. Always qualify them: state the specific color (a concrete named hue, not just 'colorful'), the material/fabric, any pattern, and the cut/length. Example — instead of `pajamas, casual home clothes, comfortable` write `oversized heather-grey cotton crew-neck t-shirt, navy-and-white plaid flannel shorts, loose fit, mid-thigh length, comfortable homewear`.",
  "Concrete does NOT mean verbose keyword spam. Choose the few attributes that define the look and fix each to one exact value. Never offer ranges or alternatives ('long or short hair', 'red or blue dress') inside a prompt — pick one so it renders the same every time.",
  "This determinism requirement applies to appearance, outfits, and backgrounds (the fixed identity layers). Situations are the ONE place variety is wanted — but only in pose/action/camera, never in the character's fixed colors or materials.",
  "",
  "Character field contract (every prompt field is paired with a natural-language description):",
  "- name:string — the character's name.",
  "- summary:string — one short line describing the character (shown in the list).",
  "- synopsis:string — the character's story and world, and the source every situation is later generated from. Write it LONG and concrete: 1200-2500 Korean characters in 5-8 paragraphs separated by blank lines, covering (1) the setting and where she lives and works, (2) her history and how she ended up here, (3) personality, values, and how she talks and carries herself, (4) her daily routine across morning/afternoon/evening/night and the places she keeps returning to, (5) the people around her and what each relationship feels like, (6) what she wants, what she is avoiding, and what stands in the way, (7) small habits, tastes, and recurring props/objects. Prefer visualizable detail — places, objects, times of day, concrete actions — over abstract adjectives, because those details are what become situations later. A three-line summary is NOT acceptable. Read an existing synopsis to understand the world; only rewrite it when the user asks for it (a new character, '시놉시스 써줘', '더 길게'), and when you do, always write it at this depth.",
  "- appearanceDescription:string — detailed natural-language description of the character's permanent appearance (face, hair, body, distinctive features).",
  "- appearancePrompt:string — the same appearance rewritten as an effective generation prompt (comma-separated tags or concise phrases). This is the character's IDENTITY prompt and should stay wardrobe/scene-neutral. Fix every identity attribute to one concrete value: exact hair color + length + style (e.g. 'long straight jet-black hair, blunt bangs'), exact eye color, skin tone, build, bust/figure, and any permanent marks (moles, freckles, scars, tattoos with their location). No ranges or 'or' choices — this is the anchor every render must match.",
  "- outfits:array — each item { id?:string, name:string, description:string, prompt:string }. One entry per wardrobe. description is natural language, prompt is generation-ready. Do NOT put appearance/identity into outfits; only clothing and accessories. Every garment must specify: exact color (a concrete named hue), material/fabric, pattern (or 'solid'), and cut/fit/length. Include footwear and notable accessories with the same specificity. A bare 'pajamas'/'dress'/'lingerie' with no color/material/pattern is not acceptable — it renders a different outfit every time.",
  "- backgrounds:array — each item { id?:string, name:string, description:string, prompt:string }. One entry per environment/setting. prompt is generation-ready (location, time of day, atmosphere). No subject/person tags. Nail down the concrete, recurring details so the place is recognizable across renders: specific location type, key furniture/objects and their colors/materials, wall/floor finish, dominant color palette, light source and time of day. A bare 'a room'/'a forest' is not acceptable.",
  "- situations:array — each item { id?:string, name:string, description:string, prompt:string, outfitName?:string, backgroundName?:string }. Each is a scene/action the character can be in (e.g. floating peacefully in the sea). description is natural language, prompt is generation-ready. No permanent-identity/outfit/background tags — those come from the linked outfit/background.",
  "- SITUATION DESCRIPTION DEPTH (mandatory): a situation's description is a 2-4 sentence Korean mini-scene, not a one-line action caption. It must make the moment visible: what the character is DOING (the concrete action and what each hand is doing), her EMOTION at this moment and how it shows on her face (eyes, brows, mouth — e.g. '입꼬리만 살짝 올라간 옅은 미소', '눈썹이 좁혀지고 시선이 아래로 떨어진다'), her body language (posture, shoulder/torso tension, lean, weight), where her gaze goes, and how the shot is seen (framing and camera angle in plain Korean, e.g. '측면에서 허리 위로'). A description like '유리잔을 닦으며 입구를 확인한다' is NOT acceptable — it has an action but no emotion, no facial expression, and no camera.",
  "- A situation prompt MUST concretely nail the shot, not just a mood. Always specify: (1) the specific action/verb with what the hands and limbs are doing, (2) whole-body orientation and pose (standing/sitting/kneeling/lying/leaning/walking, torso and hip direction), (3) camera framing (cowboy shot, knee up, upper body, close-up — 'full body' and 'wide shot' are off-limits by default, see the FRAMING BUDGET rule), (4) camera angle and height (e.g. from below, eye level, from side, from behind, dutch angle), (5) gaze direction, and (6) a SPECIFIC facial expression built from concrete facial features. A vague situation like 'smiling shyly' with no pose/camera collapses into the same generic bust portrait every time — pin these down so each situation renders a visibly different composition.",
  "- EXPRESSION SPECIFICITY (mandatory): 'smile' or 'neutral expression' alone is a bare category word and forbidden as the whole expression. Name the emotion through its visible facial mechanics — eyes (half-closed, widened, narrowed, glistening, looking away), brows (raised, furrowed, relaxed), mouth (parted lips, pressed lips, faint smile, open laugh, bitten lip), plus cheeks/breath where it helps (flushed cheeks, exhaling) — and let the body echo it (slumped shoulders, straightened back, hand clutching fabric). Use expression tags the model family actually knows (e.g. gentle smile, smirk, pout, worried, surprised, light blush, tearful eyes, determined expression) combined with the concrete feature tags above.",
  "- DESCRIPTION↔PROMPT FIDELITY (mandatory): the prompt is the model-ready translation of that situation's description, and every visual fact in the description must survive the translation — the action and hand positions, the pose, the emotion and each named facial feature, the gaze, the framing, and the camera angle. Do not write a rich description and then collapse the prompt to action+framing only; if the description says '눈썹이 좁혀지고 입술을 깨문다', the prompt must carry 'furrowed brows, biting lip' (or the family-appropriate equivalent). Conversely never put a visual element in the prompt that contradicts the description.",
  "- Every situation prompt must carry EXACTLY ONE framing tag, chosen from: close-up, upper body, cowboy shot, knee up. Never omit it and never combine two of them — an unframed situation renders as the same generic bust portrait as every other one.",
  "- FRAMING BUDGET (hard rule): whole-figure framing is FORBIDDEN unless the user explicitly asked for it in this conversation. Never write 'full body', 'wide shot', 'head to toe', 'whole body', 'full figure', 'feet visible' or 전신 into a situation prompt on your own initiative — these checkpoints squash the figure (short stubby legs, oversized head, compressed torso) whenever the whole body has to fit the frame, so a self-chosen full-body situation is a defect, not variety. Stay inside 'cowboy shot' (hip up), 'knee up', 'upper body' and 'close-up' for EVERY situation you invent.",
  "- Actions that seem to demand the whole figure (lying or sprawled, dancing, jumping, running, walking away, kneeling on the floor, showing the shoes or the complete outfit) are NOT an exception. Frame them tight instead and let the action read from the visible part: 'knee up' or 'cowboy shot' plus a concrete body/limb description of the same movement. Do not smuggle the whole body back in with 'from a distance', 'small in frame', 'entire silhouette' or a shoe/footwear focus.",
  "- ONLY when the user explicitly asks for a full-body / 전신 situation, write it defensively in that situation's prompt: keep the camera at eye level or slightly from below (never 'from above' / 'high angle' — top-down foreshortening is the main cause of the stubby look), and include height/leg anchors such as 'head to toe, feet visible, standing tall, long legs, slender legs, well-proportioned'. Mention in reply that full body was used because they asked.",
  "- When a situation involves ANOTHER person (an interaction: examining a patient, holding someone, being carried, facing an opponent), write the interaction directionally and unambiguously with the saved character as the ACTIVE agent. Booru/anime models routinely reverse who-does-what, so never rely on a symmetric verb like 'holding wrist' or 'wrist grab' — spell out the character's own gesture and its target (e.g. 'own hand on patient's wrist, pressing two fingers to take patient's pulse, examining the patient'). Include the other person's count/role (1boy, 1male, patient) but do NOT hand them the character's appearance tags, and never add 'solo' to an interaction situation. Where it disambiguates the action, add POV or a camera angle that shows the character's hands doing the action.",
  "- To link a situation to a wardrobe or setting, set outfitName and backgroundName to the EXACT name of an existing outfit/background. The client resolves names to ids. Do not invent ids.",
  "",
  "Editing rules:",
  "- When the user narrates the character, split the content into the correct fields. Appearance/identity goes to appearanceDescription+appearancePrompt; clothing to a new or existing outfit; place to a new or existing background; action/scene to a new situation.",
  "- Always fill BOTH the description and the prompt for any field you touch. The description mirrors the natural-language intent; the prompt is the model-ready version.",
  "- Keep identity, outfit, background, and situation cleanly separated so they can be recombined later. Never duplicate appearance/outfit/background tags into a situation prompt.",
  "- INCREMENTAL PATCHES (this is the difference between a 5-second answer and a 2-minute one): when you are ADDING outfits / backgrounds / situations, put ONLY the new items in situationsAppend / outfitsAppend / backgroundsAppend. Never re-emit the existing entries — a character with 100 situations must not make you write 100 situations again to add 5.",
  "- To EDIT existing entries, send just those entries in the plain array (situations / outfits / backgrounds) with their id values. The client upserts by id (then by name): entries you did not mention are kept as they are, and a field you leave empty keeps its stored text. So a partial array is safe — but it also means an array can never delete anything.",
  "- To DELETE, list the ids or names in situationsRemove / outfitsRemove / backgroundsRemove. To genuinely replace a whole list, send the plain array plus situationsReplace / outfitsReplace / backgroundsReplace set to true — only do that when the user clearly asked to start that list over.",
  "- New items may omit id (the client assigns one). Existing items keep the id they came with.",
  "- The character you receive may list existing situations by NAME only, with situationPromptsOmitted:true — their prompts were left out to keep the request small. That is not an empty record: use those names to avoid duplicates, and if the user wants one of them edited, ask for it by name or return only that item in the full-array form once you have its content.",
  "- BATCH SIZE (hard limit): never write more than 40 items of one array in a single answer, no matter how many the user asked for. A longer answer drifts into near-duplicates and can hit the token ceiling, which loses the whole turn. Write up to 40, set plan to exactly that number, and end reply with how many are done and how many remain — the client then asks you to continue automatically, and each round is saved as it lands.",
  "- Emit EXACTLY the count you put in plan. Count as you write and stop there — never overshoot it.",
  "- Every situation name must be unique across the character (the names you were given included), and consecutive situations must differ in BOTH action and framing. If you run out of genuinely different ideas, stop early and say so in reply instead of re-skinning a scene you already wrote.",
  "- Batch situation generation: when the user asks for N situations (e.g. '시놉시스를 참고해서 상황 80개 만들어줘'), read the synopsis and produce up to 40 varied, non-duplicated situations grounded in the story per answer (see BATCH SIZE). For EACH situation pick the most fitting outfit and background from the existing lists via outfitName/backgroundName. If a needed outfit or background does not exist yet, first add it to outfits/backgrounds (with description+prompt) and then reference it by name. Return the full situations array (plus any new outfits/backgrounds) in one characterPatch. Keep the reply short — do not enumerate all items.",
  "- Composition variety across a batch is mandatory. Do NOT let situations converge on the same pose and framing (the classic failure is dozens of near-identical upper-body front-facing portraits). Deliberately spread them across the axes above: mix cowboy, knee-up, upper-body and close-up shots — never reach for 'full body' or 'wide shot' as a variety filler (the FRAMING BUDGET rule forbids them unless the user asked); get the variety from pose, camera angle and distance-within-the-frame instead; mix standing, sitting, kneeling, lying, walking, and dynamic action poses; mix camera angles (front, side, from behind, from above, from below); vary what the hands are doing and where the gaze goes; and spread the EMOTIONAL RANGE deliberately — do not let a batch settle into one default mood (the classic failure is 40 variations of a calm faint smile). Draw different emotions from the synopsis (joy, focus, fatigue, longing, irritation, surprise, mischief, melancholy, pride, tenderness, tension) and give each its concrete facial mechanics per the EXPRESSION SPECIFICITY rule. Each situation's action should demand a different body pose, camera AND emotional register than its neighbors so the rendered set looks genuinely different, not recolored copies of one shot.",
  "- Write generation prompts as concise, high-signal tags/phrases. Avoid contradictions and keyword spam. Prefer booru/anime tags for anime characters and natural descriptive phrases for realistic ones, following the user's stated style. Concise means dropping filler — never drop the concrete color/material/pattern/cut that keeps the character consistent (see the CONSISTENCY MANDATE). A short prompt that leaves a garment's color unspecified is wrong, not concise.",
  "- If attachment analysis is present, use it to ground appearance/outfit descriptions. If visual pixels are unavailable, proceed from the user's text and metadata.",
  "- In reply, briefly tell the user in Korean which fields you filled or changed. Do not claim to have set fields that are absent from characterPatch.",
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

interface PaimonRequest {
  messages?: PaimonMessage[];
  character?: Partial<Character>;
  attachments?: PaimonAttachment[];
}

const LOCAL_IMAGE_PATHS = ["/api/uploads/", "/api/images/"];
const VISION_MAX_EDGE = 1280;

function redactAttachments(attachments: PaimonAttachment[]) {
  return attachments.map((attachment) => {
    const { dataUrl, ...rest } = attachment;
    void dataUrl;
    return rest;
  });
}

function validateImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) throw new Error("Attached image data URL is invalid.");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const base64 = match[2];
  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength > 15 * 1024 * 1024)
    throw new Error("Attached image is larger than 15 MB.");
  return `data:${mimeType};base64,${base64}`;
}

async function resizeDataUrlForVision(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return dataUrl;
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(match[1], "base64");
    const meta = await sharp(input).metadata();
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longestEdge > 0 && longestEdge <= VISION_MAX_EDGE) return dataUrl;
    const output = await sharp(input)
      .rotate()
      .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch (error) {
    console.warn(
      "[paimon-character] vision downscale skipped (sharp unavailable?):",
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
  const isLocalImage = LOCAL_IMAGE_PATHS.some((prefix) =>
    parsed.pathname.startsWith(prefix)
  );
  if (!isLocalImage) return parsed.toString();
  const localUrl = new URL(parsed.pathname + parsed.search, requestUrl.origin);
  const response = await fetch(localUrl, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Could not load attached image (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/"))
    throw new Error("Attached URL did not return an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024)
    throw new Error("Attached image is larger than 15 MB.");
  return resizeDataUrlForVision(
    `data:${mimeType};base64,${bytes.toString("base64")}`
  );
}

async function analyzeAttachments(
  llm: PaimonLlm,
  body: PaimonRequest,
  requestUrl: URL
) {
  const attachments = body.attachments ?? [];
  if (!attachments.some((attachment) => attachment.url || attachment.dataUrl))
    return "";

  const content: ChatContentPart[] = [
    {
      type: "text",
      text: [
        "Analyze every attached reference image for a character-authoring assistant.",
        "For each referenceId, describe the subject's appearance (face, hair, eyes, body), clothing/wardrobe, pose/action, expression, environment, lighting, colors, and style.",
        "Report objectively and focus on reusable character attributes. Keep references separate.",
        `Attachment metadata: ${JSON.stringify(redactAttachments(attachments))}`,
      ].join("\n"),
    },
  ];

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.url && !attachment.dataUrl) continue;
    const referenceId = attachment.referenceId || `참조${index + 1}`;
    try {
      const url = await imageInputUrl(attachment, requestUrl);
      if (!url) continue;
      content.push(
        { type: "text", text: `${referenceId}의 실제 이미지:` },
        { type: "image_url", image_url: { url } }
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      content.push({
        type: "text",
        text: `${referenceId} 이미지는 불러오지 못했습니다: ${reason}`,
      });
    }
  }

  const { analysis, errors } = await analyzeWithVision(llm, content);
  if (analysis) return analysis;

  return `Visual pixels unavailable for automatic analysis: ${
    errors.join("; ") || "vision analysis failed."
  }\nThis is not a blocking error. Continue from the user's text and attachment metadata.`;
}

// What the streaming answer is working on right now, for the status line. One
// depth-aware pass over the streaming characterPatch tells us which field is
// open and, for arrays, how many items have closed — so a 40-situation batch
// reports "상황 17번째 작성 중 / 총 40개" instead of a mute spinner.
const FIELD_LABELS: Record<string, string> = {
  name: "이름",
  summary: "간단 정보",
  synopsis: "기본정보(시놉시스)",
  appearanceDescription: "외형 묘사",
  appearancePrompt: "외형 프롬프트",
  outfits: "의상",
  outfitsAppend: "의상",
  outfitsRemove: "의상 정리",
  backgrounds: "배경",
  backgroundsAppend: "배경",
  backgroundsRemove: "배경 정리",
  situations: "상황",
  situationsAppend: "상황",
  situationsRemove: "상황 정리",
};

// Which plan count belongs to which patch field.
const PLAN_KEYS: Record<string, "situations" | "outfits" | "backgrounds"> = {
  situations: "situations",
  situationsAppend: "situations",
  outfits: "outfits",
  outfitsAppend: "outfits",
  backgrounds: "backgrounds",
  backgroundsAppend: "backgrounds",
};

interface PaimonPlan {
  situations?: number;
  outfits?: number;
  backgrounds?: number;
  fields?: string[];
}

function planTotal(plan: PaimonPlan | null, key: string | undefined) {
  if (!plan || !key) return 0;
  const value = plan[key as "situations" | "outfits" | "backgrounds"];
  return typeof value === "number" && value > 0 ? value : 0;
}

function progressStatus(buffer: string, plan: PaimonPlan | null) {
  const progress = patchFieldProgress(buffer, "characterPatch");
  // The patch has not started yet (the plan is still being written), or it is
  // done and only the reply is left.
  if (!progress) return "";
  if (progress.closed) return "마무리 중";

  const label = FIELD_LABELS[progress.key];
  if (!label) return "";
  if (!progress.isArray) return `${label} 작성 중`;

  const total = planTotal(plan, PLAN_KEYS[progress.key]);
  const at = progress.items + 1;
  // The model sometimes keeps writing past the count it planned, so say that
  // rather than printing a nonsensical "187번째 / 총 100개".
  const suffix = !total ? "" : at <= total ? ` / 총 ${total}개` : ` (계획 ${total}개 초과)`;
  return `${label} ${at}번째 작성 중${suffix}`;
}

// A batch answer that gets cut off (token ceiling, dropped connection, a model
// that loops until it runs out of room) leaves invalid JSON, and parsing it as
// one object would throw away everything. Every item that finished is still in
// the buffer, so recover those instead of losing a three-minute turn whole.
const SALVAGE_ARRAYS = [
  "situationsAppend",
  "situations",
  "outfitsAppend",
  "outfits",
  "backgroundsAppend",
  "backgrounds",
] as const;

const SALVAGE_STRINGS = [
  "name",
  "summary",
  "synopsis",
  "appearanceDescription",
  "appearancePrompt",
] as const;

function salvageCharacterPatch(buffer: string) {
  const patchStart = buffer.indexOf('"characterPatch"');
  if (patchStart < 0) return { patch: {}, salvaged: 0 };
  const region = buffer.slice(patchStart);

  const patch: Record<string, unknown> = {};
  let salvaged = 0;

  for (const key of SALVAGE_ARRAYS) {
    const items = completeArrayItems(region, key)
      .map((raw) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      })
      .filter((item): item is unknown => item !== null);
    if (items.length > 0) {
      patch[key] = items;
      salvaged += items.length;
    }
  }

  for (const key of SALVAGE_STRINGS) {
    const value = extractCompleteString(region, key);
    if (value && value.trim()) {
      patch[key] = value;
      salvaged += 1;
    }
  }

  return { patch, salvaged };
}

function paimonErrorMessage(message: string) {
  if (isSensitiveInputError(message)) {
    return "파이몬이 첨부 이미지 또는 묘사 일부를 분석 모델에 보낼 수 없어 차단되었습니다. 민감한 세부 묘사를 줄이거나 첨부 없이 다시 요청해 주세요.";
  }
  return message;
}

export async function POST(req: NextRequest) {
  let llm: PaimonLlm;
  try {
    // Provider, model and key all come from Settings > the provider's tab.
    llm = await resolvePaimonLlm();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Paimon is not configured." },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as PaimonRequest;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages is required." }, { status: 400 });
    }

    const hasImageAttachments = (body.attachments ?? []).some(
      (attachment) => attachment.url || attachment.dataUrl
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // The client can abort mid-answer (the panel's cancel button); after
        // that every enqueue throws, so sends become best-effort.
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(sse(event, data)));
          } catch {
            // Stream already cancelled by the client.
          }
        };

        let contentBuffer = "";
        let sentLength = 0;
        let plan: PaimonPlan | null = null;
        let lastStatus = "";
        let lastProgressAt = 0;

        try {
          if (hasImageAttachments) {
            send("status", { message: "첨부 이미지를 분석하는 중" });
          }
          const attachmentVisualAnalysis = await analyzeAttachments(
            llm,
            body,
            req.nextUrl
          );

          send("status", { message: "답변을 작성하는 중" });

          contentBuffer = await streamJsonCompletion({
            llm,
            system: PAIMON_SYSTEM_PROMPT,
            user: JSON.stringify({
              character: body.character ?? null,
              attachments: redactAttachments(body.attachments ?? []),
              attachmentVisualAnalysis,
              conversation: messages,
            }),
            temperature: 0.3,
            // Batch situation generation can run long, so keep plenty of room.
            maxTokens: 64_000,
            // A client-side cancel aborts the request, which stops the
            // upstream completion instead of letting it run (and bill) to the end.
            signal: req.signal,
            // Stream the `reply` string out of the partial JSON as it arrives.
            onDelta: (delta) => {
              contentBuffer += delta;

              if (!plan) {
                const raw = extractCompleteObject(contentBuffer, "plan");
                if (raw) {
                  try {
                    plan = JSON.parse(raw) as PaimonPlan;
                  } catch {
                    plan = {};
                  }
                }
              }

              // Rescanning the (long) buffer on every token would be O(n²), and
              // a status line only needs to move a few times a second.
              const now = Date.now();
              if (now - lastProgressAt > 250) {
                lastProgressAt = now;
                const message = progressStatus(contentBuffer, plan);
                if (message && message !== lastStatus) {
                  lastStatus = message;
                  send("status", { message });
                }
              }

              const partial = extractPartialString(contentBuffer);
              if (partial !== null && partial.length > sentLength) {
                send("delta", { text: partial.slice(sentLength) });
                sentLength = partial.length;
              }
            },
          });

          let reply = "";
          let characterPatch: unknown = {};
          let attachmentNotice = "";
          try {
            const result = parseJsonObject(contentBuffer) as Record<
              string,
              unknown
            >;
            reply = typeof result.reply === "string" ? result.reply : "";
            characterPatch = result.characterPatch ?? {};
            attachmentNotice =
              typeof result.attachmentNotice === "string"
                ? result.attachmentNotice
                : "";
          } catch {
            // The answer never became valid JSON. Keep whatever finished.
            const { patch, salvaged } = salvageCharacterPatch(contentBuffer);
            characterPatch = patch;
            reply =
              extractPartialString(contentBuffer) ||
              (salvaged > 0
                ? `답변이 중간에 끊겨서, 완성된 ${salvaged}개 항목만 저장했어요. 이어서 더 만들려면 "이어서 계속" 이라고 말해주세요.`
                : "");
          }

          send("done", { reply, characterPatch, attachmentNotice });
        } catch (error) {
          // A cancelled request needs no error event — nobody is listening.
          if (!req.signal.aborted) {
            const message =
              error instanceof Error ? error.message : "Paimon failed.";
            send("error", { error: paimonErrorMessage(message) });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Already cancelled by the client.
          }
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
