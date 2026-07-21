// src/services/platforms/platformCaptionSpecs.js
// Single source of truth (frontend) for how each platform accepts caption /
// title / hashtag text, so the Post Production "fit strip" can check a caption
// against each selected platform's real limits WITHOUT any AI/LLM call.
//
// Researched 2026-07-20 against the platforms and the Zernio publish contract:
//   - Only YouTube, Pinterest, and TikTok-photo posts have a real, separate
//     TITLE. Everyone else is caption-only.
//   - The publish-side field mapping (which field carries the title vs the
//     caption on Zernio) lives in supabase/functions/_shared/platformCaptionSpecs.ts,
//     the edge-function mirror of this file. Keep the two in sync.
//
// This file intentionally does NO rewriting for voice/tone — that's the
// deferred, paid v2. It only measures FIT (length, title requirement) and
// offers a deterministic, credit-free auto-fit (trim at a sentence/word
// boundary) so a caption never silently breaks on a platform like X.

// captionMax  — hard cap on the caption/description body for that platform.
// titleField  — true when the platform takes a distinct title the user should
//               provide (YouTube/Pinterest always; TikTok only for photo posts,
//               handled via titleForMedia below).
// titleMax    — cap on that title, when applicable.
// hashtagMax  — soft ceiling used only for a gentle "too many hashtags" hint;
//               never auto-strips.
// titleForMedia — when set, the title only applies for these media types
//               (TikTok: photo/image posts get a 90-char title; video posts
//               are caption-only).
const SPECS = {
  instagram: { label: "Instagram", captionMax: 2200, hashtagMax: 30 },
  tiktok:    { label: "TikTok",    captionMax: 2200, hashtagMax: 8, titleMax: 90, titleForMedia: ["image", "carousel"] },
  youtube:   { label: "YouTube",   captionMax: 5000, hashtagMax: 15, titleField: true, titleMax: 100 },
  facebook:  { label: "Facebook",  captionMax: 63206, hashtagMax: 6 },
  linkedin:  { label: "LinkedIn",  captionMax: 3000, hashtagMax: 8 },
  twitter:   { label: "X",         captionMax: 280,  hashtagMax: 4 },
  x:         { label: "X",         captionMax: 280,  hashtagMax: 4 },
  pinterest: { label: "Pinterest", captionMax: 500,  hashtagMax: 8, titleField: true, titleMax: 100 },
  threads:   { label: "Threads",   captionMax: 500,  hashtagMax: 5 },
};

const DEFAULT_SPEC = { label: "Post", captionMax: 2200, hashtagMax: 30 };

export function getPlatformSpec(platform) {
  const key = String(platform || "").trim().toLowerCase();
  return SPECS[key] || DEFAULT_SPEC;
}

// Does this platform expect a separate title for the given media type?
// mediaType: "image" | "carousel" | "video" | "edit" | undefined
export function platformNeedsTitle(platform, mediaType) {
  const spec = getPlatformSpec(platform);
  if (spec.titleField) return true; // always-title platforms (YouTube, Pinterest)
  if (spec.titleForMedia) {
    const m = String(mediaType || "image").toLowerCase();
    const normalized = m.includes("video") ? "video" : m.includes("carousel") ? "carousel" : "image";
    return spec.titleForMedia.includes(normalized);
  }
  return false;
}

// Full text that will actually be published as the caption/description, i.e.
// caption + hashtags the way the publisher joins them — used for the fit check
// so the count reflects what really gets sent, not just the caption box.
export function buildCaptionForCount(caption, hashtags) {
  const cap = String(caption || "");
  const tags = Array.isArray(hashtags)
    ? hashtags.map((t) => String(t || "").trim()).filter(Boolean).join(" ")
    : String(hashtags || "");
  return tags ? `${cap}\n\n${tags}` : cap;
}

// Evaluate one platform's fit for a given caption/hashtags/title/media.
// Returns { platform, label, captionLen, captionMax, captionOver, needsTitle,
//           titleLen, titleMax, titleOver, titleMissing, hashtagCount,
//           hashtagOver, ok }.
export function evaluatePlatformFit({ platform, caption, hashtags, title, mediaType }) {
  const spec = getPlatformSpec(platform);
  const fullCaption = buildCaptionForCount(caption, hashtags);
  const captionLen = [...fullCaption].length; // code-point count (emoji-safe-ish)
  const captionOver = captionLen > spec.captionMax;

  const needsTitle = platformNeedsTitle(platform, mediaType);
  const titleStr = String(title || "").trim();
  const titleLen = [...titleStr].length;
  const titleMax = spec.titleMax || null;
  const titleOver = Boolean(needsTitle && titleMax && titleLen > titleMax);
  const titleMissing = Boolean(needsTitle && !titleStr);

  const hashtagCount = Array.isArray(hashtags)
    ? hashtags.filter((t) => String(t || "").trim()).length
    : 0;
  const hashtagOver = hashtagCount > spec.hashtagMax;

  const ok = !captionOver && !titleOver && !titleMissing && !hashtagOver;

  return {
    platform: String(platform || "").toLowerCase(),
    label: spec.label,
    captionLen, captionMax: spec.captionMax, captionOver,
    needsTitle, titleLen, titleMax, titleOver, titleMissing,
    hashtagCount, hashtagMax: spec.hashtagMax, hashtagOver,
    ok,
  };
}

// Deterministic, credit-free trim of a caption to fit a platform's cap. Trims
// at a sentence boundary first, then a word boundary, then hard-cuts — always
// leaving room for an ellipsis. Does NOT touch hashtags (caller decides whether
// to keep them); the length target here is the CAPTION body only.
export function autoFitCaption(caption, platform) {
  const spec = getPlatformSpec(platform);
  const max = spec.captionMax;
  const text = String(caption || "");
  if ([...text].length <= max) return text;

  const budget = Math.max(1, max - 1); // leave room for ellipsis
  const sliced = [...text].slice(0, budget).join("");

  // Prefer a clean sentence end within the last 40% of the budget.
  const sentenceEnd = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("! "), sliced.lastIndexOf("? "));
  if (sentenceEnd > budget * 0.6) {
    return sliced.slice(0, sentenceEnd + 1).trim();
  }
  // Otherwise trim at the last word boundary.
  const wordEnd = sliced.lastIndexOf(" ");
  const base = wordEnd > budget * 0.6 ? sliced.slice(0, wordEnd) : sliced;
  return `${base.trim()}…`;
}
