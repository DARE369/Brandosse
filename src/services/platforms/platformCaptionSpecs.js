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
// requiresMedia — the platform will not accept a text-only post, so a composer
//               must refuse to submit without an attached asset.
//
//               These values MIRROR THE ADAPTERS, which remain the enforcement
//               point — this flag only moves the refusal forward to where the
//               user can still act on it. Verified 2026-09-12:
//                 youtube   — _shared/youtube.service.ts:234 "YouTube requires
//                             a video. This post has no media attached."
//                 tiktok    — _shared/tiktok.service.ts:184, same shape.
//                 linkedin  — _shared/linkedin.service.ts:241 refuses only when
//                             caption AND media are both empty, so a text-only
//                             post is legal: requiresMedia stays false.
//                 instagram — no direct adapter yet, but every Instagram
//                             publish is a media container; a text-only
//                             Instagram post does not exist.
//                 facebook  — no direct adapter yet; a text-only Page post is
//                             valid, so this stays false.
//               When an adapter's media rule changes, change it here in the
//               same commit.
// acceptsMedia — which media types the platform will actually take. Distinct
//               from requiresMedia: that says "a text-only post is refused";
//               this says "and of the media you have, only these work".
//
//               Without it the Library can only ask "does this asset have a
//               file", not "can any connected account receive THIS file" — so a
//               still image offers a Publish button against a video-only
//               account and fails at send time.
//
//               MIRRORS THE ADAPTERS, which remain the enforcement point.
//               Verified 2026-09-13 by reading them:
//                 youtube   — _shared/youtube.service.ts:237 refuses without
//                             media with "YouTube requires a video", and the
//                             upload sends video/mp4 (:305). Video only.
//                 tiktok    — the whole adapter is the VIDEO init endpoint
//                             (/post/publish/video/init/, :37) with a video/mp4
//                             body (:309). Photo posts are a different endpoint
//                             needing a verified pull domain (:18-22).
//                 linkedin  — only uploadImage() exists (:117). There is NO
//                             video upload path in this adapter, so images
//                             only — and text-only stays legal (:241).
//                 instagram — DOCS-grade, adapter not built. Container-based;
//                             image or video, JPEG only for stills.
//                 facebook  — DOCS-grade, adapter not built.
//               When an adapter gains or loses a media path, change it here in
//               the same commit.
const SPECS = {
  instagram: { label: "Instagram", captionMax: 2200, hashtagMax: 30, requiresMedia: true, acceptsMedia: ["image", "video"] },
  tiktok:    { label: "TikTok",    captionMax: 2200, hashtagMax: 8, titleMax: 90, titleForMedia: ["image", "carousel"], requiresMedia: true, acceptsMedia: ["video"] },
  youtube:   { label: "YouTube",   captionMax: 5000, hashtagMax: 15, titleField: true, titleMax: 100, requiresMedia: true, acceptsMedia: ["video"] },
  facebook:  { label: "Facebook",  captionMax: 63206, hashtagMax: 6, acceptsMedia: ["image", "video"] },
  linkedin:  { label: "LinkedIn",  captionMax: 3000, hashtagMax: 8, acceptsMedia: ["image"] },
  twitter:   { label: "X",         captionMax: 280,  hashtagMax: 4, acceptsMedia: ["image", "video"] },
  x:         { label: "X",         captionMax: 280,  hashtagMax: 4, acceptsMedia: ["image", "video"] },
  pinterest: { label: "Pinterest", captionMax: 500,  hashtagMax: 8, titleField: true, titleMax: 100, requiresMedia: true, acceptsMedia: ["image", "video"] },
  threads:   { label: "Threads",   captionMax: 500,  hashtagMax: 5, acceptsMedia: ["image", "video"] },
};

const DEFAULT_SPEC = { label: "Post", captionMax: 2200, hashtagMax: 30 };

export function getPlatformSpec(platform) {
  const key = String(platform || "").trim().toLowerCase();
  return SPECS[key] || DEFAULT_SPEC;
}

// Does this platform refuse a text-only post?
//
// The adapter refuses too, and that refusal is the one that actually protects
// the publish. This exists so the refusal can happen while the user is still
// looking at the composer, instead of arriving as a failed post later.
export function platformRequiresMedia(platform) {
  return getPlatformSpec(platform).requiresMedia === true;
}

// Of the given platforms, which would reject a post with no media attached?
// Returns labels rather than keys because every caller puts these straight in
// front of a person.
export function platformsRequiringMedia(platforms) {
  const seen = new Set();
  const out = [];
  for (const p of platforms || []) {
    const key = String(p || "").trim().toLowerCase();
    if (!key || seen.has(key) || !platformRequiresMedia(key)) continue;
    seen.add(key);
    out.push(getPlatformSpec(key).label);
  }
  return out;
}

/**
 * Which of these platforms REFUSE this media type, and what each takes instead.
 *
 * The sibling of platformsRequiringMedia: that one answers "this post has no
 * media at all", this one answers "it has media of the wrong kind". Both must
 * gate the same button.
 *
 * Found live 2026-09-23: an image was sent to TikTok from the Library. TikTok
 * uploads video only, so the adapter refused it with "supabase.co returned
 * image/jpeg, which is not what was expected" — accurate, unreadable, and
 * discovered only after the user pressed publish. acceptsMedia already said so;
 * the composer simply never asked.
 *
 * An unknown media type returns NO mismatch: "we cannot tell yet" must not read
 * as "this is wrong", and the adapters still refuse for real at send time.
 *
 * @param {string[]} platforms  platform keys the post targets
 * @param {string|null} mediaType  'image' | 'video' | null/unknown
 * @returns {{key: string, label: string, takes: string}[]}
 */
export function platformsRefusingMediaType(platforms, mediaType) {
  const type = String(mediaType || "").trim().toLowerCase();
  if (!type) return [];

  const seen = new Set();
  const out = [];
  for (const p of platforms || []) {
    const key = String(p || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const spec = getPlatformSpec(key);
    // No acceptsMedia listed means the platform was never assessed. Say
    // nothing rather than invent a refusal.
    if (!spec || !Array.isArray(spec.acceptsMedia)) continue;
    if (spec.acceptsMedia.includes(type)) continue;
    out.push({ key, label: spec.label || key, takes: spec.acceptsMedia.join(" or ") });
  }
  return out;
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
