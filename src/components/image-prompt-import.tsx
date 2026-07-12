"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store";

type InterrogateMode = "auto" | "wd14" | "florence";

interface LocalModelAsset {
  path: string;
  base_model: string;
}

function modeLabel(mode: InterrogateMode) {
  if (mode === "wd14") return "WD14";
  if (mode === "florence") return "Florence";
  return "Auto";
}

function modeDescription(mode: InterrogateMode) {
  if (mode === "wd14") return "Danbooru-style tags for anime and illustration models.";
  if (mode === "florence") return "Natural-language prompt workflow configured by env path.";
  return "Uses the selected checkpoint base model to choose a workflow.";
}

export function ImagePromptImport() {
  const router = useRouter();
  const { params, setParams } = useStore();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<InterrogateMode>("auto");
  const [checkpointAssets, setCheckpointAssets] = useState<LocalModelAsset[]>([]);
  const [resultPrompt, setResultPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setCheckpointAssets(data.checkpointAssets ?? []))
      .catch(() => {});
  }, []);

  const selectedBaseModel = useMemo(() => {
    return (
      checkpointAssets.find((asset) => asset.path === params.model_name)?.base_model ??
      ""
    );
  }, [checkpointAssets, params.model_name]);

  const extractPrompt = async () => {
    if (!imageUrl || isRunning) return;

    setIsRunning(true);
    setStatus("Extracting prompt...");
    setError("");

    try {
      const res = await fetch("/api/interrogate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          base_model: selectedBaseModel,
          mode,
        }),
      });
      const data = (await res.json()) as {
        prompt?: string;
        mode?: string;
        error?: string;
      };

      if (!res.ok || !data.prompt) {
        throw new Error(data.error || "Prompt extraction failed");
      }

      setResultPrompt(data.prompt);
      setStatus(`Extracted with ${modeLabel((data.mode as InterrogateMode) ?? mode)}.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Prompt extraction failed"
      );
      setStatus("");
    } finally {
      setIsRunning(false);
    }
  };

  const sendToGenerator = () => {
    if (!resultPrompt.trim()) return;

    setParams({ prompt: resultPrompt.trim() });
    router.push("/");
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-md border border-border bg-card/85 shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Source</h2>
            <p className="text-xs text-muted-foreground">
              Upload an image, then extract a reusable generation prompt.
            </p>
          </div>
          <div className="p-4">
            <ImageUpload
              label="Upload Image"
              description="Drop or click to upload"
              value={imageUrl}
              previewClassName="h-72 w-full object-contain bg-background"
              onChange={(url) => {
                setImageUrl(url);
                setStatus("");
                setError("");
              }}
            />
          </div>
        </section>

        <aside className="space-y-3 rounded-md border border-border bg-card/85 p-3 shadow-sm">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Workflow</Label>
            <div className="text-sm font-semibold">
              {selectedBaseModel || "Unknown base model"}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1">
            {(["auto", "wd14", "florence"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`h-8 rounded px-2 text-xs font-medium transition-colors ${
                  mode === item
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {modeLabel(item)}
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {modeDescription(mode)}
          </p>

          <Button
            type="button"
            size="lg"
            onClick={extractPrompt}
            disabled={!imageUrl || isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Extract Prompt
              </>
            )}
          </Button>

          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={sendToGenerator}
            disabled={!resultPrompt.trim()}
            className="w-full"
          >
            <ArrowRight className="h-4 w-4" />
            Send to Generator
          </Button>
        </aside>

        <section className="min-w-0 rounded-md border border-border bg-card/85 shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Extracted Prompt</h2>
              <p className="text-xs text-muted-foreground">Review and edit before sending it to image generation.</p>
            </div>
            {status && <span className="text-xs text-muted-foreground">{status}</span>}
          </div>
          <div className="p-4">
            {error && (
              <div className="mb-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 whitespace-pre-wrap break-words">{error}</div>
              </div>
            )}
            <Textarea
              value={resultPrompt}
              onChange={(event) => setResultPrompt(event.target.value)}
              placeholder="The extracted prompt will appear here."
              className="min-h-64 resize-y text-sm leading-6"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
