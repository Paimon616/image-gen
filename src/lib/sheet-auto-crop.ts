// BETA 기준 시트 — automatic 참조 영역. Finds the front-facing full-body figure
// on a character reference sheet and returns a square head-to-chest region.
//
// Sheets have no fixed layout (back view first, expression grid on the left,
// figures touching...), so a fixed corner crop often lands on a back view or a
// tiny expression head. This is a pure pixel heuristic on a downscaled RGB
// buffer (no model, no network):
//   1. foreground = pixels far from the border's background colour
//   2. connected components → full-body figures are the tall ones
//   3. a figure facing the viewer shows skin in its head band; a back view
//      shows only hair, so the head band with the most skin wins
//   4. the square starts just above that head, sized from the figure height
// Falls back to the largest skin-showing component, then to null (the caller
// keeps DEFAULT_SHEET_CROP).

export interface SheetRegion {
  x: number;
  y: number;
  size: number;
}

/** Head-to-chest square side as a fraction of the figure's height. */
const REGION_OF_FIGURE = 0.38;
/** Figures at least this tall (fraction of the image) count as full body. */
const FULL_BODY_MIN_HEIGHT = 0.55;
/** Top part of a figure checked for a visible face. */
const HEAD_BAND = 0.16;

export function isSkinTone(r: number, g: number, b: number) {
  // Light anime skin, e.g. (250,225,210). Excludes white/grey (r-b small),
  // pink hair (b > g), blonde hair (b/r low) and saturated reds (g/r low).
  return (
    r > 170 &&
    r - b > 18 &&
    g >= b - 4 &&
    g / r >= 0.74 &&
    g / r <= 0.97 &&
    b / r >= 0.68 &&
    b / r <= 0.95
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 255;
}

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  label: number;
}

/**
 * @param rgb  packed RGB bytes, row-major, width × height × 3
 * @returns region normalized like DEFAULT_SHEET_CROP (size × image width), or null
 */
