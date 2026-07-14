import type { CivitaiLicenseInfo } from "@/lib/types";

// Civitai's model API returns allowCommercialUse inconsistently: sometimes a
// clean JSON array (["Image","Rent"]), sometimes a Postgres-style brace literal
// string ("{Image,RentCivit,Rent,Sell}"), sometimes a single enum string.
// Normalize all shapes into a flat list of individual permission tokens.
function splitCommercialEntry(entry: unknown): string[] {
  if (typeof entry !== "string") return [];
  const withoutBraces = entry.trim().replace(/^\{/, "").replace(/\}$/, "");
  return withoutBraces
    .split(",")
    .map((token) => token.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

export function parseAllowCommercialUse(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap(splitCommercialEntry);
  }
  if (typeof value === "string") {
    return splitCommercialEntry(value);
  }
  return undefined;
}

interface CivitaiLicenseSource {
  allowNoCredit?: unknown;
  allowCommercialUse?: unknown;
  allowDerivatives?: unknown;
  allowDifferentLicense?: unknown;
}

export function parseCivitaiLicense(
  model: CivitaiLicenseSource
): CivitaiLicenseInfo | null {
  const license: CivitaiLicenseInfo = {};

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
