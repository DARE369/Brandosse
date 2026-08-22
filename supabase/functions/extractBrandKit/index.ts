import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm, callAnthropicWithDocument } from "../_shared/llm.ts";
import { corsHeaders, handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

// Source can be a previously-uploaded brand_assets document, or a live
// website URL (mockup's "yourbrand.com" import / "Re-import from site").
// Exactly one of storagePath / websiteUrl must be provided.
type ExtractRequest = {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  websiteUrl?: string;
  /**
   * LOCK L5.12 — conversational onboarding source.
   *
   * The 6-question brand-kit conversation used to finish by calling Groq
   * DIRECTLY FROM THE BROWSER, where the token is hardcoded to "" — so it
   * failed 100% of the time, in every environment, for every user who
   * completed all six answers (audit P1-004). The questions worked; only the
   * final extraction step was unreachable.
   *
   * Routed here rather than to a new endpoint because this is the same
   * operation the function already performs — extract a brand kit from source
   * text — just with conversation answers as the source instead of a document
   * or a website. Same extraction prompt, same normalisation, same output
   * shape, so the conversation cannot drift from the document path.
   */
  conversationAnswers?: Array<{ question?: string; answer?: string }> | null;
  /** Anything already extracted from a document/site, to be built upon. */
  prefilled?: Record<string, unknown> | null;
};

// Schema matches the real public.brand_kit columns exactly (see
// docs/brand-kit-rebuild/AS_IS_AUDIT.md §0 — this replaces a prior schema
// that emitted core_values/content_pillars/hashtags/do_list/dont_list,
// none of which exist as columns, and mistyped brand_voice as an array
// when the column is a single text value). Only fields the review form's
// 5 tabs actually render are requested from the LLM.
const EXTRACTION_SYSTEM_PROMPT = `You are a brand intelligence extractor. Read the provided brand source text and extract structured brand kit fields.
Return ONLY valid JSON matching this exact schema:
{
  "brandKit": {
    "brand_name": "",
    "industry": "",
    "tagline": "",
    "target_audience": "",
    "audience_age_range": "",
    "audience_locations": [],
    "brand_voice": "",
    "tone_descriptors": [],
    "writing_style_notes": "",
    "signature_phrases": [],
    "forbidden_phrases": [],
    "emoji_usage": "",
    "call_to_action_style": "",
    "content_restrictions": [],
    "competitor_names": [],
    "legal_disclaimers": "",
    "visual_style_keywords": [],
    "color_palette": [{ "hex": "", "name": "", "usage": "" }],
    "typography_notes": "",
    "photo_style_notes": "",
    "avoid_visual_elements": [],
    "font_display": { "family": "", "style": "" },
    "font_body": { "family": "", "style": "" }
  },
  "confidenceMap": {
    "brand_name": 0.0,
    "tagline": 0.0
  },
  "missingTier1Fields": []
}
Field rules:
- brand_voice must be exactly ONE of: professional, playful, authoritative, conversational, inspirational, edgy. Pick the closest match, never invent a new value.
- emoji_usage must be exactly ONE of: none, minimal, moderate, heavy.
- call_to_action_style must be exactly ONE of: question-based, imperative, soft.
- color_palette entries need real hex codes when visible in the source; omit an entry rather than guessing a hex you cannot support.
- font_display/font_body: only fill in a family/style if the source text names actual typefaces; otherwise return null for that field.
- content_restrictions is CONTENT-level (topics/claims to avoid saying). avoid_visual_elements is VISUAL-level (imagery/photo styles to avoid, e.g. "stock photography", "drop shadows"). Keep these separate.
- Confidence values must be 0.0 to 1.0 numbers.
- Do not include markdown.
- Do not invent details not supported by the source text.`;

const TIER_1_FIELDS = [
  "brand_name",
  "brand_voice",
  "target_audience",
  "forbidden_phrases",
  "content_restrictions",
];

const VALID_BRAND_VOICES = ["professional", "playful", "authoritative", "conversational", "inspirational", "edgy"];
const VALID_EMOJI_USAGE = ["none", "minimal", "moderate", "heavy"];
const VALID_CTA_STYLES = ["question-based", "imperative", "soft"];

function inferBrandName(fileName = ""): string {
  const clean = fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/^\d+_/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!clean) return "Brand";
  return clean.slice(0, 60);
}

function toArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  return [];
}

function toEnum(value: unknown, allowed: string[]) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : "";
}

function toColorPalette(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const hex = String((entry as Record<string, unknown>).hex || "").trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
      return {
        hex,
        name: String((entry as Record<string, unknown>).name || "").trim(),
        usage: String((entry as Record<string, unknown>).usage || "").trim(),
      };
    })
    .filter(Boolean);
}

