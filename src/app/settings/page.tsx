"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Film,
  Image as ImageIcon,
  KeyRound,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";

type RunpodPodKind = "image" | "video";

interface RunpodPodForm {
  id: string;
  kind: RunpodPodKind;
  label: string;
  podId: string;
  ssh: string;
  comfyUrl: string;
}

type SaveScope = "keys" | "image" | "video";

const emptyPod = (kind: RunpodPodKind): RunpodPodForm => ({
  id: crypto.randomUUID(),
  kind,
  label: "",
  podId: "",
  ssh: "",
  comfyUrl: "",
});

export default function SettingsPage() {
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const [civitaiApiKey, setCivitaiApiKey] = useState("");
  const [huggingfaceApiKey, setHuggingfaceApiKey] = useState("");
  const [runpodApiKey, setRunpodApiKey] = useState("");
  const [civitaiApiKeyConfigured, setCivitaiApiKeyConfigured] = useState(false);
  const [huggingfaceApiKeyConfigured, setHuggingfaceApiKeyConfigured] =
    useState(false);
  const [runpodApiKeyConfigured, setRunpodApiKeyConfigured] = useState(false);
  const [runpodPods, setRunpodPods] = useState<RunpodPodForm[]>([]);
  const [loadError, setLoadError] = useState("");
  const [savingScope, setSavingScope] = useState<SaveScope | null>(null);
  const [savedScope, setSavedScope] = useState<SaveScope | null>(null);

  const normalizePods = (value: unknown): RunpodPodForm[] =>
    Array.isArray(value)
      ? value.map((raw) => {
          const pod = raw as Partial<RunpodPodForm>;
          return {
            id: String(pod.id || crypto.randomUUID()),
            kind: pod.kind === "video" ? "video" : "image",
            label: String(pod.label ?? ""),
            podId: String(pod.podId ?? ""),
            ssh: String(pod.ssh ?? ""),
            comfyUrl: String(pod.comfyUrl ?? ""),
          } satisfies RunpodPodForm;
        })
      : [];

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setCivitaiApiKeyConfigured(Boolean(data.civitaiApiKeyConfigured));
        setHuggingfaceApiKeyConfigured(Boolean(data.huggingfaceApiKeyConfigured));
        setRunpodApiKeyConfigured(Boolean(data.runpodApiKeyConfigured));
        setRunpodPods(normalizePods(data.runpodPods));
      })
      .catch(() =>
        setLoadError(ko ? "설정을 불러오지 못했습니다." : "Failed to load settings.")
      );
  }, [ko]);

  const imagePods = useMemo(
    () => runpodPods.filter((pod) => pod.kind === "image"),
    [runpodPods]
  );
  const videoPods = useMemo(
    () => runpodPods.filter((pod) => pod.kind === "video"),
    [runpodPods]
  );

  const updatePod = (id: string, patch: Partial<RunpodPodForm>) =>
    setRunpodPods((pods) =>
      pods.map((pod) => (pod.id === id ? { ...pod, ...patch } : pod))
    );
  const removePod = (id: string) =>
    setRunpodPods((pods) => pods.filter((pod) => pod.id !== id));
  const addPod = (kind: RunpodPodKind) =>
    setRunpodPods((pods) => [...pods, emptyPod(kind)]);

  // Every scope saves the full settings payload (blank API keys keep existing
  // values server-side); the scope only decides which button shows feedback so
  // image/video pod lists can be saved independently without losing the other.
  const save = async (scope: SaveScope) => {
    setSavingScope(scope);
    setSavedScope(null);
    setLoadError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          civitaiApiKey,
          huggingfaceApiKey,
          runpodApiKey,
          runpodPods,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      const data = await response.json();
      setCivitaiApiKeyConfigured(Boolean(data.civitaiApiKeyConfigured));
      setHuggingfaceApiKeyConfigured(Boolean(data.huggingfaceApiKeyConfigured));
      setRunpodApiKeyConfigured(Boolean(data.runpodApiKeyConfigured));
      setRunpodPods(normalizePods(data.runpodPods));
      if (scope === "keys") {
        setCivitaiApiKey("");
        setHuggingfaceApiKey("");
        setRunpodApiKey("");
      }
      setSavedScope(scope);
    } catch {
      setLoadError(ko ? "저장하지 못했습니다." : "Failed to save.");
    } finally {
      setSavingScope(null);
    }
  };

  const renderPodList = (kind: RunpodPodKind, pods: RunpodPodForm[]) => (
    <div className="space-y-3">
      {pods.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {kind === "image"
            ? ko
              ? "이미지 생성에 사용할 Pod가 없습니다. 아래에서 추가하세요."
              : "No pods for image generation yet. Add one below."
            : ko
              ? "비디오 생성에 사용할 Pod가 없습니다. 아래에서 추가하세요."
              : "No pods for video generation yet. Add one below."}
        </div>
      ) : (
        pods.map((pod, index) => (
          <div
            key={pod.id}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <h3 className="text-sm font-medium">
                  {pod.label ||
                    (kind === "image"
                      ? ko
                        ? `이미지 Pod ${index + 1}`
                        : `Image pod ${index + 1}`
                      : ko
                        ? `비디오 Pod ${index + 1}`
                        : `Video pod ${index + 1}`)}
                </h3>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removePod(pod.id)}
                aria-label={ko ? "Pod 삭제" : "Delete pod"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {ko ? "라벨" : "Label"}
                </Label>
                <Input
                  value={pod.label}
                  onChange={(event) => updatePod(pod.id, { label: event.target.value })}
                  placeholder={ko ? "예: RunPod A100" : "e.g. RunPod A100"}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pod ID</Label>
                <Input
                  value={pod.podId}
                  onChange={(event) => updatePod(pod.id, { podId: event.target.value })}
                  placeholder={ko ? "RunPod Pod ID" : "RunPod Pod ID"}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs text-muted-foreground">ComfyUI URL</Label>
                <Input
                  value={pod.comfyUrl}
                  onChange={(event) => updatePod(pod.id, { comfyUrl: event.target.value })}
                  placeholder="https://xxxxx-8188.proxy.runpod.net"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  {ko ? "SSH 명령 (선택)" : "SSH command (optional)"}
                </Label>
                <Input
                  value={pod.ssh}
                  onChange={(event) => updatePod(pod.id, { ssh: event.target.value })}
                  placeholder="ssh ... -i ~/.ssh/id_ed25519"
                />
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const savedLabel = ko ? "저장됨" : "Saved";

  return (
    <div className="flex h-screen">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-muted/20">
        <div className="border-b border-border bg-background px-8 py-5">
          <h1 className="text-xl font-semibold tracking-tight">
            {ko ? "설정" : "Settings"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ko
              ? "외부 서비스 키와 원격 생성 대상을 관리합니다."
              : "Manage external service keys and remote generation targets."}
          </p>
        </div>

        <div className="mx-auto max-w-3xl space-y-6 p-8">
          {loadError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          )}

          {/* API keys */}
          <section className="rounded-xl border border-border bg-background shadow-sm">
            <header className="flex items-start gap-3 border-b border-border px-6 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">
                  {ko ? "API 키" : "API keys"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {ko
                    ? "키는 서버에만 저장되고 다시 표시되지 않습니다. 빈칸은 기존 값을 유지합니다."
                    : "Keys are stored server-side and never shown again. Blank keeps the existing value."}
                </p>
              </div>
            </header>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="civitai-api-key">Civitai API Key</Label>
                  <StatusBadge
                    configured={civitaiApiKeyConfigured}
                    savedLabel={savedLabel}
                    notSetLabel={ko ? "미설정" : "Not set"}
                  />
                </div>
                <Input
                  id="civitai-api-key"
                  type="password"
                  value={civitaiApiKey}
                  onChange={(event) => setCivitaiApiKey(event.target.value)}
                  placeholder={ko ? "새 Civitai API key" : "New Civitai API key"}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="huggingface-api-key">HuggingFace Token</Label>
                  <StatusBadge
                    configured={huggingfaceApiKeyConfigured}
                    savedLabel={savedLabel}
                    notSetLabel={ko ? "미설정" : "Not set"}
                  />
                </div>
                <Input
                  id="huggingface-api-key"
                  type="password"
                  value={huggingfaceApiKey}
                  onChange={(event) => setHuggingfaceApiKey(event.target.value)}
                  placeholder={ko ? "새 HuggingFace 토큰 (hf_...)" : "New HuggingFace token (hf_...)"}
                />
                <p className="text-xs text-muted-foreground">
                  {ko
                    ? "게이트 저장소(예: Lightricks/LTX-2.5) 모델 다운로드에 필요합니다. HuggingFace에서 해당 모델 약관에 먼저 동의한 계정의 read 토큰을 입력하세요."
                    : "Needed to download gated repos (e.g. Lightricks/LTX-2.5). Use a read token from an account that has accepted the model's terms on HuggingFace."}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="runpod-api-key">RunPod API Key</Label>
                  <StatusBadge
                    configured={runpodApiKeyConfigured}
                    savedLabel={savedLabel}
                    notSetLabel={ko ? "미설정" : "Not set"}
                  />
                </div>
                <Input
                  id="runpod-api-key"
                  type="password"
                  value={runpodApiKey}
                  onChange={(event) => setRunpodApiKey(event.target.value)}
                  placeholder={ko ? "새 RunPod API key" : "New RunPod API key"}
                />
              </div>
              <SectionSaveBar
                onSave={() => void save("keys")}
                saving={savingScope === "keys"}
                saved={savedScope === "keys"}
                ko={ko}
              />
            </div>
          </section>

          {/* Image pods */}
          <PodSection
            icon={<ImageIcon className="h-4 w-4" />}
            title={ko ? "이미지 생성 Pod" : "Image generation pods"}
            description={
              ko
                ? "이미지 생성 화면에서 이 목록의 Pod만 선택할 수 있습니다."
                : "Only pods in this list appear on the image generation page."
            }
            count={imagePods.length}
            ko={ko}
            addLabel={ko ? "이미지 Pod 추가" : "Add image pod"}
            onAdd={() => addPod("image")}
            onSave={() => void save("image")}
            saving={savingScope === "image"}
            saved={savedScope === "image"}
          >
            {renderPodList("image", imagePods)}
          </PodSection>

          {/* Video pods */}
          <PodSection
            icon={<Film className="h-4 w-4" />}
            title={ko ? "비디오 생성 Pod" : "Video generation pods"}
            description={
              ko
                ? "비디오 생성 화면에서 이 목록의 Pod만 선택할 수 있습니다."
                : "Only pods in this list appear on the video generation page."
            }
            count={videoPods.length}
            ko={ko}
            addLabel={ko ? "비디오 Pod 추가" : "Add video pod"}
            onAdd={() => addPod("video")}
            onSave={() => void save("video")}
            saving={savingScope === "video"}
            saved={savedScope === "video"}
          >
            {renderPodList("video", videoPods)}
          </PodSection>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({
  configured,
  savedLabel,
  notSetLabel,
}: {
  configured: boolean;
  savedLabel: string;
  notSetLabel: string;
}) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        configured
          ? "bg-green-500/15 text-green-600"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {configured ? savedLabel : notSetLabel}
    </span>
  );
}

function SectionSaveBar({
  onSave,
  saving,
  saved,
  ko,
}: {
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  ko: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button type="button" onClick={onSave} disabled={saving} size="sm">
        {saving ? (ko ? "저장 중..." : "Saving...") : ko ? "저장" : "Save"}
      </Button>
      {saved && !saving && (
        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
          <Check className="h-3.5 w-3.5" />
          {ko ? "저장했습니다." : "Saved."}
        </span>
      )}
    </div>
  );
}

function PodSection({
  icon,
  title,
  description,
  count,
  ko,
  addLabel,
  onAdd,
  onSave,
  saving,
  saved,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  ko: boolean;
  addLabel: string;
  onAdd: () => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-6 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <Server className="h-3 w-3" />
              {count}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="space-y-4 px-6 py-5">
        {children}
        <Button type="button" variant="outline" className="w-full gap-2" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
        <div className="border-t border-border pt-4">
          <SectionSaveBar onSave={onSave} saving={saving} saved={saved} ko={ko} />
        </div>
      </div>
    </section>
  );
}
