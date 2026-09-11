/**
 * siteHarvest.ts — read a client's website as EVIDENCE rather than as prose.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * `extractBrandKit` fetched ONE page, stripped the tags off with a regex, and
 * handed the resulting text soup to a language model with "extract the brand's
 * colour palette". The model, having been shown no colours, produced colours
 * anyway — a plausible palette invented from marketing copy and presented to
 * the user with the same authority as a fact.
 *
 * The site was carrying the real answer the whole time. `--brand-primary:
 * #0a2540` is not something to infer; it is something to read.
 *
 * ── What changes ────────────────────────────────────────────────────────────
 * This module measures what can be measured and labels it as measured:
 *
 *   colours   — parsed from the site's own CSS, counted, weighted by the
 *               property they appear on, with custom properties weighted
 *               highest because their NAMES declare intent
 *   fonts     — from @font-face, Google Fonts links, and font-family
 *               declarations resolved against the selectors that use them
 *   roles     — assigned by luminance and contrast arithmetic, not by prompt
 *   identity  — JSON-LD Organization, contact details, social handles
 *   logos     — favicon, apple-touch-icon, og:image, header images
 *
 * The language model still runs, but on a labelled evidence document, and it is
 * explicitly forbidden from substituting anything measured. Its job shrinks to
 * what only it can do: voice, audience, positioning, restrictions.
 *
 * ── Failure posture ─────────────────────────────────────────────────────────
 * Every stage degrades to "no measured value" rather than to a wrong one. A
 * site that blocks its stylesheets yields a harvest with no measured palette,
 * which falls back to today's inference behaviour. That is acceptable.
 * Producing a confident hex that is not on the site is not.
 *
 * Every outbound request goes through safeFetch — see the SSRF note there.
 * This module makes roughly a dozen requests per import to addresses derived
 * from attacker-influenceable markup, so that is not optional.
 */

import { safeFetch, safeFetchText, BlockedUrlError } from "./safeFetch.ts";
import {
  type ColorRole,
  type ColorRoleName,
  contrastRatio,
  MIN_TEXT_CONTRAST,
  normalizeHex,
  relativeLuminance,
  describeColor,
} from "./brandDesign.ts";

// ── Budgets ──────────────────────────────────────────────────────────────────
//
// Sized so the whole harvest fits comfortably inside an edge invocation with
// room for the LLM call that follows it. Exhausting a budget returns a PARTIAL
// harvest with a note, never a failure: the user has a website, and whatever
// was reachable is worth more than an error.

const MAX_PAGES = 6;
const MAX_STYLESHEETS = 4;
const MAX_LOGO_CANDIDATES = 3;
const PAGE_TIMEOUT_MS = 12_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const CSS_MAX_BYTES = 512 * 1024;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const TOTAL_BUDGET_MS = 75_000;
const MAX_EVIDENCE_CHARS = 24_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface MeasuredColor {
  hex: string;
  /** Property-weighted occurrence count. Higher means more structurally used. */
  weight: number;
  /** Raw occurrences, for the evidence document. */
  count: number;
  /** Property or custom-property names it appeared under, most useful first. */
  sources: string[];
  /** True when it came from a CSS custom property, whose name states intent. */
  fromCustomProperty: boolean;
  /**
   * True when it was set as a background on `body`, `html` or `:root`.
   *
   * This is the site's actual GROUND, and it must outrank a hero panel or a
   * card that happens to be used more often. Without this distinction a fixture
   * with one white `body` and several navy sections resolves navy as the
   * background and then picks a text colour for the wrong ground.
   */
  onGroundSelector: boolean;
  /**
   * Portion of `weight` that came from BACKGROUND properties specifically.
   *
   * A colour can be heavily used and never once be a background — chowdeck.com
   * declares #000000 as a custom property and paints it on borders, which gave
   * it more raw weight than the page's actual ground and won it the background
   * role on a light site. Raw weight cannot tell those apart; this can.
   */
  backgroundWeight: number;
}

export interface MeasuredFont {
  family: string;
  /** How it was found, strongest evidence first. */
  evidence: "font-face" | "google-fonts" | "declaration";
  usedOn: string[];
}

export interface LogoCandidate {
  url: string;
  origin: "favicon" | "apple-touch-icon" | "og:image" | "header-img" | "json-ld";
  contentType: string;
  bytes: number;
  hasAlpha: boolean | null;
}

export interface PageHarvest {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  text: string;
}

export interface HarvestResult {
  siteUrl: string;
  pagesHarvested: string[];
  measuredPalette: MeasuredColor[];
  measuredFonts: { display?: MeasuredFont; body?: MeasuredFont; all: MeasuredFont[] };
  colorRoles: Partial<Record<ColorRoleName, ColorRole>>;
  organization: Record<string, string>;
  contact: { email: string; phone: string; address: string; website: string };
  socialHandles: Record<string, string>;
  logoCandidates: LogoCandidate[];
  pages: PageHarvest[];
  /** Everything that degraded, in plain language. Surfaced, never swallowed. */
  notes: string[];
  /** The labelled document handed to the extractor. */
  evidenceDocument: string;
}

