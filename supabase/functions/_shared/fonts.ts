/**
 * fonts.ts — resolve a brand's font family to real TTF bytes, in the edge runtime.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The brand kit stores `type_scale.display.family` — a NAME, like "Poppins".
 * resvg cannot use a name: it needs the font's actual bytes handed to it as a
 * buffer. Until this existed, brand typography could not reach a generated
 * graphic even in principle. Colour was branded; letterforms were not.
 *
 * This is the Deno counterpart of `video-worker/fonts.py`, which does the same
 * job for FFmpeg. Same source (the Google Fonts Developer API, which returns
 * direct TTF URLs), same failure posture, deliberately — two resolvers that
 * disagree about which file "Poppins" means would produce video and stills that
 * do not match.
 *
 * ── Why the Developer API and not the CSS endpoint ──────────────────────────
 * `fonts.googleapis.com/css2` serves **woff2**, which is a compressed container.
 * Neither resvg's font database nor `fontMetrics.ts` can read it. The Developer
 * API returns uncompressed TTF URLs, which both can.
 *
 * ── Failure posture, and why it differs from the worker's ───────────────────
 * The worker returns None and renders in a default face, because a video job
 * has already been paid for and must not fail over typography.
 *
 * Here the stakes are inverted. The spike run on 2026-09-02 confirmed that
 * resvg given no font buffer renders text as **zero pixels, with no error
 * thrown** — a blank, confident-looking graphic. So this module never returns a
 * "sort of" result: it returns bytes, or it returns null with a stated reason,
 * and the compositor treats null as "do not draw text at all" rather than
 * "draw text badly". See designCompositor.ts.
 */

import { safeFetch } from "./safeFetch.ts";

const WEBFONTS_API = "https://www.googleapis.com/webfonts/v1/webfonts";

const CATALOGUE_TIMEOUT_MS = 10_000;
const FONT_TIMEOUT_MS = 10_000;
const MAX_FONT_BYTES = 4 * 1024 * 1024;

/**
 * Module-level caches. Edge invocations are short-lived but warm containers are
 * reused, so this saves a catalogue fetch (~1,900 families) on most renders.
 * A cold start pays it once.
 */
let catalogueCache: Map<string, Record<string, string>> | null = null;
let cataloguePromise: Promise<Map<string, Record<string, string>> | null> | null = null;
const fontBytesCache = new Map<string, Uint8Array>();

export interface ResolvedFont {
  family: string;
  /** The variant actually used, which may not be the one asked for. */
  variant: string;
  bytes: Uint8Array;
  /** True when the requested weight was unavailable and a nearby one was used. */
  substituted: boolean;
}

export interface FontResolution {
  font: ResolvedFont | null;
  /** Always populated when font is null. Never a silent miss. */
  reason: string;
}

function apiKey(): string {
  // Accepts the worker's variable too, so a project that already has one key
  // configured does not need a second identical secret.
  return (
    Deno.env.get("GOOGLE_FONTS_API_KEY") ||
    Deno.env.get("WORKER_GOOGLE_FONTS_API_KEY") ||
    ""
  );
}

