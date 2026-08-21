import "server-only";

// Paimon answers arrive as ONE streaming JSON object, so the routes have to read
// it while it is still incomplete: the reply text is forwarded as it is typed,
// finished sub-objects (a params patch, a plan) are forwarded the moment they
// close, and array progress is counted so the UI can say which item is being
// written. These helpers are shared by every Paimon route.

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

/** Parses the completed answer, tolerating markdown fences around the JSON. */
export function parseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Paimon did not return JSON.");
  }

  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

/**
 * The decoded value of a string field in a still-streaming JSON buffer, as far
 * as it has arrived (monotonically growing), or null before the key appears. An
 * incomplete trailing escape stops the scan short until the next chunk fills it.
 */
export function extractPartialString(
  buffer: string,
  key = "reply"
): string | null {
  const keyMatch = buffer.match(new RegExp(`"${key}"\\s*:\\s*"`));
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

    if (ch === '"') return out; // closing quote → the value is complete

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * A COMPLETE object value (e.g. `paramsPatch`, `plan`) out of a still-streaming
 * buffer, or null while it is unfinished. Brace counting with strings/escapes
 * skipped, so a `{` inside a prompt cannot close the object early.
 */
export function extractCompleteObject(
  buffer: string,
  key: string
): string | null {
  const keyMatch = buffer.match(new RegExp(`"${key}"\\s*:\\s*\\{`));
  if (!keyMatch || keyMatch.index === undefined) return null;

  const start = keyMatch.index + keyMatch[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return buffer.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Which field of a streaming patch object is being written right now, so the UI
 * can name it ("시놉시스 작성 중", "상황 17번째 작성 중"). One depth-aware pass
 * over the object: only keys at its top level count, so the `name` key inside
 * the 17th situation is never mistaken for the character's own `name` field.
 * Returns null before the object opens, and `closed: true` once it ends.
 */
export function patchFieldProgress(
  buffer: string,
  objectKey: string
): { key: string; items: number; isArray: boolean; closed: boolean } | null {
  const keyMatch = buffer.match(new RegExp(`"${objectKey}"\\s*:\\s*\\{`));
  if (!keyMatch || keyMatch.index === undefined) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let field = "";
  let items = 0;
  let isArray = false;

  for (let i = keyMatch.index + keyMatch[0].length - 1; i < buffer.length; i += 1) {
    const ch = buffer[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        // A string that closes at the object's top level and is followed by ':'
        // is the name of the field whose value comes next.
        if (depth === 1) {
          const rest = buffer.slice(i + 1).match(/^\s*:/);
          if (rest) {
            field = buffer.slice(stringStart + 1, i);
            items = 0;
            isArray = false;
          }
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = i;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "[") {
      depth += 1;
      if (depth === 2) isArray = true;
    } else if (ch === "}") {
      depth -= 1;
      // Back to the array level → one item finished.
      if (isArray && depth === 2) items += 1;
      if (depth === 0) return { key: field, items, isArray, closed: true };
    } else if (ch === "]") {
      depth -= 1;
    }
  }

  return { key: field, items, isArray, closed: false };
}

/**
 * The COMPLETE items of an array field in a still-streaming (or truncated)
 * buffer, as raw JSON strings. A batch answer that gets cut off mid-array still
 * yields every item that finished, so a long "상황 100개" turn is never lost
 * whole just because the tail never arrived.
 */
export function completeArrayItems(buffer: string, key: string): string[] {
  const keyMatch = buffer.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (!keyMatch || keyMatch.index === undefined) return [];

  const items: string[] = [];
  let depth = 0;
  let itemStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = keyMatch.index + keyMatch[0].length - 1; i < buffer.length; i += 1) {
    const ch = buffer[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "{") {
      depth += 1;
      if (depth === 2) itemStart = i;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 1 && itemStart >= 0) {
        items.push(buffer.slice(itemStart, i + 1));
        itemStart = -1;
      }
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return items;
}

/** The value of a string field, but only once its closing quote has arrived. */
export function extractCompleteString(
  buffer: string,
  key: string
): string | null {
  const keyMatch = buffer.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!keyMatch || keyMatch.index === undefined) return null;

  let i = keyMatch.index + keyMatch[0].length;
  let escaped = false;
  for (; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') return extractPartialString(buffer, key);
  }
  return null;
}

export function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function isSensitiveInputError(message: string) {
  return /may contain sensitive information|sensitive information|content\[\d+\]/i.test(
    message
  );
}
