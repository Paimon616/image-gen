"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useStore } from "@/lib/store";

interface RunpodPodForm {
  id: string;
  label: string;
  podId: string;
  ssh: string;
  comfyUrl: string;
}

const emptyPod = (): RunpodPodForm => ({
  id: crypto.randomUUID(),
  label: "",
  podId: "",
  ssh: "",
  comfyUrl: "",
});

export default function SettingsPage() {
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const [civitaiApiKey, setCivitaiApiKey] = useState("");
  const [runpodApiKey, setRunpodApiKey] = useState("");
  const [civitaiApiKeyConfigured, setCivitaiApiKeyConfigured] = useState(false);
  const [runpodApiKeyConfigured, setRunpodApiKeyConfigured] = useState(false);
  const [runpodPods, setRunpodPods] = useState<RunpodPodForm[]>([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setCivitaiApiKeyConfigured(Boolean(data.civitaiApiKeyConfigured));
        setRunpodApiKeyConfigured(Boolean(data.runpodApiKeyConfigured));
        setRunpodPods(Array.isArray(data.runpodPods) ? data.runpodPods : []);
      })
      .catch(() => setStatus(ko ? "설정을 불러오지 못했습니다." : "Failed to load settings."));
  }, [ko]);

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ civitaiApiKey, runpodApiKey, runpodPods }),
      });
      if (!response.ok) throw new Error("Save failed");
      const data = await response.json();
      setCivitaiApiKeyConfigured(Boolean(data.civitaiApiKeyConfigured));
      setRunpodApiKeyConfigured(Boolean(data.runpodApiKeyConfigured));
      setRunpodPods(Array.isArray(data.runpodPods) ? data.runpodPods : runpodPods);
      setCivitaiApiKey("");
      setRunpodApiKey("");
      setStatus(ko ? "저장했습니다." : "Saved.");
    } catch {
      setStatus(ko ? "저장하지 못했습니다." : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold">{ko ? "설정" : "Settings"}</h1>
          <p className="text-xs text-muted-foreground">
            {ko
              ? "외부 서비스 키와 원격 생성 대상을 관리합니다."
              : "Manage external service keys and remote generation targets."}
          </p>
        </div>

        <div className="max-w-3xl space-y-8 p-6">
          <section className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Civitai</h2>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    civitaiApiKeyConfigured
                      ? "bg-green-500/15 text-green-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {civitaiApiKeyConfigured
                    ? ko ? "저장됨" : "Saved"
                    : ko ? "미설정" : "Not set"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {ko
                  ? "API key는 서버에 저장되며 화면에는 다시 표시하지 않습니다. 빈칸은 기존 값을 유지합니다."
                  : "The API key is stored server-side and never shown again. Blank keeps the existing value."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="civitai-api-key">API Key</Label>
              <Input
                id="civitai-api-key"
                type="password"
                value={civitaiApiKey}
                onChange={(event) => setCivitaiApiKey(event.target.value)}
                placeholder={ko ? "새 Civitai API key" : "New Civitai API key"}
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">RunPod</h2>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    runpodApiKeyConfigured
                      ? "bg-green-500/15 text-green-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {runpodApiKeyConfigured
                    ? ko ? "API key 저장됨" : "API key saved"
                    : ko ? "API key 미설정" : "API key not set"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {ko
                  ? "SSH는 RunPod가 복사해주는 전체 명령 그대로 붙여넣으세요. 이미지 생성에는 Port 8188 HTTP service의 ComfyUI URL을 사용합니다."
                  : "Paste the full SSH command copied from RunPod. Generation uses the Port 8188 HTTP service ComfyUI URL."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="runpod-api-key">RunPod API Key</Label>
              <Input
                id="runpod-api-key"
                type="password"
                value={runpodApiKey}
                onChange={(event) => setRunpodApiKey(event.target.value)}
                placeholder={ko ? "새 RunPod API key" : "New RunPod API key"}
              />
            </div>

            <div className="space-y-3">
              {runpodPods.map((pod, index) => (
                <div key={pod.id} className="rounded-md border border-border p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">
                      {pod.label || (ko ? `RunPod ${index + 1}` : `RunPod ${index + 1}`)}
                    </h3>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setRunpodPods((pods) => pods.filter((item) => item.id !== pod.id))
                      }
                      aria-label={ko ? "Pod 삭제" : "Delete pod"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      value={pod.label}
                      onChange={(event) =>
                        setRunpodPods((pods) =>
                          pods.map((item) =>
                            item.id === pod.id ? { ...item, label: event.target.value } : item
                          )
                        )
                      }
                      placeholder={ko ? "라벨" : "Label"}
                    />
                    <Input
                      value={pod.podId}
                      onChange={(event) =>
                        setRunpodPods((pods) =>
                          pods.map((item) =>
                            item.id === pod.id ? { ...item, podId: event.target.value } : item
                          )
                        )
                      }
                      placeholder="Pod ID"
                    />
                    <Input
                      value={pod.ssh}
                      onChange={(event) =>
                        setRunpodPods((pods) =>
                          pods.map((item) =>
                            item.id === pod.id ? { ...item, ssh: event.target.value } : item
                          )
                        )
                      }
                      placeholder="ssh pod-user@ssh.runpod.io -i ~/.ssh/id_ed25519"
                    />
                    <Input
                      value={pod.comfyUrl}
                      onChange={(event) =>
                        setRunpodPods((pods) =>
                          pods.map((item) =>
                            item.id === pod.id ? { ...item, comfyUrl: event.target.value } : item
                          )
                        )
                      }
                      placeholder="ComfyUI URL, e.g. https://..."
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setRunpodPods((pods) => [...pods, emptyPod()])}
              >
                <Plus className="h-4 w-4" />
                {ko ? "Pod 추가" : "Add pod"}
              </Button>
            </div>
          </section>

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button type="button" onClick={() => void save()} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? (ko ? "저장 중..." : "Saving...") : ko ? "저장" : "Save"}
            </Button>
            {status && <span className="text-sm text-muted-foreground">{status}</span>}
          </div>
        </div>
      </main>
    </div>
  );
}
