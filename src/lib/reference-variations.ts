// Builds the "varied batch" prompts for the buttons under the image-URL box.
// The on-screen prompt stays as the user wrote it (style, character, outfit,
// quality tags); only its pose, expression, background and camera parts are
// swapped per image for variations of them. Generation runs on Krea 2 with the
// on-screen reference at 0.7 and no extra LoRAs (pose / angle / emotion LoRAs
// pull their own training style in).

export interface VariationPlan {
  gender: "female" | "male";
  // The on-screen prompt with its pose / expression / background / camera
  // fragments taken out.
  base: string;
  removed: string[];
  // The place the prompt describes as a whole (a British castle and its
  // grounds), split into backgrounds (garden, drawing room, bedroom, terrace...).
  setting: string;
  backgrounds: string[];
  // Variations of the pose and expression in the prompt.
  poses: string[];
  expressions: string[];
}

// Removes exact fragments (tags or phrases) from a prompt and tidies the
// separators left behind.
export function removePromptFragments(prompt: string, fragments: string[]) {
  let result = prompt;
  // Longest first, so "castle interior" goes before "castle".
  for (const fragment of [...fragments].sort((a, b) => b.length - a.length)) {
    const index = result.indexOf(fragment);
    if (index >= 0) result = result.slice(0, index) + result.slice(index + fragment.length);
  }
  return result
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,;])(\s*[,;])+/g, "$1")
    .replace(/\.(\s*[,.])+/g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;]+|[\s,;]+$/g, "")
    .trim();
}

export const ANALYSIS_VERSION = 5;

export const VARIATION_COUNTS = [10, 30, 50, 100] as const;
export const VARIATION_REFERENCE_STRENGTH = 0.7;
export const VARIATION_NEGATIVE_PROMPT =
  "lowres, worst quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra arms, extra legs, deformed, disfigured, duplicate, two people, watermark, text, signature, logo, cropped head";

const POSES = [
  "she stands with her weight on one leg, one hand on her hip",
  "she sits on a chair leaning forward with her chin resting on both hands",
  "she walks toward the viewer mid-step, arms swinging naturally",
  "she leans her back against a wall with her arms crossed",
  "she sits on the floor hugging her knees to her chest",
  "she stretches both arms high above her head",
  "she kneels on one knee, tying a shoelace",
  "she sits sideways on a bench with her legs crossed",
  "she leans on a railing with both elbows, looking into the distance",
  "she twirls in place, her hair and jacket swinging out",
  "she crouches down, resting her arms on her knees",
  "she lies on her stomach, propped up on her elbows, feet kicked up behind her",
  "she holds a cup with both hands close to her face",
  "she points at the viewer with one finger, leaning forward",
  "she brushes her hair behind her ear with one hand",
  "she jumps with both feet off the ground, arms spread wide",
  "she sits at a desk with her cheek resting on one hand",
  "she holds a book open against her chest",
  "she makes a peace sign next to her face",
  "she runs, hair streaming behind her",
  "she leans against a doorframe with one shoulder",
  "she adjusts the collar of her jacket with both hands",
  "she sits on a windowsill with one knee raised",
  "she reaches out one hand toward the viewer",
  "she covers her mouth with one hand",
  "she lies on her back with her arms spread out, seen from above",
  "she bends forward with her hands on her knees",
  "she hugs herself with both arms",
  "she stands with both hands in her pockets",
];

const EXPRESSIONS = [
  "a bright open-mouthed laugh with her eyes squeezed shut",
  "a soft gentle smile",
  "a shy blush, eyes glancing away",
  "a playful wink with her tongue slightly out",
  "a calm neutral expression with half-lidded eyes",
  "a surprised look with wide eyes and a small open mouth",
  "a playful pout with puffed cheeks",
  "a teasing sly smirk",
  "a sleepy yawn",
  "a determined serious look",
  "a dreamy far-away gaze",
  "a flustered expression with a deep blush and a sweat drop",
  "a confident grin",
  "a sad teary-eyed look",
  "an annoyed frown",
  "eyes closed with a peaceful smile",
  "an embarrassed smile, scratching her cheek",
  "a mischievous grin",
  "a curious head tilt with raised eyebrows",
  "an excited sparkling-eyed smile",
  "a gentle laugh behind her hand",
  "a cool expressionless stare at the viewer",
  "a nervous smile",
  "a happy smile with one eye closed",
];

