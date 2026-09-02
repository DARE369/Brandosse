/**
 * brandDesign.ts — the only writer of the brand-kit design layer.
 *
 * ── Why a single writer ─────────────────────────────────────────────────────
 * The design columns added by migration 20260901120000 are jsonb. Unconstrained
 * jsonb written from several places is exactly how this database reached 89
 * live tables against 65 in migrations, and how the extractor and the
 * conversation would drift apart if they did not already share one code path.
 *
 * The database enforces that each column holds an object (or, for
 * contrast_pairs, an array). That stops the crudest corruption and nothing
 * else — `{"backgroundd": "blue"}` satisfies every CHECK. This module is what
 * makes the SHAPE true, and `scripts/check-brand-design-writer.cjs` fails the
 * build if anything writes those columns without coming through here.
 *
 * ── The rule this module encodes ────────────────────────────────────────────
 * A colour that has not been contrast-checked is not a colour role. Every
 * normalise function drops values it cannot vouch for rather than passing them
 * through, because a malformed role reaching the compositor produces a graphic
 * that is subtly wrong and confidently delivered — worse than one that fails.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Where a value came from. Presenting a guess as a fact is fabricated data. */
export type EvidenceSource = "measured" | "inferred" | "user";

export interface ColorRole {
  hex: string;
  name: string;
  source: EvidenceSource;
  /** WCAG ratio against the kit's background role. 0 when not applicable. */
  contrast_vs_background: number;
}

export type ColorRoleName =
  | "background"
  | "surface"
  | "text_primary"
  | "text_secondary"
  | "accent"
  | "cta_bg"
  | "cta_text"
  | "border";

export const COLOR_ROLE_NAMES: ColorRoleName[] = [
  "background",
  "surface",
  "text_primary",
  "text_secondary",
  "accent",
  "cta_bg",
  "cta_text",
  "border",
];

export interface ContrastPair {
  fg: string;
  bg: string;
  ratio: number;
  wcag: "AAA" | "AA" | "AA-large" | "fail";
}

export interface TypeRole {
  family: string;
  weight: number;
  /** Letter-spacing in em. Negative tightens. */
  tracking: number;
  case: "none" | "upper" | "title";
}

export interface TypeScale {
  display?: TypeRole;
  body?: TypeRole;
  /** Never render body text below this. Legibility floor, not a preference. */
  min_body_px: number;
}

export interface LogoRules {
  /** Clear space as a multiple of the mark's height. 0.5 is the common brand-book value. */
  clear_space_ratio: number;
  min_width_px: number;
  preferred_corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  never_on: string[];
}

export interface LayoutRules {
  /** Safe margin as a percentage of the shorter canvas edge. */
  safe_margin_pct: number;
  text_max_lines: number;
  alignment: "left" | "center" | "right";
  /** Columns in the layout grid. */
  grid: number;
}

export interface ContactBlock {
  website: string;
  email: string;
  phone: string;
  address: string;
  show_on_designs: boolean;
}

export interface SocialHandle {
  handle: string;
  stamp_on_designs: boolean;
}

export interface RequiredMarks {
  legal_line: string;
  /** Template ids or content kinds where the legal line is mandatory. */
  required_on: string[];
  watermark: boolean;
}

export interface ImageryRules {
  subject_matter: string[];
  mood: string[];
  never_show: string[];
  people: "real" | "illustrated" | "none" | "";
}

export interface FieldEvidence {
  source: EvidenceSource;
  url: string;
  confidence: number;
}

export interface BrandDesign {
  color_roles: Partial<Record<ColorRoleName, ColorRole>>;
  contrast_pairs: ContrastPair[];
  type_scale: TypeScale;
  logo_rules: LogoRules;
  layout_rules: LayoutRules;
  contact_block: ContactBlock;
  social_handles: Record<string, SocialHandle>;
  required_marks: RequiredMarks;
  imagery_rules: ImageryRules;
  extraction_evidence: Record<string, FieldEvidence>;
}

/** The exact set of columns this module owns. Read by the guard. */
export const BRAND_DESIGN_COLUMNS = [
  "color_roles",
  "contrast_pairs",
  "type_scale",
  "logo_rules",
  "layout_rules",
  "contact_block",
  "social_handles",
  "required_marks",
  "imagery_rules",
  "extraction_evidence",
] as const;