// ── Small HTML helpers ───────────────────────────────────────────────────────
//
// Regex rather than a DOM parser: the edge runtime has no DOM, and pulling in a
// parser to read six attributes would add a cold-start cost to every import.
// Everything here degrades to "not found" on malformed markup.

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function collapse(value: string): string {
  return decodeEntities(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** All values of one attribute across tags matching a name. */
function attrValues(html: string, tagName: string, attribute: string): string[] {
  const out: string[] = [];
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const attrRe = new RegExp(`\\b${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    const found = match[0].match(attrRe);
    if (found) out.push(decodeEntities(found[2] ?? found[3] ?? found[4] ?? ""));
  }
  return out;
}

/** Whole opening tags for a tag name, so several attributes can be read together. */
function openingTags(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return html.match(re) ?? [];
}

function attrOf(tag: string, attribute: string): string {
  const found = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return found ? decodeEntities(found[2] ?? found[3] ?? found[4] ?? "") : "";
}

function metaContent(html: string, keys: string[]): string {
  for (const tag of openingTags(html, "meta")) {
    const name = (attrOf(tag, "name") || attrOf(tag, "property") || "").toLowerCase();
    if (keys.includes(name)) {
      const content = collapse(attrOf(tag, "content"));
      if (content) return content;
    }
  }
  return "";
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

// ── Colour parsing ───────────────────────────────────────────────────────────

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = lig - c / 2;
  const toHex = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/**
 * Every colour in a CSS value, as normalised hex. Fully transparent colours are
 * dropped — `rgba(0,0,0,0)` is a reset, not a brand colour, and it is extremely
 * common in resets and frameworks.
 */
export function colorsInValue(value: string): string[] {
  const out: string[] = [];

  for (const m of value.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    const hex = normalizeHex(`#${m[1]}`);
    if (hex) out.push(hex);
  }

  for (const m of value.matchAll(/rgba?\(\s*([^)]+)\)/gi)) {
    const parts = m[1].split(/[,\/\s]+/).filter(Boolean);
    if (parts.length < 3) continue;
    if (parts.length >= 4 && Number(parts[3]) === 0) continue;
    const [r, g, b] = parts.slice(0, 3).map((p) =>
      p.endsWith("%") ? Math.round((Number(p.slice(0, -1)) / 100) * 255) : Number(p)
    );
    if ([r, g, b].some((n) => !Number.isFinite(n))) continue;
    const hex = normalizeHex(
      `#${[r, g, b].map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0")).join("")}`,
    );
    if (hex) out.push(hex);
  }

  for (const m of value.matchAll(/hsla?\(\s*([^)]+)\)/gi)) {
    const parts = m[1].split(/[,\/\s]+/).filter(Boolean);
    if (parts.length < 3) continue;
    if (parts.length >= 4 && Number(parts[3]) === 0) continue;
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    const l = parseFloat(parts[2]);
    if ([h, s, l].some((n) => !Number.isFinite(n))) continue;
    out.push(hslToHex(h, s, l));
  }

  return out;
}

// ── CSS rule parsing ─────────────────────────────────────────────────────────

interface CssRule {
  selector: string;
  declarations: string;
}

/**
 * Flatten a stylesheet into selector/declaration pairs.
 *
 * ── Why not the obvious regex ───────────────────────────────────────────────
 * `([^{}]+)\{([^{}]*)\}` is the usual shortcut and it survives `@media` fine —
 * the inner rules still match individually. Where it breaks is NATIVE CSS
 * NESTING, which now ships in every browser and comes out of Tailwind and
 * PostCSS by default:
 *
 *     .card { background: #0A2540; color: #fff; &:hover { background: #ff5a3c; } }
 *
 * The regex returns ONE rule whose "selector" is
 * `background: #0A2540; color: #fff; &:hover` and whose declarations are the
 * hover block. Both of the card's real colours are silently reclassified as part
 * of a selector and never harvested — on a nesting-heavy stylesheet that is most
 * of the brand's palette.
 *
 * So this walks brace depth AND splits a prelude at its last semicolon:
 * everything before it is declarations belonging to the enclosing rule,
 * everything after it is the nested selector. A first version of this function
 * tracked depth correctly and still lost those declarations, which is the same
 * bug wearing a longer implementation.
 */
export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: Array<{ selector: string; declarations: string }> = [];
  let buffer = "";

  // Strip comments first so a commented-out rule is not harvested as real.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, " ");

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "{") {
      let prelude = buffer.trim();
      buffer = "";

      // Declarations may sit directly before a nested rule inside the same
      // block. They belong to the parent, not to the selector being opened.
      const lastSemicolon = prelude.lastIndexOf(";");
      if (lastSemicolon >= 0) {
        const parent = stack[stack.length - 1];
        if (parent) parent.declarations += `${prelude.slice(0, lastSemicolon + 1)} `;
        prelude = prelude.slice(lastSemicolon + 1).trim();
      }

      // Nested at-rules wrap other rules; their inner rules are parsed as
      // normal. @font-face and @page hold declarations and are kept.
      const isWrapper = /^@(media|supports|layer|container|scope|document)\b/i.test(prelude);
      stack.push({ selector: isWrapper ? "@nested" : prelude, declarations: "" });
      continue;
    }

    if (ch === "}") {
      const frame = stack.pop();
      if (frame) {
        // Whatever accumulated since the last brace closes this frame — which
        // is how declarations placed AFTER a nested rule are kept.
        frame.declarations += buffer;
        if (frame.selector && frame.selector !== "@nested") {
          rules.push({ selector: frame.selector, declarations: frame.declarations });
        }
      }
      buffer = "";
      continue;
    }

    buffer += ch;
  }

  return rules;
}

/** Declarations of one block as property/value pairs. */
function parseDeclarations(block: string): Array<{ property: string; value: string }> {
  const out: Array<{ property: string; value: string }> = [];
  for (const piece of block.split(";")) {
    const idx = piece.indexOf(":");
    if (idx < 0) continue;
    const property = piece.slice(0, idx).trim().toLowerCase();
    const value = piece.slice(idx + 1).trim();
    if (!property || !value) continue;
    out.push({ property, value });
  }
  return out;
}

/**
 * How much a colour occurrence counts for.
 *
 * A custom property is a DECLARATION OF INTENT — someone wrote
 * `--brand-primary` on purpose — so it outweighs any number of incidental
 * borders. Backgrounds outweigh text because a brand's ground is the colour a
 * viewer sees most of.
 */
function colorWeightFor(property: string): number {
  // Framework internals carry colours that are not brand decisions:
  // --tw-shadow / --tw-ring-* are shadow plumbing (#000 appeared 82 times on
  // lordswayenergy.com purely through these), and --tw-gradient-* are set by
  // utility classes rather than chosen. Weighting them as custom properties —
  // the HIGHEST weight, on the grounds that a custom property names intent —
  // let Tailwind's stock palette outrank everything and be reported as measured.
  if (/^--tw-/.test(property)) return 0;
  if (property.startsWith("--")) return 5;
  if (/^(background|background-color)$/.test(property)) return 3;
  if (property === "color") return 2;
  if (/^(border|border-color|border-.*-color|outline-color|fill|stroke|box-shadow)$/.test(property)) return 1;
  if (/background|color/.test(property)) return 1;
  return 0;
}