function toFontPair(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const family = String((value as Record<string, unknown>).family || "").trim();
  if (!family) return null;
  return {
    family,
    style: String((value as Record<string, unknown>).style || "").trim(),
  };
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function pickJsonString(raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "{}";
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function extractPrintableText(value: string) {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPdfLikeText(binaryText: string) {
  const textFromParens = [...binaryText.matchAll(/\(([^()]{2,2000})\)/g)]
    .map((match) => extractPrintableText(match[1]))
    .filter(Boolean);

  if (textFromParens.length > 0) {
    return textFromParens.join("\n");
  }

  return extractPrintableText(binaryText);
}

function decodeDocumentText(bytes: Uint8Array, mimeType = "", fileName = "") {
  const lowerMime = String(mimeType || "").toLowerCase();
  const lowerName = String(fileName || "").toLowerCase();
  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  const isTextLike = lowerMime.includes("text/")
    || lowerMime.includes("json")
    || lowerName.endsWith(".txt")
    || lowerName.endsWith(".md")
    || lowerName.endsWith(".json")
    || lowerName.endsWith(".csv");

  if (isTextLike) {
    return extractPrintableText(utf8Text);
  }

  const latinText = new TextDecoder("latin1", { fatal: false }).decode(bytes);
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return extractPdfLikeText(latinText);
  }

  // DOCX/DOC/RTF fallback: pull printable strings from binary payload.
  return extractPrintableText(latinText);
}

// Strip a fetched HTML page down to visible-ish text: drop script/style
// blocks, decode the most common entities, collapse tags to whitespace.
// Not a full HTML parser — good enough to feed an LLM extraction prompt,
// same "best-effort text soup" standard the PDF path already uses.
function extractTextFromHtml(html: string) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const titleMatch = withoutNoise.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = withoutNoise.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);

  const bodyText = withoutNoise
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  const parts = [
    titleMatch ? `Page title: ${extractPrintableText(titleMatch[1])}` : "",
    descMatch ? `Meta description: ${extractPrintableText(descMatch[1])}` : "",
    extractPrintableText(bodyText),
  ].filter(Boolean);

  return parts.join("\n");
}

function buildFallbackResult(brandNameHint: string) {
  const brand_name = inferBrandName(brandNameHint);
  const brandKit = {
    brand_name,
    industry: "",
    tagline: "",
    target_audience: "",
    audience_age_range: "",
    audience_locations: [],
    brand_voice: "",
    tone_descriptors: [],
    writing_style_notes: "",
    signature_phrases: [],
    forbidden_phrases: [],
    emoji_usage: "",
    call_to_action_style: "",
    content_restrictions: [],
    competitor_names: [],
    legal_disclaimers: "",
    visual_style_keywords: [],
    color_palette: [],
    typography_notes: "",
    photo_style_notes: "",
    avoid_visual_elements: [],
    font_display: null,
    font_body: null,
  };

  const confidenceMap = {
    brand_name: 0.2,
  } as Record<string, number>;

  const missingTier1Fields = TIER_1_FIELDS.filter((field) => {
    const value = (brandKit as Record<string, unknown>)[field];
    if (Array.isArray(value)) return value.length === 0;
    return !String(value ?? "").trim();
  });

  return { brandKit, confidenceMap, missingTier1Fields };
}

function normalizeExtraction(parsed: any, brandNameHint: string) {
  const fallback = buildFallbackResult(brandNameHint);
  const sourceKit = parsed?.brandKit && typeof parsed.brandKit === "object" ? parsed.brandKit : {};

  const brandKit = {
    brand_name: String(sourceKit.brand_name || fallback.brandKit.brand_name || "").trim(),
    industry: String(sourceKit.industry || "").trim(),
    tagline: String(sourceKit.tagline || "").trim(),
    target_audience: String(sourceKit.target_audience || "").trim(),
    audience_age_range: String(sourceKit.audience_age_range || "").trim(),
    audience_locations: toArray(sourceKit.audience_locations),
    brand_voice: toEnum(sourceKit.brand_voice, VALID_BRAND_VOICES),
    tone_descriptors: toArray(sourceKit.tone_descriptors),
    writing_style_notes: String(sourceKit.writing_style_notes || "").trim(),
    signature_phrases: toArray(sourceKit.signature_phrases),
    forbidden_phrases: toArray(sourceKit.forbidden_phrases),
    emoji_usage: toEnum(sourceKit.emoji_usage, VALID_EMOJI_USAGE),
    call_to_action_style: toEnum(sourceKit.call_to_action_style, VALID_CTA_STYLES),
    content_restrictions: toArray(sourceKit.content_restrictions),
    competitor_names: toArray(sourceKit.competitor_names),
    legal_disclaimers: String(sourceKit.legal_disclaimers || "").trim(),
    visual_style_keywords: toArray(sourceKit.visual_style_keywords),
    color_palette: toColorPalette(sourceKit.color_palette),
    typography_notes: String(sourceKit.typography_notes || "").trim(),
    photo_style_notes: String(sourceKit.photo_style_notes || "").trim(),
    avoid_visual_elements: toArray(sourceKit.avoid_visual_elements),
    font_display: toFontPair(sourceKit.font_display),
    font_body: toFontPair(sourceKit.font_body),
  };

  const sourceConfidence = parsed?.confidenceMap && typeof parsed.confidenceMap === "object"
    ? parsed.confidenceMap
    : {};
  const confidenceMap = Object.keys(sourceConfidence).reduce((acc, key) => {
    acc[key] = clampConfidence(sourceConfidence[key]);
    return acc;
  }, {} as Record<string, number>);

  if (!confidenceMap.brand_name && brandKit.brand_name) {
    confidenceMap.brand_name = 0.3;
  }

  const missingTier1Fields = Array.isArray(parsed?.missingTier1Fields)
    ? parsed.missingTier1Fields.map((field: unknown) => String(field || "").trim()).filter(Boolean)
    : TIER_1_FIELDS.filter((field) => {
      const value = (brandKit as Record<string, unknown>)[field];
      if (Array.isArray(value)) return value.length === 0;
      return !String(value ?? "").trim();
    });

  return { brandKit, confidenceMap, missingTier1Fields };
}