// ── Colour arithmetic ────────────────────────────────────────────────────────
//
// Contrast is computed, never judged. WCAG 2.1 relative luminance, which is not
// the same as perceptual lightness and is the reason a "mid grey" can fail
// against white while looking fine to the person who chose it.

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise #abc to #aabbcc, lowercase. Returns "" when not a valid hex. */
export function normalizeHex(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!HEX_RE.test(raw)) return "";
  const body = raw.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = parseInt(normalized.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1–21. Returns 0 when either colour is unparseable. */
export function contrastRatio(foreground: string, background: string): number {
  if (!normalizeHex(foreground) || !normalizeHex(background)) return 0;
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function wcagLevel(ratio: number): ContrastPair["wcag"] {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/** The floor for body text. Below this, text is not placed — it is fixed. */
export const MIN_TEXT_CONTRAST = 4.5;

// ── Primitive coercion ───────────────────────────────────────────────────────

function asString(value: unknown, fallback = ""): string {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = String(entry ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

function asSource(value: unknown): EvidenceSource {
  return asEnum<EvidenceSource>(value, ["measured", "inferred", "user"], "inferred");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ── Defaults ─────────────────────────────────────────────────────────────────
//
// Chosen so that a kit with NO design data still renders something defensible,
// rather than the compositor having to invent a fallback at render time — which
// is how two call sites end up with two different "defaults".

export const DEFAULT_LOGO_RULES: LogoRules = {
  clear_space_ratio: 0.5,
  min_width_px: 96,
  preferred_corner: "bottom-right",
  never_on: [],
};

export const DEFAULT_LAYOUT_RULES: LayoutRules = {
  // 6% keeps text clear of the crop on every platform that crops a preview,
  // including the square-to-4:5 recrop that bites Instagram feeds.
  safe_margin_pct: 6,
  text_max_lines: 4,
  alignment: "left",
  grid: 12,
};

export const DEFAULT_TYPE_SCALE: TypeScale = {
  min_body_px: 18,
};

// ── Normalisers ──────────────────────────────────────────────────────────────

export function normalizeColorRoles(
  input: unknown,
  options: { backgroundHex?: string } = {},
): Partial<Record<ColorRoleName, ColorRole>> {
  const source = asRecord(input);
  const out: Partial<Record<ColorRoleName, ColorRole>> = {};

  // Resolve the background first: every other role's contrast is measured
  // against it, so it cannot be computed in list order.
  const backgroundHex =
    normalizeHex(options.backgroundHex) ||
    normalizeHex(asRecord(source.background).hex);

  for (const roleName of COLOR_ROLE_NAMES) {
    const entry = asRecord(source[roleName]);
    const hex = normalizeHex(entry.hex);
    // A role without a parseable hex is not a role. Dropped, not defaulted:
    // inventing a colour here is how a brand silently acquires one.
    if (!hex) continue;

    out[roleName] = {
      hex,
      name: asString(entry.name),
      source: asSource(entry.source),
      contrast_vs_background:
        backgroundHex && hex !== backgroundHex ? contrastRatio(hex, backgroundHex) : 0,
    };
  }

  return out;
}

/**
 * Build the contrast pair table from resolved roles. Computed here rather than
 * accepted from a caller: a stored ratio that disagrees with its own colours is
 * worse than no ratio at all.
 */
export function buildContrastPairs(
  roles: Partial<Record<ColorRoleName, ColorRole>>,
): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const candidates: Array<[ColorRoleName, ColorRoleName]> = [
    ["text_primary", "background"],
    ["text_secondary", "background"],
    ["text_primary", "surface"],
    ["text_secondary", "surface"],
    ["accent", "background"],
    ["cta_text", "cta_bg"],
  ];

  for (const [fgRole, bgRole] of candidates) {
    const fg = roles[fgRole]?.hex;
    const bg = roles[bgRole]?.hex;
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (!ratio) continue;
    pairs.push({ fg, bg, ratio, wcag: wcagLevel(ratio) });
  }

  return pairs;
}

export function normalizeTypeScale(input: unknown): TypeScale {
  const source = asRecord(input);

  const role = (value: unknown): TypeRole | undefined => {
    const entry = asRecord(value);
    const family = asString(entry.family);
    if (!family) return undefined;
    return {
      family,
      weight: asNumber(entry.weight, 400, 100, 900),
      tracking: asNumber(entry.tracking, 0, -0.1, 0.5),
      case: asEnum(entry.case, ["none", "upper", "title"] as const, "none"),
    };
  };

  const display = role(source.display);
  const body = role(source.body);

  return {
    ...(display ? { display } : {}),
    ...(body ? { body } : {}),
    // 12px is the hard floor: below it text is decoration, not information.
    min_body_px: asNumber(source.min_body_px, DEFAULT_TYPE_SCALE.min_body_px, 12, 96),
  };
}

export function normalizeLogoRules(input: unknown): LogoRules {
  const source = asRecord(input);
  return {
    clear_space_ratio: asNumber(source.clear_space_ratio, DEFAULT_LOGO_RULES.clear_space_ratio, 0, 2),
    min_width_px: asNumber(source.min_width_px, DEFAULT_LOGO_RULES.min_width_px, 16, 2048),
    preferred_corner: asEnum(
      source.preferred_corner,
      ["top-left", "top-right", "bottom-left", "bottom-right"] as const,
      DEFAULT_LOGO_RULES.preferred_corner,
    ),
    never_on: asStringArray(source.never_on),
  };
}

export function normalizeLayoutRules(input: unknown): LayoutRules {
  const source = asRecord(input);
  return {
    // Capped at 25%: past that the safe area is smaller than the margin and
    // there is no canvas left to design on.
    safe_margin_pct: asNumber(source.safe_margin_pct, DEFAULT_LAYOUT_RULES.safe_margin_pct, 0, 25),
    text_max_lines: asNumber(source.text_max_lines, DEFAULT_LAYOUT_RULES.text_max_lines, 1, 12),
    alignment: asEnum(source.alignment, ["left", "center", "right"] as const, DEFAULT_LAYOUT_RULES.alignment),
    grid: asNumber(source.grid, DEFAULT_LAYOUT_RULES.grid, 2, 24),
  };
}

export function normalizeContactBlock(input: unknown): ContactBlock {
  const source = asRecord(input);
  return {
    website: asString(source.website),
    email: asString(source.email),
    phone: asString(source.phone),
    address: asString(source.address),
    show_on_designs: asBoolean(source.show_on_designs, false),
  };
}

export function normalizeSocialHandles(input: unknown): Record<string, SocialHandle> {
  const source = asRecord(input);
  const out: Record<string, SocialHandle> = {};
  for (const [platform, value] of Object.entries(source)) {
    const key = platform.trim().toLowerCase();
    if (!key) continue;
    const entry = asRecord(value);
    // Accept a bare string too — harvesting produces "@handle" before anything
    // has decided whether to stamp it.
    const handle = typeof value === "string" ? value.trim() : asString(entry.handle);
    if (!handle) continue;
    out[key] = {
      handle: handle.startsWith("@") ? handle : `@${handle}`,
      stamp_on_designs: asBoolean(entry.stamp_on_designs, false),
    };
  }
  return out;
}

export function normalizeRequiredMarks(input: unknown): RequiredMarks {
  const source = asRecord(input);
  return {
    legal_line: asString(source.legal_line),
    required_on: asStringArray(source.required_on),
    watermark: asBoolean(source.watermark, false),
  };
}

export function normalizeImageryRules(input: unknown): ImageryRules {
  const source = asRecord(input);
  return {
    subject_matter: asStringArray(source.subject_matter),
    mood: asStringArray(source.mood),
    never_show: asStringArray(source.never_show),
    people: asEnum(source.people, ["real", "illustrated", "none", ""] as const, ""),
  };
}

export function normalizeEvidence(input: unknown): Record<string, FieldEvidence> {
  const source = asRecord(input);
  const out: Record<string, FieldEvidence> = {};
  for (const [field, value] of Object.entries(source)) {
    const key = field.trim();
    if (!key) continue;
    const entry = asRecord(value);
    out[key] = {
      source: asSource(entry.source),
      url: asString(entry.url),
      confidence: asNumber(entry.confidence, 0, 0, 1),
    };
  }
  return out;
}

/**
 * Normalise a full design layer. This is what callers use; the individual
 * normalisers are exported for the harvester, which builds the pieces at
 * different stages.
 *
 * `contrast_pairs` is always recomputed from the resolved roles and never taken
 * from the input — see buildContrastPairs.
 */
export function normalizeBrandDesign(input: unknown): BrandDesign {
  const source = asRecord(input);
  const color_roles = normalizeColorRoles(source.color_roles);

  return {
    color_roles,
    contrast_pairs: buildContrastPairs(color_roles),
    type_scale: normalizeTypeScale(source.type_scale),
    logo_rules: normalizeLogoRules(source.logo_rules),
    layout_rules: normalizeLayoutRules(source.layout_rules),
    contact_block: normalizeContactBlock(source.contact_block),
    social_handles: normalizeSocialHandles(source.social_handles),
    required_marks: normalizeRequiredMarks(source.required_marks),
    imagery_rules: normalizeImageryRules(source.imagery_rules),
    extraction_evidence: normalizeEvidence(source.extraction_evidence),
  };
}

/**
 * The design layer as a database update payload. The single place these column
 * names are written, so a rename is a one-file change and the guard can prove
 * nothing else writes them.
 */
export function toBrandDesignUpdate(design: BrandDesign): Record<string, unknown> {
  return {
    color_roles: design.color_roles,
    contrast_pairs: design.contrast_pairs,
    type_scale: design.type_scale,
    logo_rules: design.logo_rules,
    layout_rules: design.layout_rules,
    contact_block: design.contact_block,
    social_handles: design.social_handles,
    required_marks: design.required_marks,
    imagery_rules: design.imagery_rules,
    extraction_evidence: design.extraction_evidence,
  };
}

/**
 * Everything a site harvest can contribute to the design layer, expressed in
 * the harvest's own vocabulary rather than in column names.
 *
 * Deliberately NOT the column names: a caller that has to write
 * `{ color_roles: ..., type_scale: ... }` to build a payload is a second place
 * those columns are named, which is the thing check-brand-design-writer exists
 * to prevent. Callers describe what they found; this module decides where it
 * goes.
 */
export interface DesignSourceInput {
  colorRoles?: unknown;
  displayFontFamily?: string;
  bodyFontFamily?: string;
  websiteUrl?: string;
  email?: string;
  phone?: string;
  address?: string;
  socialHandles?: unknown;
  evidence?: unknown;
}

/**
 * Build the design-layer update payload from harvested pieces.
 *
 * The one entry point callers need: normalisation, contrast computation and
 * column naming all happen here, so a caller cannot half-normalise or write a
 * column this module does not know about.
 */
export function buildDesignUpdate(input: DesignSourceInput): Record<string, unknown> {
  const typeScale: Record<string, unknown> = {};
  // Weights are conventional defaults, not measurements — a stylesheet states a
  // family far more reliably than it states which weight is "the" display
  // weight, and inventing a specific measured weight would overclaim.
  if (input.displayFontFamily) typeScale.display = { family: input.displayFontFamily, weight: 700 };
  if (input.bodyFontFamily) typeScale.body = { family: input.bodyFontFamily, weight: 400 };

  return toBrandDesignUpdate(
    normalizeBrandDesign({
      color_roles: input.colorRoles,
      type_scale: typeScale,
      contact_block: {
        website: input.websiteUrl ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        address: input.address ?? "",
        // Never on by default: stamping a phone number onto artwork is a
        // decision the brand owner makes, not one an importer makes for them.
        show_on_designs: false,
      },
      social_handles: input.socialHandles,
      extraction_evidence: input.evidence,
    }),
  );
}

/**
 * The design layer, read off a brand_kit row.
 *
 * Exists so that consumers — the compositor's caller in particular — never have
 * to name the design columns themselves. One module knows what they are called,
 * which is the same rule that governs writing them, and
 * `scripts/check-brand-design-writer.cjs` enforces both.
 */
export function readDesignFromKit(kit: Record<string, unknown> | null | undefined): {
  color_roles: Record<string, { hex?: string }>;
  type_scale: Record<string, { family?: string; weight?: number } | number>;
  layout_rules: { safe_margin_pct?: number; alignment?: string };
  logo_rules: { clear_space_ratio?: number; min_width_px?: number; preferred_corner?: string };
  contact_block: Record<string, unknown>;
  social_handles: Record<string, unknown>;
  required_marks: Record<string, unknown>;
  imagery_rules: Record<string, unknown>;
} {
  const source = asRecord(kit);
  const pick = (column: string) => asRecord(source[column]);
  return {
    color_roles: pick("color_roles") as Record<string, { hex?: string }>,
    type_scale: pick("type_scale") as Record<string, { family?: string; weight?: number } | number>,
    layout_rules: pick("layout_rules"),
    logo_rules: pick("logo_rules"),
    contact_block: pick("contact_block"),
    social_handles: pick("social_handles"),
    required_marks: pick("required_marks"),
    imagery_rules: pick("imagery_rules"),
  };
}

/**
 * Roles that are unsafe to render text in, with the reason.
 *
 * Called by the compositor before it draws, not only at harvest: a user can
 * hand-edit a role to something illegible, and the render is the last place
 * that can be caught.
 */
export function failingTextRoles(
  roles: Partial<Record<ColorRoleName, ColorRole>>,
): Array<{ fg: ColorRoleName; bg: ColorRoleName; ratio: number }> {
  const failures: Array<{ fg: ColorRoleName; bg: ColorRoleName; ratio: number }> = [];
  const checks: Array<[ColorRoleName, ColorRoleName]> = [
    ["text_primary", "background"],
    ["text_secondary", "background"],
    ["cta_text", "cta_bg"],
  ];

  for (const [fgRole, bgRole] of checks) {
    const fg = roles[fgRole]?.hex;
    const bg = roles[bgRole]?.hex;
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_TEXT_CONTRAST) failures.push({ fg: fgRole, bg: bgRole, ratio });
  }

  return failures;
}
