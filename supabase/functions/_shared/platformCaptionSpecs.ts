// supabase/functions/_shared/platformCaptionSpecs.ts
// Edge-function mirror of src/services/platforms/platformCaptionSpecs.js.
// Publish-side source of truth for how each platform's caption/title map onto
// the Zernio create-post contract. Keep the two files in sync.
//
// Zernio field contract (confirmed 2026-07-20 against docs.zernio.com/platforms/*):
//   - Every platform entry takes a top-level `content` field.
//   - TikTok VIDEO: content = caption (<=2200).
//   - TikTok PHOTO/CAROUSEL: content = TITLE (<=90); the full caption goes in
//     tiktokSettings.description (<=4000). (Previously we only sent the
//     truncated content and dropped the caption — the bug being fixed.)
//   - YouTube: platformSpecificData.title (<=100) + content = description (<=5000).
//   - Pinterest: platformSpecificData.title (<=100) + content = description
//     (<=500) + platformSpecificData.boardId (required — not collected yet, so
//     Pinterest publish is intentionally skipped upstream for now).
//   - Instagram / Facebook / LinkedIn / X / Threads: content = caption only.

export type PlatformCaptionSpec = {
  label: string;
  captionMax: number;
  titleMax?: number;
  // Platforms with an always-separate title (YouTube, Pinterest).
  titleField?: boolean;
  // Platforms whose title only applies for certain media (TikTok: photo only).
  titleForMedia?: Array<"image" | "carousel" | "video">;
  // Where the title lives on the Zernio payload, when there is one.
  titleTarget?: "content" | "platformSpecificData" | "tiktokSettings";
  // Where the caption/description body lives.
  captionTarget: "content" | "tiktokSettings.description";
};

const SPECS: Record<string, PlatformCaptionSpec> = {
  instagram: { label: "Instagram", captionMax: 2200, captionTarget: "content" },
  tiktok: {
    label: "TikTok", captionMax: 2200, titleMax: 90,
    titleForMedia: ["image", "carousel"],
    // For photo posts the title is `content`; the caption moves to
    // tiktokSettings.description. For video, content is just the caption.
    titleTarget: "content", captionTarget: "content",
  },
  youtube: {
    label: "YouTube", captionMax: 5000, titleField: true, titleMax: 100,
    titleTarget: "platformSpecificData", captionTarget: "content",
  },
  facebook: { label: "Facebook", captionMax: 63206, captionTarget: "content" },
  linkedin: { label: "LinkedIn", captionMax: 3000, captionTarget: "content" },
  twitter: { label: "X", captionMax: 280, captionTarget: "content" },
  x: { label: "X", captionMax: 280, captionTarget: "content" },
  pinterest: {
    label: "Pinterest", captionMax: 500, titleField: true, titleMax: 100,
    titleTarget: "platformSpecificData", captionTarget: "content",
  },
  threads: { label: "Threads", captionMax: 500, captionTarget: "content" },
};

const DEFAULT_SPEC: PlatformCaptionSpec = { label: "Post", captionMax: 2200, captionTarget: "content" };

export function getPlatformCaptionSpec(platform: string): PlatformCaptionSpec {
  return SPECS[String(platform || "").trim().toLowerCase()] || DEFAULT_SPEC;
}

export function normalizeMediaType(mediaType: string | null | undefined): "image" | "carousel" | "video" {
  const m = String(mediaType || "image").toLowerCase();
  if (m.includes("video")) return "video";
  if (m.includes("carousel")) return "carousel";
  return "image";
}

export function platformNeedsTitle(platform: string, mediaType: string | null | undefined): boolean {
  const spec = getPlatformCaptionSpec(platform);
  if (spec.titleField) return true;
  if (spec.titleForMedia) return spec.titleForMedia.includes(normalizeMediaType(mediaType));
  return false;
}
