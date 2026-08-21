"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Cpu,
  Download,
  Film,
  Gem,
  Image as ImageIcon,
  KeyRound,
  Plus,
  RefreshCw,
  Route,
  Search,
  Server,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CHAT_PROVIDERS,
  chatProviderMeta,
  type ChatModelOption,
  type ChatProviderId,
} from "@/lib/chat-models";
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

type SettingsGroup = "basic" | "pods" | "llm";
type SaveScope = "keys" | "image" | "video" | ChatProviderId;
type ImportMode = "replace" | "append";

interface ModelListState {
  models: ChatModelOption[];
  source: "live" | "fallback";
  error: string;
  loading: boolean;
}

const PROVIDER_ICONS: Record<ChatProviderId, React.ReactNode> = {
  openrouter: <Route className="h-4 w-4" />,
  anthropic: <Sparkles className="h-4 w-4" />,
  openai: <Bot className="h-4 w-4" />,
  google: <Gem className="h-4 w-4" />,
};

const POD_EXPORT_FILENAME = "runpod-pods.json";

const emptyPod = (kind: RunpodPodKind): RunpodPodForm => ({
  id: crypto.randomUUID(),
  kind,
  label: "",
  podId: "",
  ssh: "",
  comfyUrl: "",
});

const emptyProviderRecord = <T,>(value: T) =>
  Object.fromEntries(
    CHAT_PROVIDERS.map((provider) => [provider.id, value])
  ) as Record<ChatProviderId, T>;

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

/**
 * Same wrapper shape as data/default-pods.json, so an exported file can be
 * dropped in as the version-controlled seed for a fresh clone.
 */
const podsToJson = (pods: RunpodPodForm[]) =>
  JSON.stringify(
    {
      runpodPods: pods.map((pod) => ({
        id: pod.id,
        kind: pod.kind,
        label: pod.label,
        podId: pod.podId,
        ssh: pod.ssh,
        comfyUrl: pod.comfyUrl,
      })),
    },
    null,
    2
  );

// Accepts a bare array or a { runpodPods: [...] } wrapper, like the server does.
const podsFromJson = (raw: string) => {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { runpodPods?: unknown })?.runpodPods;
  if (!Array.isArray(list)) throw new Error("runpodPods");
  const pods = normalizePods(list).filter((pod) => pod.podId || pod.comfyUrl);
  if (pods.length === 0) throw new Error("empty");
  return pods;
};