// ── Font parsing ─────────────────────────────────────────────────────────────

const GENERIC_FAMILIES = new Set([
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "inherit",
  "initial", "unset", "revert", "-apple-system", "blinkmacsystemfont",
  "segoe ui", "roboto", "helvetica neue", "helvetica", "arial", "emoji",
  "apple color emoji", "segoe ui emoji", "noto color emoji", "math", "fangsong",
  // Emoji and symbol fallbacks that sit at the TAIL of default stacks. Missing
  // one of these is not cosmetic: lordswayenergy.com ships Tailwind's default
  // stack and nothing else, and because "segoe ui symbol" was absent from this
  // list it was reported to the user as their measured brand body typeface.
  "segoe ui symbol", "noto sans symbols", "noto sans symbols 2", "symbol",
  "segoe ui historic", "android emoji", "twemoji mozilla", "ui-emoji",
  "sfmono-regular", "menlo", "monaco", "consolas", "liberation mono",
  "courier new", "courier", "georgia", "cambria", "times new roman", "times",
  "sf pro text", "sf pro display", "segoe ui variable",
]);

/**
 * Font stacks that ship with a CSS framework and say nothing about a brand.
 *
 * Tailwind's `font-sans` is the whole default stack; a site that never
 * overrides it has not chosen a typeface, and reporting one from it is
 * fabricating a brand decision the owner never made.
 */
const FRAMEWORK_FONT_STACK = /^\s*ui-(sans-serif|serif|monospace)\s*,/i;

/** First non-generic family in a font-family value. */
export function firstRealFamily(value: string): string {
  // A framework's untouched default stack is not a brand typeface.
  if (FRAMEWORK_FONT_STACK.test(value)) return "";

  for (const raw of value.split(",")) {
    const family = raw.trim().replace(/^['"]|['"]$/g, "").trim();
    if (!family) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;

    // The `font:` SHORTHAND packs size and line-height in front of the family,
    // so its first comma-separated token is not a family at all. A live site
    // yielded `calc(9px * var(--total-scale-factor)) sans-serif` as its
    // "brand body typeface" through exactly this path.
    if (family.includes("(")) continue;      // calc(), var(), clamp()
    if (/^[\d.]/.test(family)) continue;     // a size, not a name
    if (family.includes("/")) continue;      // font-size/line-height
    // CSS system-font keywords (`font: menu`), which name an OS setting.
    if (/^(caption|icon|menu|message-box|small-caption|status-bar)$/i.test(family)) continue;

    return family;
  }
  return "";
}

const DISPLAY_SELECTOR = /(^|[\s,>+~])(h1|h2|h3)\b|\.(h1|h2|h3|title|heading|headline|display|hero)\b/i;
const BODY_SELECTOR = /(^|[\s,>+~])(body|html|p)\b|\.(body|text|content|prose)\b/i;

// ── Social + contact ─────────────────────────────────────────────────────────

const SOCIAL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(twitter|x)\.com$/i, "x"],
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)youtube\.com$/i, "youtube"],
  [/(^|\.)pinterest\.com$/i, "pinterest"],
  [/(^|\.)threads\.(net|com)$/i, "threads"],
];

export function socialHandleFrom(href: string): { platform: string; handle: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  for (const [pattern, platform] of SOCIAL_HOSTS) {
    if (!pattern.test(host)) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    // Skip the structural first segment these platforms use.
    let handle = segments[0];
    if (platform === "linkedin" && /^(company|in|school)$/i.test(handle)) {
      handle = segments[1] ?? "";
    }
    if (platform === "youtube" && /^(channel|c|user)$/i.test(handle)) {
      handle = segments[1] ?? "";
    }
    if (platform === "facebook" && /^(pages|profile\.php)$/i.test(handle)) {
      handle = segments[1] ?? "";
    }
    handle = handle.replace(/^@/, "").trim();
    // Reject share/intent endpoints — a share button is not the brand's handle.
    if (!handle || /^(share|sharer|intent|home|login|signup|watch|hashtag|explore|p|reel)$/i.test(handle)) {
      return null;
    }
    return { platform, handle };
  }
  return null;
}

// ── Page scoring ─────────────────────────────────────────────────────────────

const PAGE_KEYWORDS: Array<[RegExp, number]> = [
  [/\/(about|about-us|our-story|story)\b/i, 10],
  [/\/(mission|values|who-we-are|why)\b/i, 8],
  [/\/(services|products|shop|menu|collections?)\b/i, 7],
  [/\/(contact|contact-us)\b/i, 6],
  [/\/(brand|press|media-kit|press-kit)\b/i, 6],
  [/\/(team|people)\b/i, 3],
];

const PAGE_EXCLUDE = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|css|js|xml|ico|woff2?|ttf)$|\/(privacy|terms|cookie|legal|login|signin|signup|cart|checkout|account|search|tag|category|author|feed|wp-|admin)\b/i;

function scoreCandidate(url: string): number {
  if (PAGE_EXCLUDE.test(url)) return -1;
  let score = 0;
  for (const [pattern, points] of PAGE_KEYWORDS) {
    if (pattern.test(url)) score += points;
  }
  // Shallower pages are more likely to be the brand's own story.
  const depth = url.split("/").filter(Boolean).length;
  score -= Math.max(0, depth - 4);
  return score;
}

// ── The harvest ──────────────────────────────────────────────────────────────

