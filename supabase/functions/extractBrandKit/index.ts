import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { corsHeaders, handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

type ExtractRequest = {
  storagePath: string;
  fileName?: string;
  mimeType?: string;
};

const EXTRACTION_SYSTEM_PROMPT = `You are a brand intelligence extractor. Read the provided brand document text and extract structured brand kit fields.
Return ONLY valid JSON matching this exact schema:
{
  "brandKit": {
    "brand_name": "",
    "tagline": "",
    "brand_voice": [],
    "tone_descriptors": [],
    "target_audience": "",
    "core_values": [],
    "content_pillars": [],
    "hashtags": [],
    "color_palette": [],
    "do_list": [],
    "dont_list": []
  },
  "confidenceMap": {
    "brand_name": 0.0,
    "tagline": 0.0
  },
  "missingTier1Fields": []
}
Rules:
- Confidence values must be 0.0 to 1.0 numbers.
- Do not include markdown.
- Do not invent details not supported by the text.`;

const TIER_1_FIELDS = [
  "brand_name",
  "target_audience",
  "brand_voice",
  "tone_descriptors",
  "content_pillars",
  "dont_list",
];

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

function buildFallbackResult(fileName: string) {
  const brand_name = inferBrandName(fileName);
  const brandKit = {
    brand_name,
    tagline: "",
    brand_voice: [],
    tone_descriptors: [],
    target_audience: "",
    core_values: [],
    content_pillars: [],
    hashtags: [],
    color_palette: [],
    do_list: [],
    dont_list: [],
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

function normalizeExtraction(parsed: any, fileName: string) {
  const fallback = buildFallbackResult(fileName);
  const sourceKit = parsed?.brandKit && typeof parsed.brandKit === "object" ? parsed.brandKit : {};

  const brandKit = {
    brand_name: String(sourceKit.brand_name || fallback.brandKit.brand_name || "").trim(),
    tagline: String(sourceKit.tagline || "").trim(),
    brand_voice: toArray(sourceKit.brand_voice),
    tone_descriptors: toArray(sourceKit.tone_descriptors),
    target_audience: String(sourceKit.target_audience || "").trim(),
    core_values: toArray(sourceKit.core_values),
    content_pillars: toArray(sourceKit.content_pillars),
    hashtags: toArray(sourceKit.hashtags).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
    color_palette: toArray(sourceKit.color_palette),
    do_list: toArray(sourceKit.do_list),
    dont_list: toArray(sourceKit.dont_list),
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
    if (!storagePath) throw new Error("Missing storagePath");

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

    if (!extractedText) {
      const fallback = buildFallbackResult(detectedName);
      return jsonResponse({
        ...fallback,
        extractionPromptVersion: "extractBrandKit.v2",
      });
    }

    const llmResponse = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1400,
      messages: [
        {
          role: "user",
          content: `Brand document text:\n${extractedText}\n\nReturn final JSON now.`,
        },
      ],
    });

    const parsed = JSON.parse(pickJsonString(llmResponse.content));
    const normalized = normalizeExtraction(parsed, detectedName);

    return jsonResponse({
      ...normalized,
      extractionPromptVersion: "extractBrandKit.v2",
      provider: llmResponse.provider,
      model: llmResponse.model,
    });
  } catch (error) {
    const status = mapErrorToStatusCode(error);
    return new Response(JSON.stringify(toErrorPayload(error)), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

