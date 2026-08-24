import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { chatProviderMeta, type ChatProviderId } from "@/lib/chat-models";
import { getPaimonChatConfig } from "@/lib/settings";

// Every Paimon surface (generation chat, character authoring) talks to the LLM
// through this module, so the provider/model the user picked in Settings is the
// single place that decides who answers. OpenRouter, OpenAI and Google are all
// driven through their OpenAI-shaped chat-completions endpoints; Anthropic uses
// the official SDK's Messages API.

export interface ChatTextPart {
  type: "text";
  text: string;
}
export interface ChatImagePart {
  type: "image_url";
  image_url: { url: string };
}
export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface PaimonLlm {
  provider: ChatProviderId;
  model: string;
  apiKey: string;
  /** Settings > 파이몬: let a thinking model reason before answering. */
  reasoning: boolean;
}

// Switch for hybrid thinking models. On deepseek-v4 style models the whole
// reasoning pass lands BEFORE the first answer token, so leaving it on delays
// every params patch (and therefore every queued render) by however long the
// model wants to think. Each vendor spells the knob differently: OpenRouter
// takes `reasoning`, DeepSeek's own API takes `thinking` (and enables it by
// default on deepseek-v4-flash, at "high" effort — so NOT sending it means
// every turn thinks silently for a long time, since our SSE parser only
// forwards `delta.content`, not `delta.reasoning_content`). OpenAI/Google
// ignore reasoning knobs here and keep their own defaults.
function reasoningPayload(llm: PaimonLlm) {
  if (llm.reasoning) return {};
  if (llm.provider === "openrouter") return { reasoning: { enabled: false } };
  if (llm.provider === "deepseek") return { thinking: { type: "disabled" } };
  return {};
}

/** A problem the user can fix in Settings (missing key, rejected request). */
export class PaimonLlmError extends Error {}

const OPENAI_COMPATIBLE_ENDPOINTS: Record<
  Exclude<ChatProviderId, "anthropic">,
  string
> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

// Anthropic has no `response_format`, so the JSON contract is stated in the
// prompt instead. The routes already tolerate fenced JSON when parsing.
const ANTHROPIC_JSON_INSTRUCTION =
  "Respond with a single JSON object only. Do not wrap it in markdown fences and do not write anything before or after it.";

export async function resolvePaimonLlm(): Promise<PaimonLlm> {
  const { provider, model, apiKey, reasoning } = await getPaimonChatConfig();
  const meta = chatProviderMeta(provider);
  if (!apiKey) {
    throw new PaimonLlmError(
      `${meta.label} API 키가 없습니다. 설정 > ${meta.label} 탭에서 키를 입력하세요.`
    );
  }
  if (!model) {
    throw new PaimonLlmError(
      `파이몬 채팅 모델이 선택되지 않았습니다. 설정 > ${meta.label} 탭에서 모델을 고르세요.`
    );
  }
  return { provider, model, apiKey, reasoning };
}

function anthropicClient(apiKey: string) {
  return new Anthropic({ apiKey });
}

function openAiCompatibleHeaders(provider: ChatProviderId, apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "Image Gen Paimon";
  }
  return headers;
}

type ChatPayload = Record<string, unknown>;

// Vendors disagree on which optional knobs they accept (newer OpenAI models
// reject `temperature` and renamed `max_tokens`; some Gemini models reject
// `response_format: json_object`). Rather than maintain a per-model matrix, drop
// the rejected knob and retry once — the request itself stays identical.
function relaxPayload(payload: ChatPayload, message: string): ChatPayload | null {
  if (/temperature/i.test(message) && "temperature" in payload) {
    const { temperature, ...rest } = payload;
    void temperature;
    return rest;
  }
  if (/max_tokens/i.test(message) && "max_tokens" in payload) {
    const { max_tokens, ...rest } = payload;
    return { ...rest, max_completion_tokens: max_tokens };
  }
  if (/reasoning/i.test(message) && "reasoning" in payload) {
    const { reasoning, ...rest } = payload;
    void reasoning;
    return rest;
  }
  if (/thinking/i.test(message) && "thinking" in payload) {
    const { thinking, ...rest } = payload;
    void thinking;
    return rest;
  }
  if (/response_format|json_object|json_schema/i.test(message) && "response_format" in payload) {
    const { response_format, ...rest } = payload;
    void response_format;
    return rest;
  }
  return null;
}

