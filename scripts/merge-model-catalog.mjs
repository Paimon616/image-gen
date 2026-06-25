#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [, , basePath, currentPath, incomingPath] = process.argv;

function readCatalog(path) {
  if (!path || !existsSync(path)) return {};

  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return parsed;
}

function sortObjectKeys(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

if (!currentPath || !incomingPath) {
  console.error(
    "Usage: merge-model-catalog.mjs <base> <current> <incoming> [path]"
  );
  process.exit(2);
}

try {
  // Read the base file so invalid ancestor JSON fails loudly instead of hiding a
  // broken merge setup. The merge policy itself only needs current/incoming.
  readCatalog(basePath);

  const current = readCatalog(currentPath);
  const incoming = readCatalog(incomingPath);

  // Prefer the user's local catalog for matching model paths, while accepting
  // new catalog entries that only exist in the pulled branch.
  const merged = sortObjectKeys({ ...incoming, ...current });

  writeFileSync(currentPath, `${JSON.stringify(merged, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
