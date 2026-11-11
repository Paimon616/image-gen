// BETA 기준 시트 — automatic 참조 영역. Finds the views drawn on a character
// reference sheet: the front-facing figure (head-to-chest square and full body),
// a side view and a back view, so each scene can be conditioned on the view it
// needs (lib/character-sheet pickSheetRegion).
//
// Sheets have no fixed layout (back view first, expression grid on the left,
// figures touching...), so this is a pure pixel heuristic on a downscaled RGB
// buffer (no model, no network):
//   1. foreground = pixels far from the border's background colour
//   2. connected components → full-body figures are the tall ones
//   3. heads = foreground column runs in a figure's top band. A head facing the
//      viewer shows skin centred under its hair; a side view shows skin pushed
//      to one edge; a back view shows hair only.
//   4. stacked faces down the same columns = an expression column, not a body
// Falls back to the largest skin-showing component, then to null (the caller
// keeps DEFAULT_SHEET_CROP).

export interface SheetRegion {
  x: number;
  y: number;
  size: number;
}

/** A rectangular region, normalized to the sheet's width (x, w) and height (y, h). */
export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetRegions {
  /** Square head-to-chest crop of the front-facing figure (the default 참조 영역). */
  frontUpper: SheetRegion | null;
  /** The front-facing figure, head to feet. */
  frontFull: SheetRect | null;
  side: SheetRect | null;
  back: SheetRect | null;
}

/** Head-to-chest square side as a fraction of the figure's height. */
const REGION_OF_FIGURE = 0.38;
/** Figures at least this tall (fraction of the image) count as full body. */
const FULL_BODY_MIN_HEIGHT = 0.55;
/** Top part of a figure checked for a visible face. */
const HEAD_BAND = 0.16;
/** Full-body crop width as a fraction of the figure's height. */
const FULL_BODY_WIDTH = 0.28;
/** Skin pushed this far off the head's centre (fraction of head width) = side view. */
const SIDE_OFFSET = 0.16;