export async function harvestSite(rawUrl: string): Promise<HarvestResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  // -- Homepage. This one failing IS a failure; everything after it degrades. --
  const home = await safeFetchText(rawUrl, {
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs: PAGE_TIMEOUT_MS,
    expectContentType: /text\/html|application\/xhtml|text\/plain/i,
    context: "siteHarvest.home",
  });

  const siteUrl = home.finalUrl;
  const origin = new URL(siteUrl).origin;

  const pages: PageHarvest[] = [readPage(home.text, siteUrl)];
  const htmlByUrl = new Map<string, string>([[siteUrl, home.text]]);

  // -- Discover further pages ------------------------------------------------
  const candidates = await discoverPages(siteUrl, origin, home.text, notes, budgetLeft);

  for (const candidate of candidates) {
    if (pages.length >= MAX_PAGES) break;
    if (budgetLeft() < PAGE_TIMEOUT_MS) {
      notes.push(
        `Time budget reached after ${pages.length} page(s); the remaining pages were not read.`,
      );
      break;
    }
    try {
      const page = await safeFetchText(candidate, {
        maxBytes: PAGE_MAX_BYTES,
        timeoutMs: PAGE_TIMEOUT_MS,
        expectContentType: /text\/html|application\/xhtml/i,
        context: "siteHarvest.page",
      });
      htmlByUrl.set(page.finalUrl, page.text);
      pages.push(readPage(page.text, page.finalUrl));
    } catch (err) {
      notes.push(`Could not read ${candidate}: ${errText(err)}`);
    }
  }

  // -- Stylesheets ------------------------------------------------------------
  const cssSources: string[] = [];
  const googleFontFamilies: string[] = [];
  const sheetUrls: string[] = [];

  for (const [pageUrl, html] of htmlByUrl) {
    for (const tag of openingTags(html, "link")) {
      const rel = attrOf(tag, "rel").toLowerCase();
      const href = attrOf(tag, "href");
      if (!href) continue;
      if (!rel.includes("stylesheet")) continue;
      const resolved = absolute(href, pageUrl);
      if (!resolved) continue;
      if (/fonts\.googleapis\.com/i.test(resolved)) {
        googleFontFamilies.push(...googleFamiliesFrom(resolved));
        continue;
      }
      if (!sheetUrls.includes(resolved)) sheetUrls.push(resolved);
    }
    // Inline styles are where small sites and modern build tools put the
    // critical CSS, which is exactly the brand-defining part.
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      cssSources.push(m[1]);
    }
  }

  let sheetsRead = 0;
  for (const sheetUrl of sheetUrls) {
    if (sheetsRead >= MAX_STYLESHEETS) break;
    if (budgetLeft() < PAGE_TIMEOUT_MS) {
      notes.push("Time budget reached before every stylesheet was read.");
      break;
    }
    try {
      const sheet = await safeFetchText(sheetUrl, {
        maxBytes: CSS_MAX_BYTES,
        timeoutMs: PAGE_TIMEOUT_MS,
        context: "siteHarvest.css",
      });
      cssSources.push(sheet.text);
      sheetsRead += 1;
    } catch (err) {
      notes.push(`Could not read stylesheet ${sheetUrl}: ${errText(err)}`);
    }
  }

  if (cssSources.length === 0) {
    notes.push(
      "No stylesheet could be read, so no colour or typography was MEASURED. " +
      "Any palette below is inferred and should be confirmed.",
    );
  }

  const { palette, fonts } = analyseCss(cssSources, googleFontFamilies);

  // Said plainly, because "no fonts were found" is a real answer about the site
  // and the alternative is the user staring at an empty Typography section
  // wondering what went wrong. A site can simply not have chosen a typeface.
  if (cssSources.length > 0 && fonts.all.length === 0) {
    notes.push(
      "This site does not name a typeface of its own — it uses the browser or framework default "
      + "stack. Nothing was measured for typography, so set your display and body fonts by hand.",
    );
  }
  const colorRoles = inferColorRoles(palette, notes);

  // -- Identity, contact, social, logos ---------------------------------------
  const organization = readJsonLdOrganization(htmlByUrl);
  const socialHandles = readSocialHandles(htmlByUrl);
  const contact = readContact(htmlByUrl, organization, siteUrl);
  const logoCandidates = await collectLogos(htmlByUrl, organization, notes, budgetLeft);

  const result: HarvestResult = {
    siteUrl,
    pagesHarvested: pages.map((p) => p.url),
    measuredPalette: palette,
    measuredFonts: fonts,
    colorRoles,
    organization,
    contact,
    socialHandles,
    logoCandidates,
    pages,
    notes,
    evidenceDocument: "",
  };

  result.evidenceDocument = buildEvidenceDocument(result);
  return result;
}

