import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { readEnv } from "../_shared/env.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import {
  handleCors,
  jsonResponse,
  mapErrorToStatusCode,
  parseJsonBody,
  toErrorPayload,
} from "../_shared/http.ts";

type SessionTitleRequest = {
  prompt?: string;
  max_words?: number;
};

function fallbackTitleFromPrompt(prompt: string, maxWords: number) {
  const words = String(prompt || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Untitled session";
  return words.slice(0, maxWords).join(" ");
}

function normalizeTitle(value: string, prompt: string, maxWords: number) {
  const normalized = String(value || "")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return fallbackTitleFromPrompt(prompt, maxWords);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return fallbackTitleFromPrompt(prompt, maxWords);
  return words.slice(0, maxWords).join(" ");
}

async function requestGroqTitle(prompt: string, maxWords: number) {
  const groqKey = readEnv("GROQ_API_KEY", false);
  if (!groqKey) {
    return {
      title: fallbackTitleFromPrompt(prompt, maxWords),
      provider: "fallback",
      model: "local-fallback",
    };
  }

  try {
    const result = await callLlm({
      preferredProvider: "groq",
      systemPrompt: `You write concise session titles.
Rules:
- Return exactly one title only (no quotes, no labels)
- Max ${maxWords} words
- Keep wording clear and specific
- No punctuation at the end`,
      messages: [
        {
          role: "user",
          content: `Prompt:\n${prompt}`,
        },
      ],
      maxTokens: 80,
      temperature: 0.2,
    });

    return {
      title: normalizeTitle(result.content, prompt, maxWords),
      provider: result.provider,
      model: result.model,
    };
  } catch (error) {
    console.warn("[generate-session-title] Groq title generation failed, using fallback.", error);
    return {
      title: fallbackTitleFromPrompt(prompt, maxWords),
      provider: "fallback",
      model: "local-fallback",
    };
  }
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    await requireUser(authClient);

    const body = await parseJsonBody<SessionTitleRequest>(req);
    const prompt = String(body?.prompt || "").trim();
    const maxWords = Math.max(3, Math.min(8, Number(body?.max_words || 6)));

    if (!prompt) {
      return jsonResponse({ error: "prompt is required" }, 400);
    }

    const result = await requestGroqTitle(prompt, maxWords);
    return jsonResponse({
      title: result.title,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    console.error("[generate-session-title] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