export function findSheetFocus(rgb: Uint8Array, width: number, height: number): SheetRegion | null {
  const n = width * height;
  if (width < 16 || height < 16 || rgb.length < n * 3) return null;
  const px = (i: number) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]] as const;

  // 1. Background colour from the border.
  const border: number[][] = [[], [], []];
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const p = px(y * width + x);
      for (let c = 0; c < 3; c++) border[c].push(p[c]);
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const p = px(y * width + x);
      for (let c = 0; c < 3; c++) border[c].push(p[c]);
    }
  }
  const bg = border.map(median);
  const fg = new Uint8Array(n);
  const skin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = px(i);
    const dist = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    if (dist > 36) fg[i] = 1;
    if (isSkinTone(r, g, b)) skin[i] = 1;
  }

  // 2. Connected components (8-neighbour) of the foreground.
  const labels = new Int32Array(n).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!fg[start] || labels[start] !== -1) continue;
    const comp: Component = { minX: width, minY: height, maxX: 0, maxY: 0, count: 0, label: components.length };
    labels[start] = comp.label;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      comp.count++;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (fg[j] && labels[j] === -1) {
            labels[j] = comp.label;
            stack.push(j);
          }
        }
      }
    }
    if (comp.count >= n * 0.002) components.push(comp);
  }
  if (components.length === 0) return null;

  // 3. Face in the head band: skin columns clustered, best cluster wins.
  const headOf = (comp: Component) => {
    const compH = comp.maxY - comp.minY + 1;
    const bandEnd = comp.minY + Math.max(2, Math.round(compH * HEAD_BAND));
    const columns = new Array<number>(width).fill(0);
    const fgColumns = new Array<number>(width).fill(0);
    for (let y = comp.minY; y <= bandEnd && y < height; y++) {
      for (let x = comp.minX; x <= comp.maxX; x++) {
        const i = y * width + x;
        if (labels[i] !== comp.label) continue;
        fgColumns[x]++;
        if (skin[i]) columns[x]++;
      }
    }
    // Contiguous runs of skin columns (gaps up to 2 px) = candidate faces.
    const runs: { from: number; to: number; skin: number }[] = [];
    let run: { from: number; to: number; skin: number } | null = null;
    let gap = 0;
    for (let x = comp.minX; x <= comp.maxX + 3; x++) {
      const value = x <= comp.maxX ? columns[x] : 0;
      if (value > 0) {
        if (!run) run = { from: x, to: x, skin: 0 };
        run.to = x;
        run.skin += value;
        gap = 0;
      } else if (run && ++gap > 1) {
        runs.push(run);
        run = null;
      }
    }
    const torsoEnd = comp.minY + Math.round(compH * 0.6);
    let best: { centerX: number; top: number; ratio: number; score: number } | null = null;
    for (const face of runs) {
      const faceW = face.to - face.from + 1;
      // An arm or a sliver of neck, not a face.
      if (faceW < Math.max(3, compH * 0.035)) continue;
      const pad = Math.round(faceW / 2);
      const from = Math.max(comp.minX, face.from - pad);
      const to = Math.min(comp.maxX, face.to + pad);
      // Skin share of the head band under this face only, so figures that
      // touch (one merged component) are judged per head, not diluted.
      let fgUnderFace = 0;
      for (let x = from; x <= to; x++) fgUnderFace += fgColumns[x];
      const ratio = fgUnderFace > 0 ? face.skin / fgUnderFace : 0;
      // Below a real head is a clothed torso; below a head in an expression
      // column are more faces. Lots of skin there = stacked heads.
      let torsoFg = 0;
      let torsoSkin = 0;
      for (let y = bandEnd + 1; y <= torsoEnd && y < height; y++) {
        for (let x = from; x <= to; x++) {
          const i = y * width + x;
          if (labels[i] !== comp.label) continue;
          torsoFg++;
          if (skin[i]) torsoSkin++;
        }
      }
      // Faces stacked down the same columns = an expression column, not a body.
      let faceRows = 0;
      let rowRun = 0;
      let rowGap = 0;
      const minRun = Math.max(3, Math.round(compH * 0.04));
      for (let y = comp.minY; y <= comp.maxY + 2; y++) {
        let rowSkin = 0;
        if (y <= comp.maxY) {
          for (let x = face.from; x <= face.to; x++) if (skin[y * width + x]) rowSkin++;
        }
        if (rowSkin >= faceW * 0.3) {
          rowRun++;
          rowGap = 0;
        } else if (rowRun > 0 && ++rowGap > 1) {
          if (rowRun >= minRun) faceRows++;
          rowRun = 0;
          rowGap = 0;
        }
      }
      const stacked = faceRows >= 3 || (torsoFg > 0 && torsoSkin / torsoFg > 0.18);
      const score = ratio * (stacked ? 0.3 : 1);
      if (best && score <= best.score) continue;
      // Top of the hair above that face.
      let top = comp.maxY;
      for (let y = comp.minY; y <= comp.maxY && top === comp.maxY; y++) {
        for (let x = face.from; x <= face.to; x++) {
          if (labels[y * width + x] === comp.label) {
            top = y;
            break;
          }
        }
      }
      best = { centerX: (face.from + face.to) / 2, top, ratio, score };
    }
    return best;
  };

  const pick = (candidates: Component[], minRatio: number) => {
    let chosen: { comp: Component; head: NonNullable<ReturnType<typeof headOf>>; score: number } | null = null;
    for (const comp of candidates) {
      const head = headOf(comp);
      if (!head || head.ratio < minRatio) continue;
      // A blob much wider than a standing figure is a group or an expression
      // grid: usable, but an isolated full-body figure is preferred.
      const wide = comp.maxX - comp.minX + 1 > (comp.maxY - comp.minY + 1) * 0.5;
      const score = head.score * (wide ? 0.6 : 1);
      if (!chosen || score > chosen.score) chosen = { comp, head, score };
    }
    return chosen;
  };

  const fullBody = components.filter((c) => c.maxY - c.minY + 1 >= height * FULL_BODY_MIN_HEIGHT);
  const chosen =
    pick(fullBody, 0.04) ??
    pick([...components].sort((a, b) => b.count - a.count).slice(0, 6), 0.06);
  if (!chosen) return null;

  // 4. Square from just above the head, sized from the figure height.
  const figureH = chosen.comp.maxY - chosen.comp.minY + 1;
  const tall = figureH >= height * FULL_BODY_MIN_HEIGHT;
  const sidePx = Math.min(height, width, Math.max(width * 0.08, figureH * (tall ? REGION_OF_FIGURE : 0.9)));
  const left = Math.min(Math.max(0, chosen.head.centerX - sidePx / 2), width - sidePx);
  const top = Math.min(Math.max(0, chosen.head.top - sidePx * 0.05), height - sidePx);
  return {
    x: round(left / width),
    y: round(top / height),
    size: round(sidePx / width),
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
