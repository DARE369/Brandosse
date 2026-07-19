import { readEnv } from "./env.ts";
import { createHttpError } from "./org.ts";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmResult = {
  content: string;
  model: string;
  provider: string;
  totalTokens: number;
};

type ProviderConfig = {
  provider: "groq" | "anthropic";
  model: string;
  url: string;
  key: string;
};

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(String(value || "").length / 4));
}

function resolveProviders(preferredProvider?: string | null) {
  const groqKey      = readEnv("GROQ_API_KEY",      false);
  const anthropicKey = readEnv("ANTHROPIC_API_KEY", false);

  // Normalise so both "anthropic" and "claude" resolve correctly.
  const raw = String(
    preferredProvider || readEnv("DEFAULT_AI_MODEL", false) || "anthropic",
  ).toLowerCase();
  const preferred: "anthropic" | "groq" =
    raw.includes("claude") || raw.includes("anthropic") ? "anthropic" : "groq";

  const anthropicEntry: ProviderConfig = {
    provider: "anthropic",
    model: readEnv("ANTHROPIC_MODEL", false) || "claude-3-5-sonnet-latest",
    url: "https://api.anthropic.com/v1/messages",
    key: anthropicKey || "",
  };
  const groqEntry: ProviderConfig = {
    provider: "groq",
    model: readEnv("GROQ_MODEL", false) || "llama-3.3-70b-versatile",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: groqKey || "",
  };

  // Preferred provider first; the other is the fallback.
  const ordered: ProviderConfig[] =
    preferred === "anthropic" ? [anthropicEntry, groqEntry] : [groqEntry, anthropicEntry];

  return ordered.filter((p) => Boolean(p.key));
}

async function callAnthropic(
  provider: ProviderConfig,
  messages: LlmMessage[],
  maxTokens: number,
  temperature: number,
) {
  const systemMessage = messages.find((message) => message.role === "system")?.content || "";
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      system: systemMessage,
      max_tokens: maxTokens,
      temperature,
      messages: conversation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ANTHROPIC request failed (${response.status}): ${text || response.statusText}`);
  }

  const payload = await response.json();
  const content = Array.isArray(payload?.content)
    ? payload.content.map((entry: { text?: string }) => entry.text || "").join("\n").trim()
    : "";

  return {
    content,
    totalTokens: Number(payload?.usage?.input_tokens || 0) + Number(payload?.usage?.output_tokens || 0),
  };
}

async function callOpenAiCompatible(
  provider: ProviderConfig,
  messages: LlmMessage[],
  maxTokens: number,
  temperature: number,
  jsonMode: boolean,
) {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode && provider.provider === "groq" ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${provider.provider.toUpperCase()} request failed (${response.status}): ${text || response.statusText}`);
  }

  const payload = await response.json();
  return {
    content: String(payload?.choices?.[0]?.message?.content || "").trim(),
    totalTokens: Number(payload?.usage?.total_tokens || 0),
  };
}

export async function callLlm(options: {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  preferredProvider?: string | null;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}) {
  const providers = resolveProviders(options.preferredProvider);
  if (!providers.length) {
    throw createHttpError("No supported AI provider secrets are configured.", 500);
  }

  const allMessages: LlmMessage[] = [
    { role: "system", content: options.systemPrompt },
    ...options.messages,
  ];

  const maxTokens = Number(options.maxTokens || 1200);
  const temperature = Number(options.temperature ?? 0.4);
  const jsonMode = Boolean(options.jsonMode);
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const result = provider.provider === "anthropic"
        ? await callAnthropic(provider, allMessages, maxTokens, temperature)
        : await callOpenAiCompatible(provider, allMessages, maxTokens, temperature, jsonMode);

      return {
        content: result.content,
        model: provider.model,
        provider: provider.provider,
        totalTokens: result.totalTokens || estimateTokens(result.content),
      } as LlmResult;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || createHttpError("AI provider request failed.", 500);
}

// ── Specialist: Claude Haiku vision judge (2.1 visual quality gate) ──────────
/**
 * callVisionJudge — sends an IMAGE to Claude Haiku (vision-capable, cheap) with
 * a strict-JSON rubric and returns the raw JSON string. Used by the
 * quality-gate edge function to score a freshly-generated image. Anthropic is
 * required here (Groq's OpenAI-compatible path in callLlm is text-only in this
 * codebase); if ANTHROPIC_API_KEY is absent the caller should treat the gate
 * as "unavailable" and skip scoring rather than fail the generation.
 */
export async function callVisionJudge(opts: {
  systemPrompt: string;
  userPrompt: string;
  imageBase64: string;
  imageMediaType: string; // e.g. "image/jpeg" | "image/png"
  maxTokens?: number;
}): Promise<string> {
  const anthropicKey = readEnv("ANTHROPIC_API_KEY", false);
  if (!anthropicKey) {
    throw createHttpError("Vision quality gate requires ANTHROPIC_API_KEY.", 501);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      system: opts.systemPrompt,
      max_tokens: opts.maxTokens ?? 400,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: opts.imageMediaType, data: opts.imageBase64 },
          },
          { type: "text", text: opts.userPrompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Vision judge failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data?.content)
    ? data.content.map((c: { text?: string }) => c.text || "").join("").trim()
    : "";
}

// ── Specialist: Claude Haiku for prompt engineering ──────────────────────────
/**
 * callPromptEngine — always uses Claude Haiku.
 * Used for: rewriting user prompts with brand DNA, brainstorming, short creative tasks.
 * Haiku is cheap ($0.80/1M), fast, and excellent at following strict formatting rules.
 */
export async function callPromptEngine(opts: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<string> {
  const anthropicKey = readEnv("ANTHROPIC_API_KEY", false);
  if (!anthropicKey) {
    // Graceful fallback: route through standard callLlm with groq
    const result = await callLlm({
      systemPrompt: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userPrompt }],
      preferredProvider: "groq",
      maxTokens: opts.maxTokens ?? 400,
      temperature: 0.6,
    });
    return result.content;
  }

  // Force claude-haiku-4-5 — never route this to Sonnet/Opus (cost control)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      system: opts.systemPrompt,
      max_tokens: opts.maxTokens ?? 400,
      temperature: 0.6,
      messages: [{ role: "user", content: opts.userPrompt }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Claude Haiku prompt engine failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = Array.isArray(data?.content)
    ? data.content.map((c: { text?: string }) => c.text || "").join("").trim()
    : "";
  return content;
}
