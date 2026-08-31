/**
 * _shared/brandKit.ts — server-side brand kit loading and prompt context.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Two defects, both found 2026-08-31, both fixed by this module.
 *
 * 1. THE TRUST BOUNDARY. `generateVideo` and `generateImage` both accepted the
 *    brand kit from the REQUEST BODY (`src/services/media.service.js:363` sends
 *    it) and used it without ever loading it by `user_id`. The kit was
 *    therefore arbitrary attacker-chosen text in a body the caller fully
 *    controls, not the kit belonging to the authenticated user.
 *
 *    Impact was bounded only because the fields were used for prompt text. It
 *    stops being bounded the moment any kit value influences model routing or
 *    credit tier — that is client-controlled spend.
 *
 *    The rule, non-negotiable: **free text may reach a prompt; it must never
 *    reach a router.** Anything influencing routing is a server-validated enum.
 *
 * 2. THE DISCARDED FIELDS. `generateVideo.buildBrandContext()` read 2 of 17
 *    fields — brand_name and visual_style_keywords. `src/services/
 *    brandKitLoader.js:41-67` had been assembling a full summary on the client
 *    for the image path the whole time, and the video path threw it away.
 *    `buildBrandSummary` below is that summary, moved server-side where it
 *    cannot be tampered with and where both callers can reach it.
 */

import type { DatabaseClient } from "./supabase.ts";

export type BrandKitRow = Record<string, unknown>;

/**
 * The authenticated user's active brand kit, or null.
 *
 * Loaded by `user_id` with the service-role client. NEVER accept a kit from a
 * request body — that is the defect this function replaces.
 *
 * Returns null rather than throwing: generation without brand context is a
 * degraded result, not a failure, and a user with no kit is the normal case
 * on a new account.
 */
export async function loadBrandKit(
  adminClient: DatabaseClient,
  userId: string,
): Promise<BrandKitRow | null> {
  if (!userId) return null;
  const { data, error } = await adminClient
    .from("brand_kit")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as BrandKitRow;
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Format the palette with its usage rules.
 *
 * Colours were captured in full — hex, name, and a per-entry usage rule — and
 * then dropped on the floor by every consumer, so "on brand" only ever meant
 * style adjectives and never the actual palette. The usage rule is included
 * because "#0B1F3A for backgrounds" and "#0B1F3A for text" are different
 * instructions, and a bare hex list loses that distinction entirely.
 */
function formatPalette(palette: unknown): string {
  if (!Array.isArray(palette) || palette.length === 0) return "";
  const parts: string[] = [];
  for (const entry of palette) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const hex = asText(e.hex);
    if (!hex) continue;
    const name = asText(e.name);
    const usage = asText(e.usage);
    parts.push(
      usage ? `${hex}${name ? ` (${name})` : ""} for ${usage}` : `${hex}${name ? ` (${name})` : ""}`,
    );
  }
  return parts.length ? `Brand colours: ${parts.join("; ")}` : "";
}

function fontName(value: unknown): string {
  if (value && typeof value === "object") {
    const f = value as Record<string, unknown>;
    const family = asText(f.family);
    const style = asText(f.style);
    return family ? (style ? `${family} (${style})` : family) : "";
  }
  return asText(value);
}

/**
 * Compact prompt context from a kit.
 *
 * `visualOnly` drops the copy-level fields for image and video prompts, where
 * writing style and hashtag limits are noise that competes for a limited
 * prompt budget. Video models in particular compress hard, so every field
 * included has to earn its place — more fields is not automatically more brand.
 */
export function buildBrandSummary(
  kit: BrandKitRow | null,
  opts: { visualOnly?: boolean } = {},
): string {
  if (!kit) return "";
  const visualOnly = opts.visualOnly === true;

  const lines: (string | false)[] = [
    asText(kit.brand_name) && `Brand: ${asText(kit.brand_name)}`,
    asText(kit.industry) && `Industry: ${asText(kit.industry)}`,
    asText(kit.target_audience) && `Audience: ${asText(kit.target_audience)}`,

    !visualOnly && asText(kit.brand_voice) && `Voice: ${asText(kit.brand_voice)}`,
    !visualOnly && asArray(kit.tone_descriptors).length > 0 &&
      `Tone: ${asArray(kit.tone_descriptors).join(", ")}`,
    !visualOnly && asText(kit.writing_style_notes) &&
      `Writing style: ${asText(kit.writing_style_notes)}`,
    !visualOnly && asArray(kit.signature_phrases).length > 0 &&
      `Signature phrases: ${asArray(kit.signature_phrases).join("; ")}`,

    asArray(kit.visual_style_keywords).length > 0 &&
      `Visual style: ${asArray(kit.visual_style_keywords).join(", ")}`,
    formatPalette(kit.color_palette),
    asText(kit.photo_style_notes) && `Photography: ${asText(kit.photo_style_notes)}`,
    fontName(kit.font_display) && `Display font: ${fontName(kit.font_display)}`,
    fontName(kit.font_body) && `Body font: ${fontName(kit.font_body)}`,

    // Negative constraints last: they are the most likely to be truncated by a
    // downstream length cap, and losing a "never" is worse than losing a
    // "prefer", so they sit where a reader — human or model — reaches them
    // after the positive direction is already established.
    asArray(kit.avoid_visual_elements).length > 0 &&
      `Avoid visually: ${asArray(kit.avoid_visual_elements).join(", ")}`,
    !visualOnly && asArray(kit.forbidden_phrases).length > 0 &&
      `Never use these words: ${asArray(kit.forbidden_phrases).join(", ")}`,
    asArray(kit.content_restrictions).length > 0 &&
      `Content restrictions: ${asArray(kit.content_restrictions).join(", ")}`,
    !visualOnly && asText(kit.legal_disclaimers) &&
      `Required disclaimer: ${asText(kit.legal_disclaimers)}`,
  ];

  return lines.filter((l): l is string => typeof l === "string" && l.length > 0).join("\n");
}
