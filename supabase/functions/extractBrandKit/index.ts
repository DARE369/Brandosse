import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { corsHeaders, handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

// Source can be a previously-uploaded brand_assets document, or a live
// website URL (mockup's "yourbrand.com" import / "Re-import from site").
// Exactly one of storagePath / websiteUrl must be provided.
type ExtractRequest = {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  websiteUrl?: string;
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
    maxTokens: 1600,
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

    if (!storagePath && !websiteUrl) {
      throw new Error("Missing storagePath or websiteUrl");
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
    const { data: ownedAsset, error: assetError } = await admin
      .from("brand_assets")
      .select("id, user_id, storage_path, file_name, mime_type")
      .eq("user_id", user.id)
      .eq("storage_path", storagePath)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!ownedAsset) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: signedData, error: signedErr } = await admin.storage
      .from("brand_assets")
      .createSignedUrl(storagePath, 120);

    if (signedErr) throw new Error(`Could not access uploaded document: ${signedErr.message}`);
    if (!signedData?.signedUrl) throw new Error("Signed URL was not returned");

    const fileResponse = await fetch(signedData.signedUrl);
    if (!fileResponse.ok) {
      throw new Error(`Could not fetch document bytes (${fileResponse.status})`);
    }
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    const detectedMime = mimeType || ownedAsset.mime_type || fileResponse.headers.get("content-type") || "";
    const detectedName = fileName || ownedAsset.file_name || storagePath;
    const extractedText = decodeDocumentText(fileBytes, detectedMime, detectedName).slice(0, 24000);

    const result = await runExtraction(extractedText, detectedName);
    return jsonResponse({ ...result, sourceType: "document" });
  } catch (error) {
    const status = mapErrorToStatusCode(error);
    return new Response(JSON.stringify(toErrorPayload(error)), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