/** Family name -> { variant: ttfUrl }. Null when unavailable, never throws. */
async function loadCatalogue(): Promise<Map<string, Record<string, string>> | null> {
  if (catalogueCache) return catalogueCache;
  if (cataloguePromise) return cataloguePromise;

  const key = apiKey();
  if (!key) {
    // Not an error, and said once rather than on every render.
    console.warn("[fonts] catalogue_unavailable", {
      reason: "GOOGLE_FONTS_API_KEY is not set; brand typography cannot be applied to graphics",
    });
    return null;
  }

  cataloguePromise = (async () => {
    try {
      const url = `${WEBFONTS_API}?key=${encodeURIComponent(key)}&sort=popularity`;
      const response = await safeFetch(url, {
        timeoutMs: CATALOGUE_TIMEOUT_MS,
        maxBytes: 12 * 1024 * 1024,
        context: "fonts.catalogue",
      });
      const parsed = JSON.parse(new TextDecoder().decode(response.bytes));
      const items = Array.isArray(parsed?.items) ? parsed.items : [];

      const map = new Map<string, Record<string, string>>();
      for (const item of items) {
        const family = String(item?.family ?? "").trim();
        const files = item?.files;
        if (!family || !files || typeof files !== "object") continue;
        map.set(family.toLowerCase(), files as Record<string, string>);
      }

      if (map.size === 0) {
        console.warn("[fonts] catalogue_empty", { reason: "API returned no families" });
        return null;
      }
      catalogueCache = map;
      return map;
    } catch (error) {
      console.warn("[fonts] catalogue_fetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      cataloguePromise = null;
    }
  })();

  return cataloguePromise;
}

/**
 * Pick the closest available variant to a requested weight.
 *
 * Google's variant keys are "regular", "italic", "700", "700italic", etc. A
 * brand asking for 600 on a family that ships 500 and 700 should get 700, not
 * nothing — but the caller is told it was substituted, because a substitution
 * silently presented as the brand face is the same lie as the wrong colour.
 */
export function pickVariant(
  files: Record<string, string>,
  weight: number,
): { variant: string; url: string; substituted: boolean } | null {
  const available = Object.keys(files).filter((key) => !key.includes("italic"));
  if (available.length === 0) return null;

  const numeric = available
    .map((key) => ({ key, weight: key === "regular" ? 400 : Number(key) }))
    .filter((entry) => Number.isFinite(entry.weight));

  if (numeric.length === 0) {
    const key = available[0];
    return { variant: key, url: files[key], substituted: true };
  }

  const target = Number.isFinite(weight) ? weight : 400;
  let best = numeric[0];
  let bestDistance = Math.abs(best.weight - target);
  for (const entry of numeric) {
    const distance = Math.abs(entry.weight - target);
    // Ties go to the heavier face: a display line that is slightly too bold
    // still reads as deliberate; one that is too light reads as a mistake.
    if (distance < bestDistance || (distance === bestDistance && entry.weight > best.weight)) {
      best = entry;
      bestDistance = distance;
    }
  }

  return {
    variant: best.key,
    url: files[best.key],
    substituted: best.weight !== target,
  };
}

/**
 * Resolve a family name to TTF bytes.
 *
 * Returns `{ font: null, reason }` for every failure path. The reason is
 * surfaced in generation metadata so nobody is ever told they got brand
 * typography they did not get.
 */
export async function resolveFont(
  family: string,
  weight = 400,
): Promise<FontResolution> {
  const name = String(family ?? "").trim();
  if (!name) return { font: null, reason: "No font family was specified" };

  const cacheKey = `${name.toLowerCase()}::${weight}`;
  const cached = fontBytesCache.get(cacheKey);
  if (cached) {
    return { font: { family: name, variant: String(weight), bytes: cached, substituted: false }, reason: "" };
  }

  const catalogue = await loadCatalogue();
  if (!catalogue) {
    return {
      font: null,
      reason: apiKey()
        ? "The Google Fonts catalogue could not be reached"
        : "GOOGLE_FONTS_API_KEY is not set, so brand fonts cannot be downloaded",
    };
  }

  const files = catalogue.get(name.toLowerCase());
  if (!files) {
    return { font: null, reason: `"${name}" is not a Google Fonts family` };
  }

  const chosen = pickVariant(files, weight);
  if (!chosen) {
    return { font: null, reason: `"${name}" has no usable upright variant` };
  }

  try {
    const response = await safeFetch(chosen.url, {
      timeoutMs: FONT_TIMEOUT_MS,
      maxBytes: MAX_FONT_BYTES,
      context: "fonts.download",
    });

    // Sanity-check the container before it reaches resvg or the metrics parser:
    // a woff2 body served under a .ttf URL would otherwise fail much later, in a
    // place where the cause is far less obvious.
    const magic = response.bytes.subarray(0, 4);
    const isWoff = magic[0] === 0x77 && magic[1] === 0x4f && magic[2] === 0x46;
    if (isWoff) {
      return { font: null, reason: `"${name}" was served as WOFF, which cannot be rendered` };
    }
    if (response.bytes.byteLength < 1024) {
      return { font: null, reason: `"${name}" downloaded as an implausibly small file` };
    }

    fontBytesCache.set(cacheKey, response.bytes);
    return {
      font: {
        family: name,
        variant: chosen.variant,
        bytes: response.bytes,
        substituted: chosen.substituted,
      },
      reason: "",
    };
  } catch (error) {
    return {
      font: null,
      reason: `"${name}" could not be downloaded: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Test seam: drop caches so a guard can exercise a cold path. */
export function _resetFontCaches(): void {
  catalogueCache = null;
  cataloguePromise = null;
  fontBytesCache.clear();
}
