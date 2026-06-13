import { NextRequest, NextResponse } from "next/server";

interface HuggingFaceModelInfo {
  id?: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  cardData?: {
    base_model?: string | string[];
    tags?: string[];
    license?: string;
    datasets?: string | string[];
  };
  siblings?: {
    rfilename?: string;
    size?: number;
  }[];
}

function parseHuggingFaceUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid Hugging Face URL");
  }

  if (!/^(www\.)?huggingface\.co$/i.test(url.hostname)) {
    throw new Error("URL must be from huggingface.co");
  }

  const [owner, repo] = url.pathname.split("/").filter(Boolean);

  if (!owner || !repo) {
    throw new Error("Hugging Face repo ID was not found in the URL");
  }

  return `${owner}/${repo}`;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionText(markdown: string, heading: string) {
  const pattern = new RegExp(
    `(^|\\n)#{2,3}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s+|$)`,
    "i"
  );
  return markdown.match(pattern)?.[2] ?? "";
}

function excerptFromReadme(readme: string) {
  const description = sectionText(readme, "Model description");
  const source = description || readme.replace(/^---[\s\S]*?---/, "");
  const stripped = stripMarkdown(source);

  return stripped.length > 700 ? `${stripped.slice(0, 700).trim()}...` : stripped;
}

function triggerWordsFromReadme(readme: string) {
  const triggerSection = sectionText(readme, "Trigger words");
  const matches = Array.from(triggerSection.matchAll(/`([^`]+)`/g))
    .map((match) => match[1].trim())
    .filter(Boolean);

  return Array.from(new Set(matches));
}

function fileSizeTotal(files: HuggingFaceModelInfo["siblings"]) {
  return files?.reduce((total, file) => total + (file.size ?? 0), 0) ?? null;
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim();

  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const repoId = parseHuggingFaceUrl(rawUrl);
    const [modelRes, readmeRes] = await Promise.all([
      fetch(`https://huggingface.co/api/models/${repoId}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
      fetch(`https://huggingface.co/${repoId}/raw/main/README.md`, {
        cache: "no-store",
        headers: { Accept: "text/markdown,text/plain" },
      }),
    ]);

    if (!modelRes.ok) {
      return NextResponse.json(
        { error: `Hugging Face request failed: ${modelRes.status}` },
        { status: 502 }
      );
    }

    const model = (await modelRes.json()) as HuggingFaceModelInfo;
    const readme = readmeRes.ok ? await readmeRes.text() : "";
    const cardTags = normalizeStringList(model.cardData?.tags);
    const tags = Array.from(new Set([...(model.tags ?? []), ...cardTags])).slice(0, 40);
    const baseModels = normalizeStringList(model.cardData?.base_model);

    return NextResponse.json(
      {
        repo_id: model.id ?? repoId,
        name: model.id?.split("/").pop() ?? repoId.split("/").pop() ?? repoId,
        author: model.author ?? repoId.split("/")[0],
        sha: model.sha ?? "",
        last_modified: model.lastModified ?? "",
        pipeline_tag: model.pipeline_tag ?? "",
        library_name: model.library_name ?? "",
        downloads: model.downloads ?? null,
        likes: model.likes ?? null,
        base_model: baseModels.join(", "),
        license: model.cardData?.license ?? "",
        datasets: normalizeStringList(model.cardData?.datasets),
        tags,
        trigger_words: triggerWordsFromReadme(readme),
        description: readme ? excerptFromReadme(readme) : "",
        files: (model.siblings ?? [])
          .map((file) => ({
            name: file.rfilename ?? "",
            size: file.size ?? null,
          }))
          .filter((file) => file.name),
        file_size_total: fileSizeTotal(model.siblings),
        source_url: rawUrl,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load Hugging Face info",
      },
      { status: 400 }
    );
  }
}
