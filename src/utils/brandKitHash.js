/**
 * brandKitHash.js — one identity for "which version of this brand produced
 * this output".
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * There were two functions claiming to do this, and neither did.
 *
 * 1. `computeVersionHash` in BrandKitStore.js — the one whose result is
 *    actually WRITTEN to `brand_kit.version_hash` and stamped onto every
 *    generation receipt (generationPipeline.js:150) — was
 *    `btoa(JSON.stringify(kit)).slice(0, 16)`. Sixteen base64 characters is
 *    twelve bytes of input, and the row always begins `{"id":"<uuid>`, so the
 *    value was a function of the kit's UUID and nothing else. Verified
 *    2026-09-01: changing brand_name AND color_palette produced a byte-identical
 *    hash. It had never changed for any kit, ever.
 *
 * 2. `computeBrandKitHash` here — used for the suggested-prompt cache — covered
 *    five fields (name, industry, voice, audience, style keywords). Editing a
 *    palette, a font, or a restriction left the cache serving stale prompts.
 *
 * Both are now this one function. The consequence of getting it wrong is not
 * cosmetic: a generation receipt that claims a brand version is making a
 * factual claim about which brand data produced the asset, and that claim was
 * false for every generation the product has ever made.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * Every field that can change generated output belongs in the hash. Fields that
 * cannot are listed in HASH_EXCLUDED_FIELDS with the reason, so the exclusion
 * is a decision on the record rather than an oversight.
 *
 * `scripts/check-brand-version-hash.cjs` reads the brand_kit columns out of the
 * migrations and fails the build when a column appears in neither list — so
 * adding a column forces a decision about whether it affects output.
 */

/**
 * Fields whose value can change what a generator produces.
 * Order is irrelevant to the result (each is serialised with its own name).
 */
export const BRAND_KIT_HASH_FIELDS = [
  // Identity and audience — reaches every prompt via buildBrandSummary.
  'brand_name',
  'industry',
  'tagline',
  'website_url',
  'primary_language',
  'target_audience',
  'audience_age_range',
  'audience_locations',

  // Voice — reaches copy generation.
  'brand_voice',
  'tone_descriptors',
  'writing_style_notes',
  'signature_phrases',
  'forbidden_phrases',
  'emoji_usage',
  'call_to_action_style',

  // Guardrails — changing these changes what is allowed out.
  'content_restrictions',
  'derived_banned_phrases',
  'competitor_names',
  'legal_disclaimers',
  'brand_safe_only',
  'min_caption_words',
  'max_caption_words',
  'max_hashtags',

  // Visual system — the half the previous hash ignored entirely.
  'visual_style_keywords',
  'color_palette',
  'typography_notes',
  'photo_style_notes',
  'avoid_visual_elements',
  'font_display',
  'font_body',

  // Per-platform overrides.
  'platform_preferences',

  // Design layer (migration 20260901120000). Every one of these is read
  // directly by the compositor, so a change to any of them changes the pixels.
  'color_roles',
  'contrast_pairs',
  'type_scale',
  'logo_rules',
  'layout_rules',
  'contact_block',
  'social_handles',
  'required_marks',
  'imagery_rules',
];

/**
 * Columns deliberately outside the hash, each with the reason it cannot change
 * generated output. Read by the guard — do not shorten to a bare list.
 */
export const HASH_EXCLUDED_FIELDS = {
  id: 'Row identity, not brand content.',
  user_id: 'Ownership, not brand content.',
  created_at: 'Metadata.',
  last_updated_at: 'Metadata — changes on every save, which would make the hash useless as a content identity.',
  version_hash: 'This is the output of the hash; including it would be circular.',
  setup_completed: 'Onboarding progress, never read by a generator.',
  setup_skipped: 'Onboarding progress, never read by a generator.',
  is_active: 'Selects WHICH kit is used; does not change the content of the one being hashed.',
  kit_name: 'A label the user gives the kit. Never reaches a prompt.',
  extraction_evidence:
    'Provenance only. Learning that a hex was measured rather than inferred does not '
    + 'change the hex, so it cannot change the output. Deliberately excluded so that '
    + 're-importing a site and confirming existing values does not invalidate every '
    + 'cached suggestion for no visible reason.',
  design_setup_completed:
    'Onboarding progress for the design tab. Never read by a generator.',
};

/**
 * Canonical serialisation. Objects are key-sorted so that two kits with the
 * same content but different key insertion order hash identically — the exact
 * trap the old JSON.stringify approach fell into.
 */
function canonicalize(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}=${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return String(value);
}

/**
 * FNV-1a, run twice with different offset bases and concatenated, for 64 bits
 * of output. A 32-bit hash stamped onto every generation receipt would collide
 * often enough to matter across a real user base; 64 bits does not.
 */
function fnv1a64(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code;
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Content identity for a brand kit. Accepts a raw `brand_kit` row.
 *
 * Returns 'none' for a missing kit so "no brand kit" is distinguishable from
 * "an empty brand kit" — they produce genuinely different output.
 */
export function computeBrandKitHash(brandKit) {
  if (!brandKit || typeof brandKit !== 'object') return 'none';

  const serialized = BRAND_KIT_HASH_FIELDS
    .map((field) => `${field}=${canonicalize(brandKit[field])}`)
    .join('|');

  return fnv1a64(serialized);
}

export default computeBrandKitHash;