export function isSkinTone(r: number, g: number, b: number) {
  // Light anime skin, e.g. (250,225,210). Excludes white/grey (r-b small),
  // pink hair (b > g), blonde hair (b/r low, and yellow: g far above b — its
  // highlights reach skin's b/r, e.g. (253,230,180)) and saturated reds (g/r low).
  return (
    r > 170 &&
    r - b > 18 &&
    g >= b - 4 &&
    g - b <= 35 &&
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

interface Face {
  centerX: number;
  /** Top of the hair above the face. */
  top: number;
  /** Skin share of the head band under this face. */
  ratio: number;
  /** ratio, lowered for stacked expression heads. */
  score: number;
  /** |skin centre − head centre| / head width: ~0 front, larger = side view. */
  offset: number;
  /** Part of an expression column (faces stacked down the same columns). */
  stacked: boolean;
  /** Head (hair + face) width in pixels. */
  headW: number;
}

interface Head {
  from: number;
  to: number;
  top: number;
  skinShare: number;
  /** Skin below the head band in the same columns (faces of a grid, not a body). */
  stacked: boolean;
}

function analyze(rgb: Uint8Array, width: number, height: number) {
  const n = width * height;
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

  const bandOf = (comp: Component) => {
    const compH = comp.maxY - comp.minY + 1;
    const bandEnd = comp.minY + Math.max(2, Math.round(compH * HEAD_BAND));
    const skinCols = new Array<number>(width).fill(0);
    const fgCols = new Array<number>(width).fill(0);
    for (let y = comp.minY; y <= bandEnd && y < height; y++) {
      for (let x = comp.minX; x <= comp.maxX; x++) {
        const i = y * width + x;
        if (labels[i] !== comp.label) continue;
        fgCols[x]++;
        if (skin[i]) skinCols[x]++;
      }
    }
    return { compH, bandEnd, skinCols, fgCols };
  };

  const runsOf = (cols: number[], from: number, to: number, maxGap: number) => {
    const runs: { from: number; to: number; sum: number }[] = [];
    let run: { from: number; to: number; sum: number } | null = null;
    let gap = 0;
    for (let x = from; x <= to + maxGap + 1; x++) {
      const value = x <= to ? cols[x] : 0;
      if (value > 0) {
        if (!run) run = { from: x, to: x, sum: 0 };
        run.to = x;
        run.sum += value;
        gap = 0;
      } else if (run && ++gap > maxGap) {
        runs.push(run);
        run = null;
      }
    }
    return runs;
  };

  const topOf = (comp: Component, from: number, to: number) => {
    for (let y = comp.minY; y <= comp.maxY; y++) {
      for (let x = from; x <= to; x++) if (labels[y * width + x] === comp.label) return y;
    }
    return comp.minY;
  };

  // An isolated standing figure: tall, narrow, and narrow at the bottom (legs
  // and feet), unlike an expression column whose last row is a whole face.
  const standingFigure = (comp: Component) => {
    const compH = comp.maxY - comp.minY + 1;
    const compW = comp.maxX - comp.minX + 1;
    if (compH < height * FULL_BODY_MIN_HEIGHT || compW > compH * 0.5) return false;
    const from = comp.maxY - Math.max(1, Math.round(compH * 0.2));
    let rows = 0;
    let fgSum = 0;
    for (let y = from; y <= comp.maxY; y++) {
      for (let x = comp.minX; x <= comp.maxX; x++) if (labels[y * width + x] === comp.label) fgSum++;
      rows++;
    }
    return fgSum / rows <= compW * 0.55;
  };

  // 3. Faces: skin column runs in the head band, judged per head.
  const facesOf = (comp: Component): Face[] => {
    const { compH, bandEnd, skinCols, fgCols } = bandOf(comp);
    const torsoEnd = comp.minY + Math.round(compH * 0.6);
    const faces: Face[] = [];
    for (const face of runsOf(skinCols, comp.minX, comp.maxX, 1)) {
      const faceW = face.to - face.from + 1;
      // An arm or a sliver of neck, not a face.
      if (faceW < Math.max(3, compH * 0.035)) continue;
      const pad = Math.round(faceW / 2);
      const from = Math.max(comp.minX, face.from - pad);
      const to = Math.min(comp.maxX, face.to + pad);
      // Skin share of the head band under this face only, so figures that
      // touch (one merged component) are judged per head, not diluted.
      let fgUnderFace = 0;
      for (let x = from; x <= to; x++) fgUnderFace += fgCols[x];
      const ratio = fgUnderFace > 0 ? face.sum / fgUnderFace : 0;
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
      // A standing figure in an off-shoulder top or swimwear shows skin below
      // the head (shoulders, arms, legs) and is still one body. So a figure we
      // can see standing — tall, figure-narrow, and narrow at the bottom where
      // the legs are (an expression column ends in a full-width face) — is
      // never an expression column. Other blobs (touching figures, a sheet on
      // a non-white background, face grids) keep the skin-based tests.
      const stacked = standingFigure(comp)
        ? false
        : faceRows >= 3 || (torsoFg > 0 && torsoSkin / torsoFg > 0.18);
      // The head this face belongs to: the foreground run around it in the band.
      let hairFrom = face.from;
      let hairTo = face.to;
      while (hairFrom > comp.minX && fgCols[hairFrom - 1] > 0) hairFrom--;
      while (hairTo < comp.maxX && fgCols[hairTo + 1] > 0) hairTo++;
      const headW = hairTo - hairFrom + 1;
      const offset = Math.abs((face.from + face.to) / 2 - (hairFrom + hairTo) / 2) / headW;
      faces.push({
        centerX: (face.from + face.to) / 2,
        top: topOf(comp, face.from, face.to),
        ratio,
        score: ratio * (stacked ? 0.3 : 1),
        offset,
        stacked,
        headW,
      });
    }
    return faces;
  };

  // Heads without a face: back views (hair only in the head band).
  const headsOf = (comp: Component): Head[] => {
    const { compH, bandEnd, skinCols, fgCols } = bandOf(comp);
    const torsoEnd = comp.minY + Math.round(compH * 0.6);
    return runsOf(fgCols, comp.minX, comp.maxX, 1)
      .filter((run) => run.to - run.from + 1 >= compH * 0.06)
      .map((run) => {
        let skinSum = 0;
        for (let x = run.from; x <= run.to; x++) skinSum += skinCols[x];
        let torsoFg = 0;
        let torsoSkin = 0;
        for (let y = bandEnd + 1; y <= torsoEnd && y < height; y++) {
          for (let x = run.from; x <= run.to; x++) {
            const i = y * width + x;
            if (labels[i] !== comp.label) continue;
            torsoFg++;
            if (skin[i]) torsoSkin++;
          }
        }
        return {
          from: run.from,
          to: run.to,
          top: topOf(comp, run.from, run.to),
          skinShare: skinSum / run.sum,
          stacked: torsoFg > 0 && torsoSkin / torsoFg > 0.1,
        };
      });
  };

  return { components, facesOf, headsOf };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * All views the sheet shows, normalized to its width/height.
 * @param rgb  packed RGB bytes, row-major, width × height × 3
 */
export function findSheetRegions(rgb: Uint8Array, width: number, height: number): SheetRegions {
  const none: SheetRegions = { frontUpper: null, frontFull: null, side: null, back: null };
  if (width < 16 || height < 16 || rgb.length < width * height * 3) return none;
  const { components, facesOf, headsOf } = analyze(rgb, width, height);
  if (components.length === 0) return none;

  const isTall = (c: Component) => c.maxY - c.minY + 1 >= height * FULL_BODY_MIN_HEIGHT;
  const fullBody = components.filter(isTall);

  type Pick = { comp: Component; face: Face; score: number };
  const pick = (candidates: Component[], minRatio: number, scoreOf: (c: Component, f: Face) => number) => {
    let chosen: Pick | null = null;
    for (const comp of candidates) {
      for (const face of facesOf(comp)) {
        if (face.ratio < minRatio) continue;
        const score = scoreOf(comp, face);
        if (score > 0 && (!chosen || score > chosen.score)) chosen = { comp, face, score };
      }
    }
    return chosen;
  };
  // A blob much wider than a standing figure is a group or an expression grid:
  // usable, but an isolated full-body figure is preferred. Side-facing heads
  // rank below faces looking at the viewer.
  const frontScore = (comp: Component, face: Face) => {
    const wide = comp.maxX - comp.minX + 1 > (comp.maxY - comp.minY + 1) * 0.5;
    return face.score * (wide ? 0.6 : 1) * (face.offset > SIDE_OFFSET ? 0.5 : 1);
  };
  const front =
    pick(fullBody, 0.04, frontScore) ??
    pick([...components].sort((a, b) => b.count - a.count).slice(0, 6), 0.06, frontScore);
  if (!front) return none;

  const square = (centerX: number, top: number, sidePx: number): SheetRegion => {
    const left = Math.min(Math.max(0, centerX - sidePx / 2), width - sidePx);
    const y = Math.min(Math.max(0, top - sidePx * 0.05), height - sidePx);
    return { x: round(left / width), y: round(y / height), size: round(sidePx / width) };
  };
  const body = (centerX: number, top: number, bottom: number): SheetRect => {
    const y = Math.max(0, top - (bottom - top) * 0.03);
    const h = Math.min(height, bottom + 1) - y;
    const w = Math.min(width, h * FULL_BODY_WIDTH);
    const x = Math.min(Math.max(0, centerX - w / 2), width - w);
    return { x: round(x / width), y: round(y / height), w: round(w / width), h: round(h / height) };
  };

  // 4. Head-to-chest square, sized from the figure height.
  const frontTall = isTall(front.comp);
  const figureH = front.comp.maxY - front.face.top + 1;
  const sidePx = Math.min(
    height,
    width,
    Math.max(width * 0.08, (front.comp.maxY - front.comp.minY + 1) * (frontTall ? REGION_OF_FIGURE : 0.9))
  );
  const frontUpper = square(front.face.centerX, front.face.top, sidePx);
  const frontFull = frontTall ? body(front.face.centerX, front.face.top, front.face.top + figureH - 1) : null;

  // Side view: another standing figure whose face skin sits off its head's
  // centre. Expression heads and oversized close-ups are not figures.
  // Conservative: no side view beats a wrong one (callers fall back to front).
  const side = pick(fullBody, 0.03, (comp, face) => {
    const compH = comp.maxY - comp.minY + 1;
    const plausible =
      !face.stacked &&
      face.offset > SIDE_OFFSET &&
      face.headW <= compH * 0.2 &&
      Math.abs(face.centerX - front.face.centerX) > width * 0.03;
    return plausible ? face.offset : 0;
  });

  // Back view: a full-body head with hair but (almost) no skin.
  let back: { centerX: number; top: number; bottom: number; width: number } | null = null;
  for (const comp of fullBody) {
    const compH = comp.maxY - comp.minY + 1;
    for (const head of headsOf(comp)) {
      if (head.skinShare > 0.03 || head.stacked || head.to - head.from + 1 > compH * 0.2) continue;
      const centerX = (head.from + head.to) / 2;
      if (Math.abs(centerX - front.face.centerX) < width * 0.03) continue;
      const headW = head.to - head.from + 1;
      if (!back || headW > back.width) back = { centerX, top: head.top, bottom: comp.maxY, width: headW };
    }
  }

  return {
    frontUpper,
    frontFull,
    side: side ? body(side.face.centerX, side.face.top, side.comp.maxY) : null,
    back: back ? body(back.centerX, back.top, back.bottom) : null,
  };
}

/**
 * The default 참조 영역: the front-facing figure's head-to-chest square.
 * @returns region normalized like DEFAULT_SHEET_CROP (size × image width), or null
 */
export function findSheetFocus(rgb: Uint8Array, width: number, height: number): SheetRegion | null {
  return findSheetRegions(rgb, width, height).frontUpper;
}
