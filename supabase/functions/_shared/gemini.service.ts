/**
 * gemini.service.ts — Gemini 2.5 Flash client for Supabase Edge Functions.
 *
 * Used for:
 *   1. Generation scoring  — compare output vs. original brief (0-100%)
 *   2. Brand DNA analysis  — read brand kit files/images and extract color, tone, style
 *   3. SEO + platform opt  — post-generation optimisation and platform-specific analysis
 *   4. Video understanding — the only major AI that can directly read and score video files
 *
 * Provider: Google Gemini API
 * Auth:     GEMINI_API_KEY (already set in Supabase secrets)
 * Model:    gemini-2.5-flash  ($0.30/1M input tokens, $2.50/1M output tokens)
 * Context:  1M token window — can hold an entire brand kit + generation + history
 */

import { readEnv } from "./env.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string }; // base64 image/video
  file_data?: { mime_type: string; file_uri: string }; // uploaded file URI
}

export interface GeminiMessage {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
}

export interface GenerationScoreResult {
  score: number;          // 0–100
  grade: "Poor" | "Fair" | "Good" | "Great" | "Perfect";
  brief_match: number;    // 0–100 — how well output matches the original brief
  brand_alignment: number; // 0–100 — brand color/tone/style consistency
  platform_fit: number;   // 0–100 — platform-specific quality
  strengths: string[];
  improvements: string[];
  seo_keywords: string[];
  summary: string;
}

export interface BrandDNAResult {
  colors: string[];          // extracted hex codes
  tone: string[];            // tone descriptors
  visual_style: string[];    // visual style keywords
  typography_feel: string;   // typographic direction
  mood: string;              // overall mood/feeling
  dos: string[];             // visual/copy DOs
  donts: string[];           // visual/copy DON'Ts
  confidence: number;        // 0–100 extraction confidence
}

export interface SeoOptimizationResult {
  optimized_caption: string;
  optimized_hashtags: string[];
  seo_title: string;
  platform_notes: Record<string, string>; // { instagram: "...", tiktok: "..." }
  score_before: number;
  score_after: number;
  keywords_added: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_ID = "gemini-2.5-flash";
const BASE_URL  = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;

// ── Internal helpers ──────────────────────────────────────────────────────────

function getGeminiKey(): string {
  const key = readEnv("GEMINI_API_KEY", false);
  if (!key) throw new Error("GEMINI_API_KEY is not configured in Supabase secrets.");
  return key;
}

async function callGemini(
  messages: GeminiMessage[],
  systemInstruction: string,
  config: GeminiConfig = {},
): Promise<string> {
  const apiKey = getGeminiKey();

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: messages,
    generation_config: {
      temperature:        config.temperature      ?? 0.2,
      max_output_tokens:  config.maxOutputTokens  ?? 2048,
      response_mime_type: config.responseMimeType ?? "application/json",
    },
  };