function errText(err: unknown): string {
  if (err instanceof BlockedUrlError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

// ── Page reading ─────────────────────────────────────────────────────────────

export function readPage(html: string, url: string): PageHarvest {
  const clean = stripNoise(html);
  const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const headings: string[] = [];
  for (const m of clean.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = collapse(m[2].replace(/<[^>]+>/g, " "));
    if (text && text.length < 200) headings.push(`H${m[1]}: ${text}`);
    if (headings.length >= 25) break;
  }

  // Drop chrome before taking prose: nav and footer are the same on every page
  // and would otherwise dominate a multi-page harvest with menu labels.
  const body = clean
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return {
    url,
    title: titleMatch ? collapse(titleMatch[1]) : "",
    metaDescription: metaContent(clean, ["description", "og:description"]),
    headings,
    text: collapse(body).slice(0, 6000),
  };
}

// ── Discovery ────────────────────────────────────────────────────────────────

async function discoverPages(
  siteUrl: string,
  origin: string,
  homeHtml: string,
  notes: string[],
  budgetLeft: () => number,
): Promise<string[]> {
  const found = new Set<string>();

  // robots.txt -> sitemap, the site's own statement of what matters.
  if (budgetLeft() > PAGE_TIMEOUT_MS * 2) {
    try {
      const robots = await safeFetchText(`${origin}/robots.txt`, {
        maxBytes: 128 * 1024,
        timeoutMs: 6_000,
        context: "siteHarvest.robots",
      });
      for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
        const sitemapUrl = absolute(m[1], origin);
        if (sitemapUrl) await readSitemap(sitemapUrl, origin, found, notes);
        break; // one sitemap is plenty
      }
    } catch {
      // No robots.txt is entirely normal.
    }
  }

  if (found.size === 0 && budgetLeft() > PAGE_TIMEOUT_MS * 2) {
    await readSitemap(`${origin}/sitemap.xml`, origin, found, notes);
  }

  // Fall back to the homepage's own links.
  for (const href of attrValues(stripNoise(homeHtml), "a", "href")) {
    const resolved = absolute(href, siteUrl);
    if (!resolved) continue;
    try {
      if (new URL(resolved).origin !== origin) continue;
    } catch {
      continue;
    }
    found.add(resolved.split("#")[0]);
  }

  const scored = [...found]
    .filter((url) => url !== siteUrl && url !== `${siteUrl}/`)
    .map((url) => ({ url, score: scoreCandidate(url) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_PAGES * 2).map((entry) => entry.url);
}

async function readSitemap(
  sitemapUrl: string,
  origin: string,
  found: Set<string>,
  notes: string[],
): Promise<void> {
  try {
    const sitemap = await safeFetchText(sitemapUrl, {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 8_000,
      context: "siteHarvest.sitemap",
    });
    for (const m of sitemap.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const url = decodeEntities(m[1].trim());
      try {
        if (new URL(url).origin === origin) found.add(url.split("#")[0]);
      } catch { /* skip malformed entry */ }
      if (found.size > 500) break;
    }
  } catch (err) {
    notes.push(`No usable sitemap at ${sitemapUrl}: ${errText(err)}`);
  }
}

function googleFamiliesFrom(href: string): string[] {
  const out: string[] = [];
  try {
    const url = new URL(href);
    for (const value of url.searchParams.getAll("family")) {
      // "Poppins:wght@400;600" -> "Poppins"
      const family = value.split(":")[0].replace(/\+/g, " ").trim();
      if (family) out.push(family);
    }
  } catch { /* ignore malformed link */ }
  return out;
}

// ── CSS analysis ─────────────────────────────────────────────────────────────

export function analyseCss(
  cssSources: string[],
  googleFontFamilies: string[],
): { palette: MeasuredColor[]; fonts: HarvestResult["measuredFonts"] } {
  const colorStats = new Map<string, {
    weight: number;
    count: number;
    sources: Map<string, number>;
    custom: boolean;
    ground: boolean;
    bgWeight: number;
  }>();
  const fontStats = new Map<string, MeasuredFont>();

  const noteFont = (family: string, evidence: MeasuredFont["evidence"], usedOn?: string) => {
    if (!family) return;
    const key = family.toLowerCase();
    const existing = fontStats.get(key);
    const rank = { "font-face": 3, "google-fonts": 2, declaration: 1 } as const;
    if (existing) {
      if (rank[evidence] > rank[existing.evidence]) existing.evidence = evidence;
      if (usedOn && existing.usedOn.length < 8 && !existing.usedOn.includes(usedOn)) {
        existing.usedOn.push(usedOn);
      }
      return;
    }
    fontStats.set(key, { family, evidence, usedOn: usedOn ? [usedOn] : [] });
  };

  for (const family of googleFontFamilies) noteFont(family, "google-fonts");

  for (const css of cssSources) {
    for (const rule of parseCssRules(css)) {
      const selector = rule.selector.trim();
      const isFontFace = /^@font-face$/i.test(selector);
      // The page's own ground, as opposed to a section that happens to be dark.
      const isGroundSelector = selector
        .split(",")
        .some((part) => /^(:root|html|body)$/i.test(part.trim()));

      for (const { property, value } of parseDeclarations(rule.declarations)) {
        // -- fonts
        if (isFontFace && property === "font-family") {
          noteFont(firstRealFamily(value), "font-face");
        } else if (property === "font-family" || property === "font") {
          const family = firstRealFamily(value);
          if (family) noteFont(family, "declaration", selector.slice(0, 80));
        } else if (property.startsWith("--") && /font|family|type|heading|body/i.test(property)) {
          const family = firstRealFamily(value);
          if (family) noteFont(family, "declaration", property);
        }

        // -- colours
        const weight = colorWeightFor(property);
        if (weight === 0) continue;
        for (const hex of colorsInValue(value)) {
          const entry = colorStats.get(hex) ?? {
            weight: 0,
            count: 0,
            sources: new Map<string, number>(),
            custom: false,
            ground: false,
            bgWeight: 0,
          };
          entry.weight += weight;
          entry.count += 1;
          if (property.startsWith("--")) entry.custom = true;
          if (isGroundSelector && /^background(-color)?$/.test(property)) entry.ground = true;
          // Background evidence, kept separately from total weight.
          if (/^background(-color|-image)?$/.test(property) || BG_CUSTOM_PROPERTY.test(property)) {
            entry.bgWeight += weight;
          }
          entry.sources.set(property, (entry.sources.get(property) ?? 0) + 1);
          colorStats.set(hex, entry);
        }
      }
    }
  }

  const palette: MeasuredColor[] = [...colorStats.entries()]
    .map(([hex, entry]) => ({
      hex,
      weight: entry.weight,
      count: entry.count,
      fromCustomProperty: entry.custom,
      onGroundSelector: entry.ground,
      backgroundWeight: entry.bgWeight,
      sources: [...entry.sources.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([property]) => property),
    }))
    // A colour used once, on a border, is noise from a framework reset.
    .filter((entry) => entry.weight >= 2 || entry.fromCustomProperty)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  const all = [...fontStats.values()];
  const display =
    all.find((f) => f.usedOn.some((s) => DISPLAY_SELECTOR.test(s))) ??
    all.find((f) => f.evidence === "font-face") ??
    all.find((f) => f.evidence === "google-fonts");
  const body =
    all.find((f) => f.usedOn.some((s) => BODY_SELECTOR.test(s))) ??
    all.find((f) => f !== display);

  return {
    palette,
    fonts: {
      ...(display ? { display } : {}),
      ...(body && body !== display ? { body } : {}),
      all,
    },
  };
}

// ── Role inference ───────────────────────────────────────────────────────────

function saturationOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/**
 * A custom property whose NAME declares it is a background — `--bg`,
 * `--color-background`, `--surface-2`. Anchored on word parts so
 * `--color-bgblue` (a blue that merely contains "bg") does not qualify.
 */
const BG_CUSTOM_PROPERTY = /^--(?:.*[-_])?(?:bg|background|surface|paper|canvas|ground)(?:[-_].*)?$/i;

const BG_PROPERTY = /background|--.*\b(bg|background|surface|paper|canvas)\b|--(bg|background|surface)/i;
const CTA_PROPERTY = /--.*\b(primary|accent|brand|cta|action|button|link)\b/i;

/**
 * Assign roles from measured colours using luminance, saturation and contrast.
 *
 * Deliberately arithmetic. The alternative — asking a language model which
 * colour is the button — reintroduces the guess this whole module exists to
 * remove, and it cannot be checked afterwards.
 *
 * Anything it cannot decide is left unset. An unset role falls back to the
 * existing inference path; a WRONG role produces confidently mis-branded
 * artwork, which is worse.
 */
export function inferColorRoles(
  palette: MeasuredColor[],
  /** Degradations are pushed here so the user is told, never silently guessed at. */
  notes?: string[],
): Partial<Record<ColorRoleName, ColorRole>> {
  const roles: Partial<Record<ColorRoleName, ColorRole>> = {};
  if (palette.length === 0) return roles;

  // "Background" alone tells a user nothing when they are staring at six
  // swatches; "Background · White" does.
  const measured = (hex: string, role: string, bg?: string): ColorRole => ({
    hex,
    name: describeColor(hex) ? `${role} · ${describeColor(hex)}` : role,
    source: "measured",
    contrast_vs_background: bg && bg !== hex ? contrastRatio(hex, bg) : 0,
  });

  // -- Background: a heavily used colour at an extreme of the luminance range.
  //    Sites are overwhelmingly light-on-dark or dark-on-light; a mid-tone with
  //    the highest weight is usually a large hero image's overlay, not the ground.
  const byExtremity = palette
    .map((c) => ({ c, lum: relativeLuminance(c.hex) }))
    .filter(({ lum }) => lum > 0.75 || lum < 0.2)
    .sort((a, b) => {
      // A colour set as the background of body/html/:root IS the ground, even
      // when a hero section's colour is used more often across the stylesheet.
      const aGround = a.c.onGroundSelector ? 1 : 0;
      const bGround = b.c.onGroundSelector ? 1 : 0;
      if (aGround !== bGround) return bGround - aGround;

      // Then by how much of the colour's weight is BACKGROUND evidence, rather
      // than by a boolean "has any background-ish source" followed by raw
      // weight. On chowdeck.com both #000000 and #ffffff scored false on that
      // boolean, so it fell through to raw weight — and black, declared as a
      // custom property and painted on borders, took the background role on a
      // light site. Being used a lot is not the same as being the ground.
      if (a.c.backgroundWeight !== b.c.backgroundWeight) {
        return b.c.backgroundWeight - a.c.backgroundWeight;
      }
      if (a.c.sources.some((s) => BG_PROPERTY.test(s)) !== b.c.sources.some((s) => BG_PROPERTY.test(s))) {
        return a.c.sources.some((s) => BG_PROPERTY.test(s)) ? -1 : 1;
      }
      return b.c.weight - a.c.weight;
    });

  const background = byExtremity[0]?.c;
  if (!background) return roles;

  // Was this actually OBSERVED as a background, or is it the best guess among
  // extreme-luminance colours?
  //
  // Plenty of real sites never declare a page background in any stylesheet we
  // can attribute — it arrives from a utility class on a wrapper, or from the
  // browser default. Calling that guess "measured" puts a fabricated fact in
  // the user's brand kit, which is exactly what this module exists to stop. The
  // role is still assigned, because the rest of the palette is computed against
  // it and an empty kit helps nobody — but it is labelled for what it is.
  // ONLY a background declared on body/html/:root proves the page ground.
  //
  // "It is used as a background somewhere" is not the same claim: a hero panel,
  // a card and a badge are all backgrounds, and on chowdeck.com the most
  // heavily used of them is a dark green section on a light page. Background
  // weight is good enough to RANK candidates — it correctly demotes a colour
  // that only ever paints borders — but it cannot promote a panel to being the
  // ground, so it does not get to call the result measured.
  const groundObserved = background.onGroundSelector;
  roles.background = {
    hex: background.hex,
    name: describeColor(background.hex) ? `Background · ${describeColor(background.hex)}` : "Background",
    source: groundObserved ? "measured" : "inferred",
    contrast_vs_background: 0,
  };
  if (!groundObserved) {
    notes?.push(
      `The site never declares a page background colour in a stylesheet we can read, so `
      + `${background.hex} is this importer's best guess at the ground rather than a measured `
      + `fact. Worth confirming before it is used to tint anything.`,
    );
  }
  const bgHex = background.hex;
  const bgLum = relativeLuminance(bgHex);

  // -- Surface: the next extreme colour on the SAME side of the range.
  const surface = byExtremity
    .slice(1)
    .find(({ lum }) => (bgLum > 0.5 ? lum > 0.6 : lum < 0.3))?.c;
  if (surface) roles.surface = measured(surface.hex, "Surface", bgHex);

  // -- Text: highest contrast against the background that actually passes.
  const textCandidates = palette
    .filter((c) => c.hex !== bgHex)
    .map((c) => ({ c, ratio: contrastRatio(c.hex, bgHex) }))
    .filter(({ ratio }) => ratio >= MIN_TEXT_CONTRAST)
    .sort((a, b) => b.ratio - a.ratio);

  const textPrimary =
    textCandidates.find(({ c }) => c.sources.includes("color")) ?? textCandidates[0];
  if (textPrimary) {
    roles.text_primary = measured(textPrimary.c.hex, "Text", bgHex);
    const secondary = textCandidates.find(
      ({ c }) => c.hex !== textPrimary.c.hex && saturationOf(c.hex) < 0.3,
    );
    if (secondary) roles.text_secondary = measured(secondary.c.hex, "Muted text", bgHex);
  }

  // -- Accent: the most saturated colour with real structural weight. A brand's
  //    accent is by definition the colour that is NOT the neutral ground.
  const accent = palette
    .filter((c) => c.hex !== bgHex && c.hex !== roles.text_primary?.hex)
    .map((c) => ({ c, score: saturationOf(c.hex) * Math.log2(1 + c.weight) }))
    .filter(({ c }) => saturationOf(c.hex) > 0.15)
    .sort((a, b) => {
      const aCta = a.c.sources.some((s) => CTA_PROPERTY.test(s)) ? 1 : 0;
      const bCta = b.c.sources.some((s) => CTA_PROPERTY.test(s)) ? 1 : 0;
      if (aCta !== bCta) return bCta - aCta;
      return b.score - a.score;
    })[0]?.c;

  if (accent) {
    roles.accent = measured(accent.hex, "Accent", bgHex);
    roles.cta_bg = measured(accent.hex, "Button", bgHex);
    // Whichever of black/white is legible ON the button. Computed, because a
    // mid-tone accent takes white and a pale one does not, and getting this
    // wrong produces an unreadable call to action.
    const onWhite = contrastRatio("#ffffff", accent.hex);
    const onBlack = contrastRatio("#111111", accent.hex);
    const ctaText = onWhite >= onBlack ? "#ffffff" : "#111111";
    roles.cta_text = {
      hex: ctaText,
      name: `Button text · ${describeColor(ctaText)}`,
      // Derived from the accent, not read off the site — labelled honestly.
      source: "inferred",
      contrast_vs_background: contrastRatio(ctaText, bgHex),
    };
  }

  // -- Border: a low-contrast neutral, which is what a hairline actually is.
  const border = palette.find(
    (c) =>
      c.hex !== bgHex &&
      saturationOf(c.hex) < 0.2 &&
      contrastRatio(c.hex, bgHex) > 1.1 &&
      contrastRatio(c.hex, bgHex) < 3,
  );
  if (border) roles.border = measured(border.hex, "Border", bgHex);

  return roles;
}

// ── Structured identity ──────────────────────────────────────────────────────

export function readJsonLdOrganization(htmlByUrl: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const interesting = ["name", "legalName", "description", "slogan", "email", "telephone", "foundingDate", "logo", "url"];

  const absorb = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) absorb(child);
      return;
    }
    const record = node as Record<string, unknown>;
    const type = String(record["@type"] ?? "");
    if (Array.isArray(record["@graph"])) absorb(record["@graph"]);

    if (!/Organization|LocalBusiness|Corporation|Store|Restaurant|Brand/i.test(type)) return;

    for (const key of interesting) {
      const value = record[key];
      if (out[key]) continue;
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
      else if (key === "logo" && value && typeof value === "object") {
        const url = (value as Record<string, unknown>).url;
        if (typeof url === "string") out.logo = url;
      }
    }

    const address = record.address;
    if (address && typeof address === "object" && !out.address) {
      const a = address as Record<string, unknown>;
      const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
        .map((k) => (typeof a[k] === "string" ? String(a[k]).trim() : ""))
        .filter(Boolean);
      if (parts.length) out.address = parts.join(", ");
    }

    if (Array.isArray(record.sameAs)) {
      const links = record.sameAs.filter((s): s is string => typeof s === "string");
      if (links.length) out.sameAs = links.join(" ");
    }
  };

  for (const html of htmlByUrl.values()) {
    for (const m of html.matchAll(
      /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        absorb(JSON.parse(m[1].trim()));
      } catch {
        // Malformed JSON-LD is very common and never worth failing an import over.
      }
    }
  }

  return out;
}

