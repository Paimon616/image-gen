export interface CivitaiUrlIds {
  modelId?: string;
  modelVersionId?: string;
}

export function parseCivitaiUrlIds(rawUrl: string | null | undefined): CivitaiUrlIds {
  if (!rawUrl) return {};

  try {
    const url = new URL(rawUrl);

    if (!/^(www\.)?civitai\.(com|red)$/i.test(url.hostname)) {
      return {};
    }

    const modelId = url.pathname.match(/\/models\/(\d+)/)?.[1];
    const modelVersionId =
      url.searchParams.get("modelVersionId") ??
      url.searchParams.get("modelversionid") ??
      url.searchParams.get("versionId") ??
      undefined;

    return {
      modelId,
      modelVersionId: modelVersionId || undefined,
    };
  } catch {
    return {};
  }
}

export function civitaiUrlMatchesId(
  rawUrl: string | null | undefined,
  kind: "model" | "version",
  id: string | number | null | undefined
) {
  if (id === null || id === undefined || id === "") return false;

  const expected = String(id);
  const ids = parseCivitaiUrlIds(rawUrl);

  return kind === "model"
    ? ids.modelId === expected
    : ids.modelVersionId === expected;
}

export function normalizeCivitaiModelUrl(options: {
  modelId?: string | number | null;
  modelVersionId?: string | number | null;
  name?: string;
  fallbackUrl?: string;
}) {
  const fallbackIds = parseCivitaiUrlIds(options.fallbackUrl);
  const modelId = options.modelId ?? fallbackIds.modelId;

  if (!modelId) return options.fallbackUrl ?? "";

  const slug = (options.name ?? "model")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const url = new URL(
    `https://civitai.red/models/${modelId}${slug ? `/${slug}` : ""}`
  );
  const modelVersionId = options.modelVersionId ?? fallbackIds.modelVersionId;

  if (modelVersionId) {
    url.searchParams.set("modelVersionId", String(modelVersionId));
  }

  return url.toString();
}