  const res = await fetch(`${BASE_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini 2.5 Flash failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ── 1. Generation Scoring ─────────────────────────────────────────────────────

/**
 * Scores a generated image/video against the original brief and brand kit.
 * Gemini can natively read the image URL — no base64 encoding required.
 */
export async function scoreGeneration(opts: {
  mediaUrl: string;
  mediaType: "image" | "video";
  originalBrief: string;
  platform: string;
  brandContext: string;
  generatedCaption?: string;
}): Promise<GenerationScoreResult> {
  const system = `You are an expert social media content quality analyst.
Score the provided ${opts.mediaType} against the original brief and brand guidelines.
Return ONLY valid JSON. Be honest — average content should score 50-70, not 90+.
JSON shape:
{
  "score": <0-100>,
  "grade": "<Poor|Fair|Good|Great|Perfect>",
  "brief_match": <0-100>,
  "brand_alignment": <0-100>,
  "platform_fit": <0-100>,
  "strengths": ["<string>"],
  "improvements": ["<string>"],
  "seo_keywords": ["<string>"],
  "summary": "<2 sentence overall assessment>"
}`;

  const user = `Platform: ${opts.platform}
Original brief: ${opts.originalBrief}
Brand context: ${opts.brandContext}
${opts.generatedCaption ? `Caption: ${opts.generatedCaption}` : ""}

Assess the ${opts.mediaType} at: ${opts.mediaUrl}`;

  const raw = await callGemini(
    [{ role: "user", parts: [{ text: user }] }],
    system,
    { temperature: 0.15, maxOutputTokens: 1024, responseMimeType: "application/json" },
  );

  return safeJsonParse<GenerationScoreResult>(raw, {
    score: 50, grade: "Fair", brief_match: 50, brand_alignment: 50, platform_fit: 50,
    strengths: [], improvements: ["Could not analyze — try again"], seo_keywords: [], summary: "",
  });
}

// ── 2. Brand DNA Extraction ───────────────────────────────────────────────────

/**
 * Extracts brand DNA from a brand kit document or image asset.
 * Gemini reads the actual file content — more accurate than text-only extraction.
 */
export async function extractBrandDNA(opts: {
  fileUrl?: string;          // URL to an image/PDF brand kit asset
  textContent?: string;      // raw text brand kit content
  existingBrandContext?: string;
}): Promise<BrandDNAResult> {
  const system = `You are an expert brand analyst.
Extract structured brand DNA from the provided brand asset.
Return ONLY valid JSON:
{
  "colors": ["#hex1", "#hex2"],
  "tone": ["<descriptor>"],
  "visual_style": ["<keyword>"],
  "typography_feel": "<string>",
  "mood": "<string>",
  "dos": ["<string>"],
  "donts": ["<string>"],
  "confidence": <0-100>
}`;

  const parts: GeminiPart[] = [];
  if (opts.textContent) parts.push({ text: `Brand kit content:\n${opts.textContent}` });
  if (opts.existingBrandContext) parts.push({ text: `Existing context:\n${opts.existingBrandContext}` });
  if (opts.fileUrl) parts.push({ text: `Analyze the brand asset at: ${opts.fileUrl}` });

  const raw = await callGemini(
    [{ role: "user", parts }],
    system,
    { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: "application/json" },
  );

  return safeJsonParse<BrandDNAResult>(raw, {
    colors: [], tone: [], visual_style: [], typography_feel: "", mood: "",
    dos: [], donts: [], confidence: 0,
  });
}

// ── 3. SEO + Platform Optimization ───────────────────────────────────────────

/**
 * Optimises caption, hashtags, and metadata for a specific platform.
 * Scores before/after so users can see the improvement.
 */
export async function optimizeForPlatform(opts: {
  caption: string;
  hashtags: string[];
  platform: string;
  brandContext: string;
  targetKeywords?: string[];
  mediaDescription?: string;
}): Promise<SeoOptimizationResult> {
  const system = `You are a social media SEO specialist.
Optimize the caption and hashtags for ${opts.platform}.
Platform rules:
- Instagram: 125-150 words ideal, up to 30 hashtags (niche + broad mix), strong hook first line
- TikTok: short punchy hook, 3-5 hashtags, trending language
- LinkedIn: professional tone, thought leadership angle, 3-5 hashtags, no emojis unless natural
- X: max 280 chars total, 1-2 hashtags embedded naturally, punchy/opinionated hook
Return ONLY valid JSON:
{
  "optimized_caption": "<string>",
  "optimized_hashtags": ["<string>"],
  "seo_title": "<string>",
  "platform_notes": { "instagram": "<string>", "tiktok": "<string>" },
  "score_before": <0-100>,
  "score_after": <0-100>,
  "keywords_added": ["<string>"]
}`;

  const user = `Platform: ${opts.platform}
Brand context: ${opts.brandContext}
${opts.targetKeywords?.length ? `Target keywords: ${opts.targetKeywords.join(", ")}` : ""}
${opts.mediaDescription ? `Media description: ${opts.mediaDescription}` : ""}

Current caption:
"""
${opts.caption}
"""

Current hashtags: ${opts.hashtags.join(", ") || "none"}`;

  const raw = await callGemini(
    [{ role: "user", parts: [{ text: user }] }],
    system,
    { temperature: 0.3, maxOutputTokens: 1500, responseMimeType: "application/json" },
  );

  return safeJsonParse<SeoOptimizationResult>(raw, {
    optimized_caption: opts.caption, optimized_hashtags: opts.hashtags,
    seo_title: "", platform_notes: {}, score_before: 50, score_after: 50, keywords_added: [],
  });
}