export default function SettingsPage() {
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const [group, setGroup] = useState<SettingsGroup>("basic");
  const [podTab, setPodTab] = useState<RunpodPodKind>("image");
  const [llmTab, setLlmTab] = useState<ChatProviderId>("openrouter");
  const [civitaiApiKey, setCivitaiApiKey] = useState("");
  const [huggingfaceApiKey, setHuggingfaceApiKey] = useState("");
  const [runpodApiKey, setRunpodApiKey] = useState("");
  const [civitaiApiKeyConfigured, setCivitaiApiKeyConfigured] = useState(false);
  const [huggingfaceApiKeyConfigured, setHuggingfaceApiKeyConfigured] =
    useState(false);
  const [runpodApiKeyConfigured, setRunpodApiKeyConfigured] = useState(false);
  const [runpodPods, setRunpodPods] = useState<RunpodPodForm[]>([]);
  const [podJsonDraft, setPodJsonDraft] = useState("");
  const [podTransferError, setPodTransferError] = useState("");
  const [podTransferNotice, setPodTransferNotice] = useState("");
  const podFileInput = useRef<HTMLInputElement>(null);
  // Chat providers: one key draft per provider, plus where its key comes from
  // (saved in settings, or only present as an environment variable).
  const [chatKeys, setChatKeys] = useState(() => emptyProviderRecord(""));
  const [chatKeysStored, setChatKeysStored] = useState(() =>
    emptyProviderRecord(false)
  );
  const [chatKeysAvailable, setChatKeysAvailable] = useState(() =>
    emptyProviderRecord(false)
  );
  const [paimonProvider, setPaimonProvider] =
    useState<ChatProviderId>("openrouter");
  const [paimonModel, setPaimonModel] = useState("");
  const [modelLists, setModelLists] = useState<
    Partial<Record<ChatProviderId, ModelListState>>
  >({});
  const [modelSearch, setModelSearch] = useState(() => emptyProviderRecord(""));
  const [customModel, setCustomModel] = useState(() => emptyProviderRecord(""));
  const [loadError, setLoadError] = useState("");
  const [savingScope, setSavingScope] = useState<SaveScope | null>(null);
  const [savedScope, setSavedScope] = useState<SaveScope | null>(null);

  const applySettings = useCallback((data: Record<string, unknown>) => {
    setCivitaiApiKeyConfigured(Boolean(data.civitaiApiKeyConfigured));
    setHuggingfaceApiKeyConfigured(Boolean(data.huggingfaceApiKeyConfigured));
    setRunpodApiKeyConfigured(Boolean(data.runpodApiKeyConfigured));
    setRunpodPods(normalizePods(data.runpodPods));
    const readFlags = (value: unknown) => {
      const flags = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        CHAT_PROVIDERS.map((provider) => [provider.id, Boolean(flags[provider.id])])
      ) as Record<ChatProviderId, boolean>;
    };
    setChatKeysStored(readFlags(data.chatProviderKeysStored));
    setChatKeysAvailable(readFlags(data.chatProviderKeysAvailable));
    if (typeof data.paimonChatProvider === "string") {
      setPaimonProvider(data.paimonChatProvider as ChatProviderId);
    }
    if (typeof data.paimonChatModel === "string") {
      setPaimonModel(data.paimonChatModel);
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then(applySettings)
      .catch(() =>
        setLoadError(ko ? "설정을 불러오지 못했습니다." : "Failed to load settings.")
      );
  }, [applySettings, ko]);

  const loadModels = useCallback(
    async (provider: ChatProviderId) => {
      setModelLists((lists) => ({
        ...lists,
        [provider]: {
          models:
            lists[provider]?.models ?? chatProviderMeta(provider).fallbackModels,
          source: lists[provider]?.source ?? "fallback",
          error: "",
          loading: true,
        },
      }));
      try {
        const response = await fetch(
          `/api/settings/chat-models?provider=${provider}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        setModelLists((lists) => ({
          ...lists,
          [provider]: {
            models: Array.isArray(data.models) ? data.models : [],
            source: data.source === "live" ? "live" : "fallback",
            error: typeof data.error === "string" ? data.error : "",
            loading: false,
          },
        }));
      } catch {
        setModelLists((lists) => ({
          ...lists,
          [provider]: {
            models: chatProviderMeta(provider).fallbackModels,
            source: "fallback",
            error: ko ? "모델 목록을 불러오지 못했습니다." : "Failed to load models.",
            loading: false,
          },
        }));
      }
    },
    [ko]
  );

  // Model lists are fetched the first time a provider's panel is opened.
  const openLlmTab = (provider: ChatProviderId) => {
    setLlmTab(provider);
    if (!modelLists[provider]) void loadModels(provider);
  };
  const openGroup = (next: SettingsGroup) => {
    setGroup(next);
    if (next === "llm" && !modelLists[llmTab]) void loadModels(llmTab);
  };

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

  const resetPodTransferFeedback = () => {
    setPodTransferError("");
    setPodTransferNotice("");
  };

  const exportPods = () => {
    resetPodTransferFeedback();
    const blob = new Blob([podsToJson(runpodPods)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = POD_EXPORT_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
    setPodTransferNotice(
      ko
        ? `${POD_EXPORT_FILENAME} 파일로 내보냈습니다. (${runpodPods.length}개)`
        : `Exported ${runpodPods.length} pod(s) to ${POD_EXPORT_FILENAME}.`
    );
  };

  const copyPodsJson = async () => {
    resetPodTransferFeedback();
    try {
      await navigator.clipboard.writeText(podsToJson(runpodPods));
      setPodTransferNotice(ko ? "JSON을 복사했습니다." : "JSON copied.");
    } catch {
      // Clipboard needs a secure context; fall back to the editable textarea.
      setPodJsonDraft(podsToJson(runpodPods));
      setPodTransferError(
        ko
          ? "클립보드를 사용할 수 없어 아래 입력란에 JSON을 채웠습니다."
          : "Clipboard unavailable — the JSON was placed in the box below."
      );
    }
  };

  const importPodsJson = (raw: string, mode: ImportMode) => {
    resetPodTransferFeedback();
    let incoming: RunpodPodForm[];
    try {
      incoming = podsFromJson(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setPodTransferError(
        reason === "runpodPods"
          ? ko
            ? "runpodPods 배열을 찾을 수 없습니다. Pod 배열 또는 { \"runpodPods\": [...] } 형식이어야 합니다."
            : 'No runpodPods array found. Expected a pod array or { "runpodPods": [...] }.'
          : reason === "empty"
            ? ko
              ? "가져올 Pod가 없습니다. 각 Pod에는 Pod ID나 ComfyUI URL이 있어야 합니다."
              : "No importable pods. Each pod needs a Pod ID or a ComfyUI URL."
            : ko
              ? "JSON을 해석할 수 없습니다."
              : "Could not parse the JSON."
      );
      return;
    }

    if (mode === "replace") {
      setRunpodPods(incoming);
      setPodTransferNotice(
        ko
          ? `Pod ${incoming.length}개로 교체했습니다. 저장을 눌러 반영하세요.`
          : `Replaced the list with ${incoming.length} pod(s). Press Save to apply.`
      );
      return;
    }

    // Append: skip pods that already exist (same Pod ID or ComfyUI URL) and
    // give every added pod a fresh id so ids never collide.
    const known = new Set(
      runpodPods.flatMap((pod) => [pod.podId, pod.comfyUrl].filter(Boolean))
    );
    const added = incoming
      .filter(
        (pod) =>
          !(pod.podId && known.has(pod.podId)) &&
          !(pod.comfyUrl && known.has(pod.comfyUrl))
      )
      .map((pod) => ({ ...pod, id: crypto.randomUUID() }));
    setRunpodPods((pods) => [...pods, ...added]);
    setPodTransferNotice(
      ko
        ? `Pod ${added.length}개를 추가했습니다 (중복 ${
            incoming.length - added.length
          }개 제외). 저장을 눌러 반영하세요.`
        : `Added ${added.length} pod(s), skipped ${
            incoming.length - added.length
          } duplicate(s). Press Save to apply.`
    );
  };

  const importPodsFile = async (file: File) => {
    try {
      importPodsJson(await file.text(), "replace");
    } catch {
      setPodTransferError(
        ko ? "파일을 읽지 못했습니다." : "Could not read the file."
      );
    }
  };

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
          openrouterApiKey: chatKeys.openrouter,
          anthropicApiKey: chatKeys.anthropic,
          openaiApiKey: chatKeys.openai,
          googleApiKey: chatKeys.google,
          paimonChatProvider: paimonProvider,
          paimonChatModel: paimonModel,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      applySettings(await response.json());
      if (scope === "keys") {
        setCivitaiApiKey("");
        setHuggingfaceApiKey("");
        setRunpodApiKey("");
      }
      const provider = CHAT_PROVIDERS.find((entry) => entry.id === scope);
      if (provider) {
        setChatKeys((keys) => ({ ...keys, [provider.id]: "" }));
        // The stored key may unlock the provider's full catalog.
        void loadModels(provider.id);
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
  const activeProviderLabel = chatProviderMeta(paimonProvider).label;

  return (
    <div className="flex h-screen">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-muted/20">
        <div className="border-b border-border bg-background px-8 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {ko ? "설정" : "Settings"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {ko
                  ? "외부 서비스 키, 원격 생성 Pod, 파이몬 LLM을 관리합니다."
                  : "Manage external service keys, remote generation pods, and Paimon's LLM."}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <div className="font-semibold text-muted-foreground">
                {ko ? "파이몬 채팅 모델" : "Paimon chat model"}
              </div>
              <div className="mt-0.5 font-medium">
                {activeProviderLabel} · {paimonModel || (ko ? "미선택" : "none")}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl space-y-6 p-8">
          {loadError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          )}

          <Tabs
            value={group}
            onValueChange={(value) => openGroup(value as SettingsGroup)}
            className="gap-6"
          >
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="gap-1.5">
                <KeyRound className="h-4 w-4" />
                {ko ? "기본" : "Basic"}
              </TabsTrigger>
              <TabsTrigger value="pods" className="gap-1.5">
                <Server className="h-4 w-4" />
                {ko ? "팟" : "Pods"}
              </TabsTrigger>
              <TabsTrigger value="llm" className="gap-1.5">
                <Cpu className="h-4 w-4" />
                LLM
              </TabsTrigger>
            </TabsList>

            {/* 기본 — external service keys */}
            <TabsContent value="basic">
              <section className="rounded-xl border border-border bg-background shadow-sm">
                <header className="flex items-start gap-3 border-b border-border px-6 py-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">
                      {ko ? "서비스 키" : "Service keys"}
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
            </TabsContent>

            {/* 팟 — image/video pod lists + JSON transfer */}
            <TabsContent value="pods">
              <div className="space-y-6">
                <Tabs
                  value={podTab}
                  onValueChange={(value) => setPodTab(value as RunpodPodKind)}
                  className="gap-4"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="image" className="gap-1.5">
                      <ImageIcon className="h-4 w-4" />
                      {ko ? "이미지 Pod" : "Image pods"}
                      <PodCountBadge count={imagePods.length} />
                    </TabsTrigger>
                    <TabsTrigger value="video" className="gap-1.5">
                      <Film className="h-4 w-4" />
                      {ko ? "비디오 Pod" : "Video pods"}
                      <PodCountBadge count={videoPods.length} />
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="image">
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
                  </TabsContent>

                  <TabsContent value="video">
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
                  </TabsContent>
                </Tabs>

                <PodTransferSection
                  ko={ko}
                  total={runpodPods.length}
                  imageCount={imagePods.length}
                  videoCount={videoPods.length}
                  jsonDraft={podJsonDraft}
                  onJsonDraftChange={setPodJsonDraft}
                  error={podTransferError}
                  notice={podTransferNotice}
                  fileInputRef={podFileInput}
                  onExport={exportPods}
                  onCopy={() => void copyPodsJson()}
                  onFillDraft={() => {
                    resetPodTransferFeedback();
                    setPodJsonDraft(podsToJson(runpodPods));
                  }}
                  onImport={(mode) => importPodsJson(podJsonDraft, mode)}
                  onPickFile={() => podFileInput.current?.click()}
                  onFileChange={(file) => void importPodsFile(file)}
                />
              </div>
            </TabsContent>

            {/* LLM — one tab per chat provider */}
            <TabsContent value="llm">
              <Tabs
                value={llmTab}
                onValueChange={(value) => openLlmTab(value as ChatProviderId)}
                className="gap-4"
              >
                <TabsList className="h-auto w-full flex-wrap gap-1">
                  {CHAT_PROVIDERS.map((provider) => (
                    <TabsTrigger
                      key={provider.id}
                      value={provider.id}
                      className="gap-1.5"
                    >
                      {PROVIDER_ICONS[provider.id]}
                      {provider.label}
                      {paimonProvider === provider.id && (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {CHAT_PROVIDERS.map((provider) => (
                  <TabsContent key={provider.id} value={provider.id}>
                    <ChatProviderSection
                      ko={ko}
                      icon={PROVIDER_ICONS[provider.id]}
                      provider={provider.id}
                      isActiveProvider={paimonProvider === provider.id}
                      selectedModel={
                        paimonProvider === provider.id ? paimonModel : ""
                      }
                      keyDraft={chatKeys[provider.id]}
                      keyStored={chatKeysStored[provider.id]}
                      keyAvailable={chatKeysAvailable[provider.id]}
                      onKeyChange={(value) =>
                        setChatKeys((keys) => ({ ...keys, [provider.id]: value }))
                      }
                      list={modelLists[provider.id]}
                      search={modelSearch[provider.id]}
                      onSearchChange={(value) =>
                        setModelSearch((state) => ({
                          ...state,
                          [provider.id]: value,
                        }))
                      }
                      customModel={customModel[provider.id]}
                      onCustomModelChange={(value) =>
                        setCustomModel((state) => ({
                          ...state,
                          [provider.id]: value,
                        }))
                      }
                      onSelectModel={(model) => {
                        setPaimonProvider(provider.id);
                        setPaimonModel(model);
                      }}
                      onRefresh={() => void loadModels(provider.id)}
                      onSave={() => void save(provider.id)}
                      saving={savingScope === provider.id}
                      saved={savedScope === provider.id}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function PodCountBadge({ count }: { count: number }) {
  return (
    <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
      {count}
    </span>
  );
}

function PodTransferSection({
  ko,
  total,
  imageCount,
  videoCount,
  jsonDraft,
  onJsonDraftChange,
  error,
  notice,
  fileInputRef,
  onExport,
  onCopy,
  onFillDraft,
  onImport,
  onPickFile,
  onFileChange,
}: {
  ko: boolean;
  total: number;
  imageCount: number;
  videoCount: number;
  jsonDraft: string;
  onJsonDraftChange: (value: string) => void;
  error: string;
  notice: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onCopy: () => void;
  onFillDraft: () => void;
  onImport: (mode: ImportMode) => void;
  onPickFile: () => void;
  onFileChange: (file: File) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-6 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">
            {ko ? "Pod 목록 JSON 내보내기 / 가져오기" : "Export / import pods as JSON"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {ko
              ? `이미지 ${imageCount}개 + 비디오 ${videoCount}개, 총 ${total}개. 내보낸 파일은 data/default-pods.json 형식과 같아서 다른 PC에 그대로 옮길 수 있습니다.`
              : `${imageCount} image + ${videoCount} video pods (${total} total). The exported file uses the same shape as data/default-pods.json, so it can be moved to another machine as-is.`}
          </p>
        </div>
      </header>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            {ko ? "내보내기" : "Export"}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={onExport}
              disabled={total === 0}
            >
              <Download className="h-4 w-4" />
              {ko ? "JSON 파일 다운로드" : "Download JSON file"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={onCopy}
              disabled={total === 0}
            >
              <Copy className="h-4 w-4" />
              {ko ? "JSON 복사" : "Copy JSON"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              onClick={onFillDraft}
              disabled={total === 0}
            >
              {ko ? "아래에 JSON 표시" : "Show JSON below"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pod-json-draft" className="text-xs text-muted-foreground">
            {ko ? "가져오기" : "Import"}
          </Label>
          <Textarea
            id="pod-json-draft"
            value={jsonDraft}
            onChange={(event) => onJsonDraftChange(event.target.value)}
            spellCheck={false}
            className="min-h-40 font-mono text-xs"
            placeholder={
              ko
                ? '{ "runpodPods": [ { "kind": "image", "label": "...", "podId": "...", "comfyUrl": "https://..." } ] }'
                : '{ "runpodPods": [ { "kind": "image", "label": "...", "podId": "...", "comfyUrl": "https://..." } ] }'
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="gap-2"
              onClick={() => onImport("replace")}
              disabled={!jsonDraft.trim()}
            >
              <Upload className="h-4 w-4" />
              {ko ? "교체하기" : "Replace list"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => onImport("append")}
              disabled={!jsonDraft.trim()}
            >
              <Plus className="h-4 w-4" />
              {ko ? "추가하기" : "Append"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={onPickFile}
            >
              <Upload className="h-4 w-4" />
              {ko ? "파일에서 교체" : "Replace from file"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so re-picking the same file fires onChange again.
                event.target.value = "";
                if (file) onFileChange(file);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {ko
              ? "Pod 배열 또는 { \"runpodPods\": [...] } 형식을 지원합니다. 가져오기는 화면의 목록만 바꾸므로, 각 Pod 탭에서 저장을 눌러야 서버에 반영됩니다."
              : 'Accepts a pod array or { "runpodPods": [...] }. Importing only updates the on-screen list — press Save in a pod tab to persist it.'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <Check className="h-3.5 w-3.5 text-green-600" />
            {notice}
          </div>
        )}
      </div>
    </section>
  );
}

function ChatProviderSection({
  ko,
  icon,
  provider,
  isActiveProvider,
  selectedModel,
  keyDraft,
  keyStored,
  keyAvailable,
  onKeyChange,
  list,
  search,
  onSearchChange,
  customModel,
  onCustomModelChange,
  onSelectModel,
  onRefresh,
  onSave,
  saving,
  saved,
}: {
  ko: boolean;
  icon: React.ReactNode;
  provider: ChatProviderId;
  isActiveProvider: boolean;
  selectedModel: string;
  keyDraft: string;
  keyStored: boolean;
  keyAvailable: boolean;
  onKeyChange: (value: string) => void;
  list?: ModelListState;
  search: string;
  onSearchChange: (value: string) => void;
  customModel: string;
  onCustomModelChange: (value: string) => void;
  onSelectModel: (model: string) => void;
  onRefresh: () => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const meta = chatProviderMeta(provider);
  const models = list?.models ?? meta.fallbackModels;
  const query = search.trim().toLowerCase();
  const visible = query
    ? models.filter(
        (model) =>
          model.id.toLowerCase().includes(query) ||
          model.label.toLowerCase().includes(query)
      )
    : models;

  return (
    <section className="rounded-xl border border-border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-6 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{meta.label}</h2>
            {isActiveProvider && (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {ko ? "파이몬 사용 중" : "Used by Paimon"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {ko ? meta.keyHintKo : meta.keyHintEn}
          </p>
        </div>
      </header>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${provider}-api-key`}>{meta.keyLabel}</Label>
            <StatusBadge
              configured={keyAvailable}
              savedLabel={
                keyStored
                  ? ko
                    ? "저장됨"
                    : "Saved"
                  : ko
                    ? "환경변수"
                    : "From env"
              }
              notSetLabel={ko ? "미설정" : "Not set"}
            />
          </div>
          <Input
            id={`${provider}-api-key`}
            type="password"
            value={keyDraft}
            onChange={(event) => onKeyChange(event.target.value)}
            placeholder={meta.keyPlaceholder}
          />
          <p className="text-xs text-muted-foreground">
            {ko ? "키 발급: " : "Get a key: "}
            <a
              href={meta.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {meta.keyUrl}
            </a>
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              {ko ? "모델 목록" : "Models"}
              {list?.source === "live" && (
                <span className="ml-2 font-normal">
                  {ko ? `${models.length}개` : `${models.length} available`}
                </span>
              )}
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs"
              onClick={onRefresh}
              disabled={list?.loading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${list?.loading ? "animate-spin" : ""}`}
              />
              {ko ? "새로고침" : "Refresh"}
            </Button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={ko ? "모델 검색" : "Search models"}
              className="pl-8"
            />
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2">
            {visible.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {list?.loading
                  ? ko
                    ? "모델 목록을 불러오는 중..."
                    : "Loading models..."
                  : ko
                    ? "일치하는 모델이 없습니다."
                    : "No matching models."}
              </div>
            ) : (
              visible.map((model) => {
                const active = selectedModel === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onSelectModel(model.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-secondary/60"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {model.label}
                      </span>
                      {model.label !== model.id && (
                        <span
                          className={`block truncate text-[11px] ${
                            active
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground"
                          }`}
                        >
                          {model.id}
                        </span>
                      )}
                    </span>
                    {active && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {list?.error && (
            <p className="text-xs text-muted-foreground">{list.error}</p>
          )}
          {list?.source === "fallback" && !list.loading && !list.error && (
            <p className="text-xs text-muted-foreground">
              {ko
                ? "권장 모델만 표시하는 중입니다. 키를 저장하고 새로고침하면 전체 목록을 불러옵니다."
                : "Showing the curated list only. Save a key and refresh to load the full catalog."}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {ko ? "모델 ID 직접 입력" : "Enter a model ID"}
            </Label>
            <div className="flex gap-2">
              <Input
                value={customModel}
                onChange={(event) => onCustomModelChange(event.target.value)}
                placeholder={
                  meta.fallbackModels[0]?.id ?? (ko ? "모델 ID" : "Model ID")
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={!customModel.trim()}
                onClick={() => onSelectModel(customModel.trim())}
              >
                {ko ? "선택" : "Use"}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          {selectedModel ? (
            <span>
              {ko ? "파이몬이 사용할 모델: " : "Paimon will use: "}
              <span className="font-semibold">{selectedModel}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {ko
                ? "이 프로바이더의 모델을 고르면 파이몬이 해당 모델로 답합니다."
                : "Pick a model here to have Paimon answer through this provider."}
            </span>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <SectionSaveBar onSave={onSave} saving={saving} saved={saved} ko={ko} />
        </div>
      </div>
    </section>
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