const CAMERAS = [
  { angle: "eye level shot", desc: "a medium shot from the waist up with a 50mm lens" },
  { angle: "high angle shot", desc: "from above with a 35mm lens, full body" },
  { angle: "low angle shot", desc: "from below at knee height with a 24mm wide-angle lens, full body" },
  { angle: "eye level shot", desc: "an 85mm close-up from the chest up" },
  { angle: "eye level shot", desc: "a three-quarter side view framed from the knees up" },
  { angle: "high angle shot", desc: "from above with a 50mm lens, framed from the knees up" },
  { angle: "eye level shot", desc: "a wide 28mm shot, full body with plenty of background" },
  { angle: "dutch angle shot", desc: "a tilted medium shot from the waist up" },
  { angle: "eye level shot", desc: "an extreme close-up portrait of her face" },
  { angle: "bird's eye view", desc: "straight down from above" },
  { angle: "worm's eye view", desc: "from the ground looking up with a 16mm lens" },
  { angle: "eye level shot", desc: "a medium-long shot from the thighs up with a 50mm lens" },
];

// Body direction plus face angle, a third each front / side / back. Left and right
// are relative to the picture: "her left" made the model face the same way both
// times, while "toward the left edge of the frame" separates them reliably.
const VIEWS = [
  // front
  "Her body faces the viewer. Her face is turned straight to the camera, a symmetrical frontal view with both eyes looking into the lens",
  "Her body faces the viewer. Her face is in a three-quarter view turned toward the LEFT side of the picture, her nose pointing to the left of the frame",
  "Her body faces the viewer. Her face is in a three-quarter view turned toward the RIGHT side of the picture, her nose pointing to the right of the frame",
  "Her body faces the viewer. Her head is tilted back and she looks up, her chin raised",
  "Her body faces the viewer. Her head is bowed and she looks down, eyes lowered",
  // side
  "Her whole body is seen from the side, facing the LEFT edge of the picture. Her face is an exact side profile: nose, lips and chin point to the left side of the frame and the back of her head is on the right side",
  "Her whole body is seen from the side, facing the RIGHT edge of the picture. Her face is an exact side profile: nose, lips and chin point to the right side of the frame and the back of her head is on the left side",
  "Her body is seen from the side, facing the LEFT edge of the picture, and she turns her face toward the camera in a three-quarter view",
  "Her body is seen from the side, facing the RIGHT edge of the picture, and she turns her face toward the camera in a three-quarter view",
  // back
  "She is seen from behind: her back faces the camera and she looks back over her LEFT shoulder toward the camera, her face in profile",
  "She is seen from behind: her back faces the camera and she looks back over her RIGHT shoulder toward the camera, her face in three-quarter view",
  "She is seen from behind: her back and the back of her head face the camera and her face is not visible, she looks into the scene",
];

function shuffled<T>(items: readonly T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Cycles through a shuffled list so every item is used before any repeats.
function deck<T>(items: readonly T[]) {
  let cards: T[] = [];
  return () => {
    if (cards.length === 0) cards = shuffled(items);
    return cards.pop() as T;
  };
}

const sentence = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? `${trimmed} ` : `${trimmed}. `;
};

// The lists are written for a female character; swap pronouns for a male one.
function toMale(text: string) {
  return text
    .replace(/\bherself\b/g, "himself")
    .replace(/\bShe\b/g, "He")
    .replace(/\bshe\b/g, "he")
    .replace(/\bHer\b/g, "His")
    .replace(/\bher\b/g, "his");
}

export function buildVariationPrompts(plan: VariationPlan, count: number) {
  const pose = deck(plan.poses.length >= 4 ? plan.poses : POSES);
  const expression = deck(plan.expressions.length >= 4 ? plan.expressions : EXPRESSIONS);
  const camera = deck(CAMERAS);
  const view = deck(VIEWS);
  const background = deck(plan.backgrounds);
  const base = /[.!?,]$/.test(plan.base) ? plan.base : `${plan.base}.`;

  return Array.from({ length: count }, () => {
    const direction = view();
    let shot = camera();
    // A back view has no face to frame; swap a face close-up for the next camera.
    if (/from behind/.test(direction) && /close-up/.test(shot.desc)) shot = camera();
    const variation =
      `${shot.angle}. ` +
      sentence(`Pose: ${pose()}`) +
      sentence(`Direction: ${direction}`) +
      sentence(`Expression: ${expression()}`) +
      sentence(`Camera: ${shot.desc}`) +
      sentence(
        plan.setting
          ? `Background: ${background()}, part of ${plan.setting}`
          : `Background: ${background()}`
      ) +
      "One person only, clean anatomy with five fingers on each hand, no text, no watermark.";
    return `${base} ${plan.gender === "male" ? toMale(variation) : variation}`.trim();
  });
}
