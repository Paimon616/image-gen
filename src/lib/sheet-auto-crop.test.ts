import { test } from "node:test";
import assert from "node:assert/strict";

import { findSheetFocus, isSkinTone } from "./sheet-auto-crop.ts";

const W = 300;
const H = 200;
const BG: Rgb = [245, 245, 245];
const SKIN: Rgb = [250, 224, 208];
const HAIR: Rgb = [30, 30, 40];
const CLOTH: Rgb = [30, 50, 110];
const LEGS: Rgb = [60, 55, 60];
type Rgb = [number, number, number];

function canvas() {
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) rgb.set(BG, i * 3);
  return rgb;
}

function fill(rgb: Uint8Array, x0: number, y0: number, x1: number, y1: number, color: Rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.set(color, (y * W + x) * 3);
}

/** Standing figure: hair on top, face (skin) unless seen from behind, clothes, legs. */
function figure(rgb: Uint8Array, x: number, back: boolean) {
  fill(rgb, x, 4, x + 30, 14, HAIR);
  fill(rgb, x + 2, 14, x + 28, 30, back ? HAIR : SKIN);
  fill(rgb, x, 30, x + 30, 120, CLOTH);
  fill(rgb, x + 6, 120, x + 24, 196, LEGS);
}

/** Expression column: four big faces stacked, touching. */
function headColumn(rgb: Uint8Array, x: number) {
  for (let k = 0; k < 4; k++) {
    const y = 2 + k * 49;
    fill(rgb, x, y, x + 44, y + 12, HAIR);
    fill(rgb, x + 2, y + 12, x + 42, y + 40, SKIN);
    fill(rgb, x, y + 40, x + 44, y + 49, CLOTH);
  }
}

test("isSkinTone accepts light skin, rejects white, pink hair, blonde, red", () => {
  assert.equal(isSkinTone(250, 224, 208), true);
  assert.equal(isSkinTone(245, 245, 245), false);
  assert.equal(isSkinTone(250, 185, 205), false);
  assert.equal(isSkinTone(250, 230, 160), false);
  assert.equal(isSkinTone(220, 40, 50), false);
});

test("finds the front-facing figure, not the back view", () => {
  const rgb = canvas();
  figure(rgb, 20, true);
  figure(rgb, 90, false);
  const region = findSheetFocus(rgb, W, H);
  assert.ok(region);
  const center = (region.x + region.size / 2) * W;
  assert.ok(Math.abs(center - 105) < 8, `center ${center}`);
  assert.ok(region.y * H < 8, "starts above the head");
});

test("prefers a full-body figure over an expression column", () => {
  const rgb = canvas();
  figure(rgb, 30, false);
  headColumn(rgb, 200);
  const region = findSheetFocus(rgb, W, H);
  assert.ok(region);
  const center = (region.x + region.size / 2) * W;
  assert.ok(Math.abs(center - 45) < 8, `center ${center}`);
});

test("judges touching figures per head", () => {
  const rgb = canvas();
  figure(rgb, 40, true);
  figure(rgb, 70, false); // touches the back view: one connected blob
  const region = findSheetFocus(rgb, W, H);
  assert.ok(region);
  const center = (region.x + region.size / 2) * W;
  assert.ok(Math.abs(center - 85) < 8, `center ${center}`);
});

test("returns null when nothing shows a face", () => {
  const rgb = canvas();
  figure(rgb, 50, true);
  assert.equal(findSheetFocus(rgb, W, H), null);
  assert.equal(findSheetFocus(canvas(), W, H), null);
});
