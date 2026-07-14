#!/usr/bin/env node

// Backfill Civitai license info into data/model-catalog.json for models that
// were downloaded before license capture existed. Reads each entry's Civitai
// URL, fetches the model's license fields, and writes them back.
//
// Usage:
//   node scripts/backfill-model-licenses.mjs [--force] [--catalog <path>]
//
// Flags:
//   --force            refetch license even for entries that already have one
//   --catalog <path>   catalog file (default: data/model-catalog.json)
//
// Env:
//   CIVITAI_API_TOKEN  optional token for authenticated requests

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const catalogFlagIndex = args.indexOf("--catalog");
const CATALOG_PATH =
  catalogFlagIndex >= 0 && args[catalogFlagIndex + 1]
    ? args[catalogFlagIndex + 1]
    : "data/model-catalog.json";

const CONCURRENCY = 4;
const REQUEST_DELAY_MS = 250;
const token = process.env.CIVITAI_API_TOKEN?.trim();

function modelIdFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!/^(www\.)?civitai\.(com|red)$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/models\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Civitai returns allowCommercialUse inconsistently: a clean array, a single
// enum string, or a Postgres brace literal like "{Image,RentCivit,Rent,Sell}".
function splitCommercialEntry(entry) {
  if (typeof entry !== "string") return [];
  return entry
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .split(",")
    .map((token) => token.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

function parseAllowCommercialUse(value) {
  if (Array.isArray(value)) return value.flatMap(splitCommercialEntry);
  if (typeof value === "string") return splitCommercialEntry(value);
  return undefined;
}

function parseLicense(model) {
  const license = {};

  if (typeof model.allowNoCredit === "boolean") {
    license.allowNoCredit = model.allowNoCredit;
  }
  if (typeof model.allowDerivatives === "boolean") {
    license.allowDerivatives = model.allowDerivatives;
  }
  if (typeof model.allowDifferentLicense === "boolean") {
    license.allowDifferentLicense = model.allowDifferentLicense;
  }
  const commercial = parseAllowCommercialUse(model.allowCommercialUse);
  if (commercial) {
    license.allowCommercialUse = commercial;
  }

  return Object.keys(license).length > 0 ? license : null;
}

async function fetchLicense(modelId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(
      `https://civitai.com/api/v1/models/${modelId}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "image-gen-license-backfill/1.0",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const model = await response.json();
    return { license: parseLicense(model) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  if (!existsSync(CATALOG_PATH)) {
    console.error(`Catalog not found: ${CATALOG_PATH}`);
    process.exit(1);
  }

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    console.error(`${CATALOG_PATH} must contain a JSON object`);
    process.exit(1);
  }

  const targets = Object.keys(catalog).filter((key) => {
    const entry = catalog[key];
    if (!force && entry.license) return false;
    return Boolean(modelIdFromUrl(entry.civitai_url || entry.source_url));
  });

  console.log(
    `Catalog entries: ${Object.keys(catalog).length} · to backfill: ${targets.length}` +
      (force ? " (force)" : "")
  );
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let missing = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (key) => {
        const entry = catalog[key];
        const modelId = modelIdFromUrl(entry.civitai_url || entry.source_url);
        const { license, error } = await fetchLicense(modelId);
        if (error) {
          failed += 1;
          console.warn(`  ! ${key} (model ${modelId}): ${error}`);
          return;
        }
        if (!license) {
          missing += 1;
          console.warn(`  - ${key} (model ${modelId}): no license fields`);
          return;
        }
        entry.license = license;
        updated += 1;
        const commercial = license.allowCommercialUse ?? [];
        const rent = commercial.map((v) => v.toLowerCase()).includes("rent");
        console.log(
          `  + ${key}: ${rent ? "Rent OK" : "Rent NO"} [${commercial.join(", ") || "-"}]`
        );
      })
    );
    await delay(REQUEST_DELAY_MS);
  }

  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `Done. updated: ${updated} · no-license: ${missing} · failed: ${failed}`
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