async function runExtraction(sourceText: string, brandNameHint: string) {
  if (!sourceText) {
    return { ...buildFallbackResult(brandNameHint), extractionPromptVersion: "extractBrandKit.v3" };
  }

  const llmResponse = await callLlm({
    preferredProvider: "anthropic",
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 4096,
    messages: [
      {
        role: "user",
        content: `Brand source text:\n${sourceText}\n\nReturn final JSON now.`,
      },
    ],
  });

  const parsed = JSON.parse(pickJsonString(llmResponse.content));
  const normalized = normalizeExtraction(parsed, brandNameHint);

  return {
    ...normalized,
    extractionPromptVersion: "extractBrandKit.v3",
    provider: llmResponse.provider,
    model: llmResponse.model,
  };
}

// Chunked byte->base64 encode (Deno's global `btoa` needs a binary string;
// spreading a large Uint8Array directly into String.fromCharCode can blow
// the call-stack argument limit on multi-MB PDFs, so this feeds it in
// bounded chunks instead).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// PDF documents go straight to Claude as a native `document` content block
// instead of through the regex byte-scrape `decodeDocumentText` uses for
// other formats — see callAnthropicWithDocument's doc comment for why.
async function runExtractionFromPdf(fileBytes: Uint8Array, brandNameHint: string) {
  const llmResponse = await callAnthropicWithDocument({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: "Read the attached brand document and return the final JSON now.",
    documentBase64: bytesToBase64(fileBytes),
    documentMediaType: "application/pdf",
    maxTokens: 4096,
    temperature: 0.1,
  });

  const parsed = JSON.parse(pickJsonString(llmResponse.content));
  const normalized = normalizeExtraction(parsed, brandNameHint);

  return {
    ...normalized,
    extractionPromptVersion: "extractBrandKit.v3-pdf-native",
    provider: llmResponse.provider,
    model: llmResponse.model,
  };
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const authClient = createAuthClient(authHeader);
    const user = await requireUser(authClient);
    const admin = createAdminClient();

    const body = await parseJsonBody<ExtractRequest>(req);
    const storagePath = String(body.storagePath || "").trim();
    const fileName = String(body.fileName || "").trim();
    const mimeType = String(body.mimeType || "").trim();
    const websiteUrl = String(body.websiteUrl || "").trim();

    const conversationAnswers = Array.isArray(body.conversationAnswers) ? body.conversationAnswers : [];

    if (!storagePath && !websiteUrl && conversationAnswers.length === 0) {
      throw new Error("Missing storagePath, websiteUrl, or conversationAnswers");
    }

    // ── LOCK L5.12 — conversational onboarding ────────────────────────────
    //
    // Flatten the Q&A into the same "brand source text" the document and
    // website paths produce, then hand it to the SAME extractor. Reusing
    // runExtraction is the point: the conversation cannot drift away from the
    // document path, because there is only one extractor and one schema.
    if (conversationAnswers.length > 0) {
      const transcript = conversationAnswers
        .map((entry, index) => {
          const q = String(entry?.question || `Question ${index + 1}`).trim();
          const a = String(entry?.answer || "").trim();
          return a ? `Q: ${q}\nA: ${a}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

      if (!transcript) {
        throw new Error("conversationAnswers contained no answers");
      }

      const prefilled = body.prefilled && typeof body.prefilled === "object" ? body.prefilled : null;
      // The extraction prompt was written for document and website prose, where
      // brand facts appear as statements. An interview transcript is a
      // different shape: the signal is in short, direct answers, and the first
      // live test showed it silently dropping content_pillars and dont_list
      // even when the answers plainly contained them ("never call it
      // artisanal", "brewing process, Lagos food culture, customer stories").
      //
      // These instructions tell the extractor how to read Q&A. Without them the
      // conversation completes and quietly loses fields the user explicitly
      // provided — worse than failing, because the user believes they were heard.
      const sourceText = [
        "The following is a brand-discovery INTERVIEW with the brand owner.",
        "Their answers are first-hand and authoritative: prefer them over inference, and do not soften or generalise them.",
        "",
        // These map the six interview questions onto the ACTUAL brand_kit
        // columns. Naming real fields matters: an earlier draft of this block
        // referenced dont_list and content_pillars, which this schema does not
        // have, so the model had nowhere to put those answers and silently
        // dropped them.
        "How to read it:",
        "- Phrases the owner says they use often -> signature_phrases.",
        "- Phrases they say to avoid -> forbidden_phrases.",
        "- Topics, claims, or subjects they say never to post about -> content_restrictions.",
        "- Named competitors they mention -> competitor_names.",
        "- Words describing how the brand should sound -> tone_descriptors, with the fuller description in brand_voice.",
        "- Who buys from them -> target_audience, plus audience_age_range and audience_locations when stated.",
        "- Colours, photography style, and things to avoid visually -> visual_style_keywords, color_palette, photo_style_notes, avoid_visual_elements.",
        "- Extract these even when the answer is one informal sentence: an interview answer is a statement of fact about the brand, not a passing mention.",
        "",
        transcript,
        prefilled ? `Previously extracted context (build on this, do not discard it):\n${JSON.stringify(prefilled)}` : "",
      ].filter(Boolean).join("\n");

      const brandNameHint = String(
        (prefilled as Record<string, unknown> | null)?.brand_name || "",
      ).trim();

      const result = await runExtraction(sourceText, brandNameHint);
      return jsonResponse({ ...result, source: "conversation" });
    }

    // -- Website-URL source (mockup's "yourbrand.com" import / "Re-import
    // from site") — fetch the live page, no stored document involved. --
    if (websiteUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`);
      } catch {
        throw new Error("Invalid website URL");
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Website URL must be http or https");
      }

      const pageResponse = await fetch(parsedUrl.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandKitBot/1.0)" },
        redirect: "follow",
        // LOCK L5.9 — brand kit extraction; bounded so a hung provider fails cleanly.
        signal: AbortSignal.timeout(60_000),
      });
      if (!pageResponse.ok) {
        throw new Error(`Could not fetch ${parsedUrl.hostname} (${pageResponse.status})`);
      }
      const html = await pageResponse.text();
      const sourceText = extractTextFromHtml(html).slice(0, 24000);

      const result = await runExtraction(sourceText, parsedUrl.hostname);
      return jsonResponse({ ...result, sourceType: "url", sourceUrl: parsedUrl.toString() });
    }

    // -- Stored-document source (existing upload flow) --
    // The client uploads this document straight to the `brand_assets`
    // storage bucket (src/components/BrandKit/BrandKitExtractLoader.jsx) as
    // a transient extraction source, not a row in the `brand_assets` DB
    // table — so ownership is verified from the path itself (client always
    // writes `${user.id}/brand_docs/...`), not a table lookup. A table
    // lookup here always returned zero rows and 403'd every document
    // extraction (see docs/brand-kit-rebuild — 2026-08-19 incident).
    if (!storagePath.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: signedData, error: signedErr } = await admin.storage
      .from("brand_assets")
      .createSignedUrl(storagePath, 120);

    if (signedErr) throw new Error(`Could not access uploaded document: ${signedErr.message}`);
    if (!signedData?.signedUrl) throw new Error("Signed URL was not returned");

    const fileResponse = await fetch(signedData.signedUrl, {
      // LOCK L5.9 — download document bytes; bounded so a hung transfer fails cleanly.
      signal: AbortSignal.timeout(60_000),
    });
    if (!fileResponse.ok) {
      throw new Error(`Could not fetch document bytes (${fileResponse.status})`);
    }
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    const detectedMime = mimeType || fileResponse.headers.get("content-type") || "";
    const detectedName = fileName || storagePath;
    const isPdf = detectedMime.toLowerCase().includes("pdf") || detectedName.toLowerCase().endsWith(".pdf");

    const result = isPdf
      ? await runExtractionFromPdf(fileBytes, detectedName)
      : await runExtraction(decodeDocumentText(fileBytes, detectedMime, detectedName).slice(0, 24000), detectedName);

    return jsonResponse({ ...result, sourceType: "document" });
  } catch (error) {
    const status = mapErrorToStatusCode(error);
    console.error("extractBrandKit failed:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify(toErrorPayload(error)), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