export function readSocialHandles(htmlByUrl: Map<string, string>): Record<string, string> {
  const handles: Record<string, string> = {};
  for (const [pageUrl, html] of htmlByUrl) {
    for (const href of attrValues(stripNoise(html), "a", "href")) {
      const resolved = absolute(href, pageUrl);
      if (!resolved) continue;
      const found = socialHandleFrom(resolved);
      if (found && !handles[found.platform]) handles[found.platform] = found.handle;
    }
  }
  return handles;
}

function readContact(
  htmlByUrl: Map<string, string>,
  organization: Record<string, string>,
  siteUrl: string,
): HarvestResult["contact"] {
  let email = organization.email ?? "";
  let phone = organization.telephone ?? "";

  for (const [pageUrl, html] of htmlByUrl) {
    for (const href of attrValues(stripNoise(html), "a", "href")) {
      const value = href.trim();
      if (!email && /^mailto:/i.test(value)) {
        email = value.replace(/^mailto:/i, "").split("?")[0].trim();
      }
      if (!phone && /^tel:/i.test(value)) {
        phone = value.replace(/^tel:/i, "").trim();
      }
    }
    if (email && phone) break;
    void pageUrl;
  }

  return {
    email,
    phone,
    address: organization.address ?? "",
    website: new URL(siteUrl).origin,
  };
}