async function postOpenAiCompatible(
  provider: Exclude<ChatProviderId, "anthropic">,
  apiKey: string,
  payload: ChatPayload,
  signal?: AbortSignal
) {
  let body = payload;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(OPENAI_COMPATIBLE_ENDPOINTS[provider], {
      method: "POST",
      signal,
      headers: openAiCompatibleHeaders(provider, apiKey),
      body: JSON.stringify(body),
    });
    if (response.ok) return response;

    const error = await response.json().catch(() => null);
    const message =
      error?.error?.message ??
      error?.message ??
      `${chatProviderMeta(provider).label} request failed (${response.status}).`;
    const relaxed = relaxPayload(body, String(message));
    if (!relaxed) throw new PaimonLlmError(String(message));
    body = relaxed;
  }
  throw new PaimonLlmError(
    `${chatProviderMeta(provider).label} rejected the request.`
  );
}

function toAnthropicContent(content: ChatContentPart[]): Anthropic.ContentBlockParam[] {
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const url = part.image_url.url;
    const dataUrl = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!dataUrl) {
      return { type: "image", source: { type: "url", url } };
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: dataUrl[2],
      },
    };
  });
}

function anthropicText(message: Anthropic.Message) {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Ordered vision-capable models for the attachment analysis pass. On the
 * single-vendor providers the picked chat model goes first (their flagships are
 * multimodal); OpenRouter keeps its dedicated vision line-up.
 */
export function visionModelCandidates(llm: PaimonLlm) {
  const meta = chatProviderMeta(llm.provider);
  const candidates =
    llm.provider === "openrouter"
      ? meta.visionModels
      : [llm.model, ...meta.visionModels];
  return [...new Set(candidates)];
}

/** Non-streaming multimodal call used for reference-image analysis. */
export async function analyzeWithVision(
  llm: PaimonLlm,
  content: ChatContentPart[]
): Promise<{ analysis: string; errors: string[] }> {
  const errors: string[] = [];

  for (const model of visionModelCandidates(llm)) {
    try {
      if (llm.provider === "anthropic") {
        const message = await anthropicClient(llm.apiKey).messages.create(
          {
            model,
            max_tokens: 900,
            messages: [{ role: "user", content: toAnthropicContent(content) }],
          },
          { timeout: 20_000 }
        );
        const analysis = anthropicText(message).trim();
        if (analysis) return { analysis, errors };
        errors.push(`${model}: empty analysis`);
        continue;
      }

      const response = await postOpenAiCompatible(
        llm.provider,
        llm.apiKey,
        {
          model,
          temperature: 0.1,
          max_tokens: 900,
          ...reasoningPayload(llm),
          messages: [{ role: "user", content }],
        },
        AbortSignal.timeout(20_000)
      );
      const result = await response.json().catch(() => null);
      const analysis = result?.choices?.[0]?.message?.content;
      if (typeof analysis === "string" && analysis.trim()) {
        return { analysis: analysis.trim(), errors };
      }
      errors.push(`${model}: empty analysis`);
    } catch (error) {
      errors.push(
        `${model}: ${error instanceof Error ? error.message : "request failed"}`
      );
    }
  }

  return { analysis: "", errors };
}

export interface StreamJsonOptions {
  llm: PaimonLlm;
  system: string;
  /** Serialized request context; sent as the single user message. */
  user: string;
  temperature: number;
  maxTokens?: number;
  /** Called with each text delta as it arrives. */
  onDelta: (delta: string) => void;
  /** Aborts the upstream request (the client cancelled the answer). */
  signal?: AbortSignal;
}

/**
 * Streams a JSON-object answer and returns the full raw text. Deltas are
 * forwarded as they arrive so the UI can render Paimon's reply progressively.
 */
export async function streamJsonCompletion({
  llm,
  system,
  user,
  temperature,
  maxTokens = 32_000,
  onDelta,
  signal,
}: StreamJsonOptions): Promise<string> {
  if (llm.provider === "anthropic") {
    // No temperature: it is rejected on current Claude models. Thinking and
    // effort are left at each model's default so any listed model works.
    const stream = anthropicClient(llm.apiKey).messages.stream(
      {
        model: llm.model,
        max_tokens: maxTokens,
        system: `${system}\n\n${ANTHROPIC_JSON_INSTRUCTION}`,
        messages: [{ role: "user", content: user }],
      },
      { signal }
    );

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        onDelta(event.delta.text);
      }
    }

    return anthropicText(await stream.finalMessage());
  }

  const response = await postOpenAiCompatible(
    llm.provider,
    llm.apiKey,
    {
      model: llm.model,
      temperature,
      stream: true,
      response_format: { type: "json_object" },
      ...reasoningPayload(llm),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    signal
  );

  if (!response.body) {
    throw new PaimonLlmError(
      `${chatProviderMeta(llm.provider).label} returned an empty stream.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let content = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta !== "string" || !delta) continue;
        content += delta;
        onDelta(delta);
      } catch {
        // Ignore keep-alive comments / non-JSON lines.
      }
    }
  }

  return content;
}
