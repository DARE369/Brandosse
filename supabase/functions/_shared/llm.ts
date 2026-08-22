import { readEnv } from "./env.ts";
import { createHttpError } from "./org.ts";
import { reportToSentry } from "./sentry.ts";

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

// Groq's response_format: json_object (callOpenAiCompatible above) enforces
// raw JSON server-side, but there is no equivalent constraint for Anthropic
// — callAnthropic has no strict-JSON option, so Claude is free to wrap JSON
// replies in a ```json ... ``` markdown fence even when explicitly asked for
// raw JSON. Every jsonMode:true caller expects clean JSON in `content`, so
// strip a wrapping fence here once, centrally, rather than in every caller.
export function stripJsonFence(content: string) {
  const match = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(content.trim());
  return match ? match[1].trim() : content;
}

/**
 * LOCK L4.7 — the default Anthropic model.
 *
 * This was `claude-3-5-sonnet-latest`, a 2024-generation model, and
 * ANTHROPIC_MODEL was unset in every environment inspected. Because Groq has
 * been failing 100% of content-plan calls since ~2026-08-18 with Claude
 * silently absorbing all of it, that stale default was generating EVERY piece
 * of content the product produced. The output-quality ceiling of the whole
 * product was set by a default nobody had revisited.
 *
 * Claude Sonnet 5 is the right default here: same list price as Claude 3.5
 * Sonnet ($3/$15 per MTok) for a materially stronger model, so this is a
 * quality upgrade at no additional cost per token.
 *
 * Two rules, per engineering/01-versioning.md:
 *   - Never rely on a code default for production output quality. Set
 *     ANTHROPIC_MODEL explicitly per environment; this constant is the
 *     backstop, not the plan.
 *   - Never use a `-latest` alias in production. An alias silently changes the
 *     model under you, which makes output regressions untraceable — pin it.
 *
 * Per-task selection: callers that want a cheaper model for high-volume,
 * low-stakes work (scoring, classification) should pass `model` explicitly
 * rather than changing this default. Raising quality for everything by
 * changing one constant is exactly how the previous default went unexamined.
 */
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

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
    model: readEnv("ANTHROPIC_MODEL", false) || DEFAULT_ANTHROPIC_MODEL,
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
    // LOCK L5.9 — LLM call; bounded so a hung provider fails cleanly.
    signal: AbortSignal.timeout(60_000),
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
    // LOCK L5.9 — LLM call; bounded so a hung provider fails cleanly.
    signal: AbortSignal.timeout(60_000),
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

      const content = jsonMode ? stripJsonFence(result.content) : result.content;

      return {
        content,
        model: provider.model,
        provider: provider.provider,
        totalTokens: result.totalTokens || estimateTokens(result.content),
      } as LlmResult;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // LOCK L4.7 — a fallback is an ALERTING event, not a silent success.
      //
      // Groq failed 100% of content-plan calls for days while Claude quietly
      // absorbed every one. Nothing broke from the user's side, so nothing
      // surfaced — and the cost architecture inverted (roughly 5x input and
      // 19x output vs the intended provider) with no signal at all.
      //
      // This log is deliberately at error level and deliberately structured:
      // it is the tripwire that should have caught that outage on day one.
      // Wire an alert to `llm_provider_fallback` when error tracking lands
      // (LOCK E1).
      const fallbackDetail = {
        event: "llm_provider_fallback",
        failed_provider: provider.provider,
        failed_model: provider.model,
        reason: lastError.message.slice(0, 200),
        remaining_providers: providers.length - providers.indexOf(provider) - 1,
      };
      console.error("[llm] llm_provider_fallback", JSON.stringify(fallbackDetail));

      // LOCK L0.4 — the console alone is what let the Groq outage run for days.
      // Nobody reads edge-function logs unprompted; an alert has to arrive.
      // Fire-and-forget: reporting must not add latency to the user's request,
      // and the fallback below is about to serve them anyway.
      void reportToSentry(lastError, {
        event: "llm_provider_fallback",
        level: "error",
        extra: fallbackDetail,
      });
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

// ── Specialist: Claude PDF document reader ───────────────────────────────────
/**
 * callAnthropicWithDocument — sends a PDF directly to Claude as a `document`
 * content block instead of pre-extracting text ourselves. Claude's own PDF
 * understanding (layout + text) is far more reliable than a regex scrape of
 * raw PDF bytes, which only ever finds text sitting in uncompressed
 * text-show operators — most real PDFs use FlateDecode-compressed content
 * streams that a byte scrape can't see at all, silently starving the
 * extraction prompt of any real source text (extractBrandKit 2026-08-19
 * incident — documents "extracted" almost nothing).
 * Anthropic-only (same constraint as callVisionJudge — Groq's
 * OpenAI-compatible path in this codebase is text-only, no document input).
 */
export async function callAnthropicWithDocument(opts: {
  systemPrompt: string;
  userPrompt: string;
  documentBase64: string;
  documentMediaType: string; // e.g. "application/pdf"
  maxTokens?: number;
  temperature?: number;
}): Promise<LlmResult> {
  const anthropicKey = readEnv("ANTHROPIC_API_KEY", false);
  if (!anthropicKey) {
    throw createHttpError("Document extraction requires ANTHROPIC_API_KEY.", 501);
  }

  const model = readEnv("ANTHROPIC_MODEL", false) || DEFAULT_ANTHROPIC_MODEL;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      // PDF/document content blocks were gated behind this beta flag when
      // the feature launched; harmless to send even once a given account/
      // model no longer requires it, and cheap insurance against a silent
      // "unsupported content type" rejection from Anthropic otherwise.
      "anthropic-beta": "pdfs-2024-09-25",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: opts.systemPrompt,
      max_tokens: opts.maxTokens ?? 1600,
      temperature: opts.temperature ?? 0.1,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: opts.documentMediaType, data: opts.documentBase64 },
          },
          { type: "text", text: opts.userPrompt },
        ],
      }],
    }),
    // Generous timeout: reading + reasoning over a real PDF plus a fuller
    // (4096-token) structured JSON response takes noticeably longer than a
    // short text prompt — the previous 45s cap fired mid-generation once
    // maxTokens was raised (extractBrandKit 2026-08-19 incident).
    signal: AbortSignal.timeout(100_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`ANTHROPIC document request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const content = Array.isArray(payload?.content)
    ? payload.content.map((entry: { text?: string }) => entry.text || "").join("\n").trim()
    : "";

  return {
    content: stripJsonFence(content),
    model,
    provider: "anthropic",
    totalTokens: Number(payload?.usage?.input_tokens || 0) + Number(payload?.usage?.output_tokens || 0),
  };
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