// ── Logo candidates ──────────────────────────────────────────────────────────

/** PNG alpha detection from the IHDR colour-type byte; null when undecidable. */
export function detectAlpha(bytes: Uint8Array, contentType: string): boolean | null {
  if (/svg/i.test(contentType)) return true; // vector marks are transparent by nature
  const isPng =
    bytes.length > 26 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    const colourType = bytes[25];
    return colourType === 4 || colourType === 6;
  }
  if (/jpe?g/i.test(contentType)) return false; // JPEG has no alpha channel
  return null;
}

async function collectLogos(
  htmlByUrl: Map<string, string>,
  organization: Record<string, string>,
  notes: string[],
  budgetLeft: () => number,
): Promise<LogoCandidate[]> {
  const seen = new Set<string>();
  const wanted: Array<{ url: string; origin: LogoCandidate["origin"] }> = [];

  const add = (href: string, base: string, source: LogoCandidate["origin"]) => {
    const resolved = absolute(href, base);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    wanted.push({ url: resolved, origin: source });
  };

  if (organization.logo) add(organization.logo, [...htmlByUrl.keys()][0], "json-ld");

  for (const [pageUrl, html] of htmlByUrl) {
    const clean = stripNoise(html);

    for (const tag of openingTags(clean, "link")) {
      const rel = attrOf(tag, "rel").toLowerCase();
      const href = attrOf(tag, "href");
      if (!href) continue;
      if (rel.includes("apple-touch-icon")) add(href, pageUrl, "apple-touch-icon");
      else if (rel.includes("icon")) add(href, pageUrl, "favicon");
    }

    const og = metaContent(clean, ["og:image", "twitter:image"]);
    if (og) add(og, pageUrl, "og:image");

    // An <img> whose src, alt or class says "logo" is the site telling us.
    for (const tag of openingTags(clean, "img")) {
      const haystack = `${attrOf(tag, "src")} ${attrOf(tag, "alt")} ${attrOf(tag, "class")}`.toLowerCase();
      if (!/logo|wordmark|brandmark/.test(haystack)) continue;
      const src = attrOf(tag, "src") || attrOf(tag, "data-src");
      if (src) add(src, pageUrl, "header-img");
    }
  }

  const candidates: LogoCandidate[] = [];
  for (const entry of wanted) {
    if (candidates.length >= MAX_LOGO_CANDIDATES) break;
    if (budgetLeft() < 8_000) {
      notes.push("Time budget reached before every logo candidate was downloaded.");
      break;
    }
    try {
      const file = await safeFetch(entry.url, {
        maxBytes: LOGO_MAX_BYTES,
        timeoutMs: 8_000,
        expectContentType: /image\//i,
        context: "siteHarvest.logo",
      });
      candidates.push({
        url: file.finalUrl,
        origin: entry.origin,
        contentType: file.contentType,
        bytes: file.bytes.byteLength,
        hasAlpha: detectAlpha(file.bytes, file.contentType),
      });
    } catch (err) {
      notes.push(`Could not download logo candidate ${entry.url}: ${errText(err)}`);
    }
  }

  return candidates;
}

