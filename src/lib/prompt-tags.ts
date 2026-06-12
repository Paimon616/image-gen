const PROMPT_TAG_STOP_WORDS = new Set([
  "best quality",
  "high quality",
  "highres",
  "high res",
  "masterpiece",
  "newest",
  "score 9",
  "score 8",
  "score 7",
  "very aesthetic",
  "absurdres",
  "lazypos",
  "lazyneg",
  "break",
]);

function normalizeTagList(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 80)
    )
  ).slice(0, 64);
}

function normalizePromptTag(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([()])/g, "$1")
    .replace(/[()[\]{}]/g, " ")
    .replace(/:[\d.]+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function addPromptTag(tags: Set<string>, value: string) {
  const tag = normalizePromptTag(value);

  if (
    !tag ||
    tag.length > 80 ||
    PROMPT_TAG_STOP_WORDS.has(tag) ||
    /^\d+$/.test(tag)
  ) {
    return;
  }

  tags.add(tag);
}

export function inferTagsFromPrompt(prompt: string, nsfwLevel?: number) {
  const tags = new Set<string>();
  const normalizedPrompt = normalizePromptTag(prompt);

  prompt
    .replace(/<lora:[^>]+>/gi, " ")
    .split(/[,;\uFF0C\n]+/)
    .forEach((part) => addPromptTag(tags, part));

  const includesAny = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(normalizedPrompt));
  const male =
    includesAny([/\b1boy\b/, /\bmale focus\b/, /\bmale\b/, /\bman\b/]) &&
    !includesAny([/\b1girl\b/, /\bfemale focus\b/]);
  const nude = includesAny([/\bnude\b/, /\bnaked\b/, /\bnudity\b/]);

  if (nsfwLevel && nsfwLevel >= 4) addPromptTag(tags, "nudity");
  if (nude) addPromptTag(tags, "nudity");
  if (male) {
    addPromptTag(tags, "man");
    addPromptTag(tags, "male");
  }
  if (male && (nude || (nsfwLevel && nsfwLevel >= 8))) {
    addPromptTag(tags, "explicit male nudity");
  }
  if (includesAny([/\bsolo\b/])) addPromptTag(tags, "solo");
  if (includesAny([/\bmale focus\b/])) addPromptTag(tags, "male focus");
  if (includesAny([/\bshort hair\b/])) addPromptTag(tags, "short hair");
  if (includesAny([/\bgrey hair\b/, /\bgray hair\b/, /\bsilver hair\b/])) {
    addPromptTag(tags, "grey hair");
  }
  if (includesAny([/\bgrey eyes\b/, /\bgray eyes\b/])) {
    addPromptTag(tags, "grey eyes");
  }
  if (includesAny([/\blooking at viewer\b/])) {
    addPromptTag(tags, "looking at viewer");
  }
  if (includesAny([/\blying on back\b/])) {
    addPromptTag(tags, "lying");
    addPromptTag(tags, "on back");
  }
  if (includesAny([/\bpillow\b/])) addPromptTag(tags, "pillow");
  if (includesAny([/\bteeth\b/])) addPromptTag(tags, "teeth");
  if (includesAny([/\bcollarbones?\b/])) addPromptTag(tags, "collarbone");
  if (includesAny([/\bnude\b/, /\bupper body\b/])) {
    addPromptTag(tags, "upper body");
  }

  return normalizeTagList(Array.from(tags));
}