// ── The evidence document ────────────────────────────────────────────────────

/**
 * The text handed to the extractor.
 *
 * Structured and labelled on purpose. The previous input was undifferentiated
 * prose, which invited the model to treat everything as equally uncertain and
 * therefore equally open to improvement. Here, measurement and prose are
 * visibly different kinds of thing, and the instruction at the top says which
 * of them the model is allowed to touch.
 */
export function buildEvidenceDocument(result: HarvestResult): string {
  const lines: string[] = [];

  lines.push(
    "BRAND SOURCE: the client's own website, read directly.",
    "",
    "This document has two kinds of content and they must be treated differently.",
    "",
    "MEASURED sections were read out of the site's own files — its stylesheets, its",
    "structured data, its markup. They are FACTS about this brand.",
    "  - Reproduce every measured value EXACTLY. Never substitute a nearby colour,",
    "    never round a hex, never rename a font, never 'improve' one.",
    "  - If a measured value is present, it overrides anything you would infer.",
    "",
    "PAGE CONTENT is prose. Infer voice, audience, positioning and restrictions from",
    "it as usual.",
    "",
    `SITE: ${result.siteUrl}`,
    `PAGES READ (${result.pagesHarvested.length}): ${result.pagesHarvested.join(", ")}`,
    "",
  );

  if (result.measuredPalette.length > 0) {
    lines.push("── MEASURED COLOURS (from the site's CSS) ──");
    for (const color of result.measuredPalette.slice(0, 12)) {
      const origin = color.fromCustomProperty ? "CSS variable" : "declaration";
      lines.push(
        `  ${color.hex}  used ${color.count}x (weight ${color.weight}, ${origin}) on: ${color.sources.join(", ")}`,
      );
    }
    lines.push("");
  } else {
    lines.push("── MEASURED COLOURS: none. No stylesheet was readable. ──", "");
  }

  const roleEntries = Object.entries(result.colorRoles);
  if (roleEntries.length > 0) {
    lines.push("── COLOUR ROLES (assigned by contrast arithmetic, not by guesswork) ──");
    for (const [role, value] of roleEntries) {
      const contrast = value.contrast_vs_background
        ? `, ${value.contrast_vs_background}:1 against the background`
        : "";
      lines.push(`  ${role}: ${value.hex} (${value.source}${contrast})`);
    }
    lines.push("");
  }

  if (result.measuredFonts.all.length > 0) {
    lines.push("── MEASURED TYPEFACES ──");
    if (result.measuredFonts.display) {
      lines.push(`  display: ${result.measuredFonts.display.family} (via ${result.measuredFonts.display.evidence})`);
    }
    if (result.measuredFonts.body) {
      lines.push(`  body: ${result.measuredFonts.body.family} (via ${result.measuredFonts.body.evidence})`);
    }
    const others = result.measuredFonts.all
      .filter((f) => f !== result.measuredFonts.display && f !== result.measuredFonts.body)
      .slice(0, 4);
    if (others.length) {
      lines.push(`  also present: ${others.map((f) => f.family).join(", ")}`);
    }
    lines.push("");
  }

  if (Object.keys(result.organization).length > 0) {
    lines.push("── MEASURED ORGANISATION (from JSON-LD structured data) ──");
    for (const [key, value] of Object.entries(result.organization)) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
  }

  const contactParts = Object.entries(result.contact).filter(([, v]) => v);
  if (contactParts.length > 0) {
    lines.push("── MEASURED CONTACT ──");
    for (const [key, value] of contactParts) lines.push(`  ${key}: ${value}`);
    lines.push("");
  }

  if (Object.keys(result.socialHandles).length > 0) {
    lines.push("── MEASURED SOCIAL HANDLES ──");
    for (const [platform, handle] of Object.entries(result.socialHandles)) {
      lines.push(`  ${platform}: @${handle}`);
    }
    lines.push("");
  }

  if (result.logoCandidates.length > 0) {
    lines.push("── LOGO FILES FOUND (downloaded, awaiting the user's confirmation) ──");
    for (const logo of result.logoCandidates) {
      lines.push(`  ${logo.origin}: ${logo.url} (${logo.contentType}, ${logo.bytes} bytes)`);
    }
    lines.push("");
  }

  lines.push("── PAGE CONTENT ──");
  const header = lines.join("\n");
  let remaining = MAX_EVIDENCE_CHARS - header.length;

  const pageBlocks: string[] = [];
  for (const page of result.pages) {
    if (remaining <= 200) break;
    const block = [
      "",
      `PAGE: ${page.url}`,
      page.title ? `Title: ${page.title}` : "",
      page.metaDescription ? `Description: ${page.metaDescription}` : "",
      page.headings.length ? `Headings:\n  ${page.headings.slice(0, 12).join("\n  ")}` : "",
      page.text ? `Text: ${page.text}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const clipped = block.slice(0, remaining);
    pageBlocks.push(clipped);
    remaining -= clipped.length;
  }

  return `${header}${pageBlocks.join("\n")}`;
}
