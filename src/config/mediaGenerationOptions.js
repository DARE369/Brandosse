// UI options for the Studio generate settings panel.
// Values here must match what the fal.ai-backed edge functions
// (generateImage, generateVideo, editImage) actually accept — see
// supabase/functions/_shared/fal.service.ts for the source of truth on
// models/params, and CREDITS_PER_IMAGE / CREDITS_STD_VIDEO / CREDITS_PRO_VIDEO /
// CREDITS_PER_EDIT in the respective edge functions for credit costs.

export const CONTENT_TYPES = [
  {
    id: 'image',
    label: 'Image',
    description: 'Single still or variant set',
    mediaType: 'image',
    contentType: 'single',
  },
  {
    id: 'carousel',
    label: 'Carousel',
    description: 'Ordered multi-slide image story',
    mediaType: 'image',
    contentType: 'carousel',
  },
  {
    id: 'video',
    label: 'Text to video',
    description: 'Text-to-video generation',
    mediaType: 'video',
    contentType: 'single',
  },
  {
    id: 'edit',
    label: 'Image edit',
    description: 'Edit an existing image with text',
    mediaType: 'edit',
    contentType: 'single',
  },
  {
    id: 'image-to-video',
    label: 'Frames to video',
    description: 'Animate a first-frame image',
    mediaType: 'image-to-video',
    contentType: 'single',
  },
];

export const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', hint: 'Feed square' },
  { id: '4:5', label: '4:5', hint: 'Instagram portrait' },
  { id: '9:16', label: '9:16', hint: 'Stories, Reels, TikTok' },
  { id: '16:9', label: '16:9', hint: 'YouTube, landscape' },
];

// fal.ai video models (Hailuo 2.3 / Kling 2.5 Pro) only accept 5 or 10
// second clips — no fps control, no per-model duration variance.
export const VIDEO_DURATIONS = [5, 10];

// "standard" renders on Hailuo 2.3 (image-to-video only); a standard
// text-to-video request with no source image is billed/rendered as
// "premium" instead (see generateVideo edge function). Surfacing both
// tiers here lets a user choose premium deliberately rather than being
// silently upgraded.
export const VIDEO_QUALITY_TIERS = [
  { id: 'standard', label: 'Standard', hint: 'Hailuo 2.3 — fast, image-to-video only · 5 credits' },
  { id: 'premium', label: 'Premium', hint: 'Kling 2.5 Pro — cinematic, works with or without a source image · 15 credits' },
];

export function getVideoDurations() {
  return VIDEO_DURATIONS;
}

// Credit costs mirrored from the edge functions (generateImage, generateVideo,
// editImage) — kept here only for the pre-generation cost estimate shown in
// the UI, not as a source of truth for actual billing.
const CREDITS_PER_IMAGE = 1;
const CREDITS_PER_EDIT = 3;
const CREDITS_STD_VIDEO = 5;
const CREDITS_PRO_VIDEO = 15;

export function estimateGenerationCost(settings = {}) {
  const mediaType = settings.mediaType || 'image';
  const contentType = settings.contentType || 'single';
  const batchSize = Math.max(1, Math.min(Number(settings.batchSize) || 1, 4));
  const slideCount = settings.slideCount === 'auto' ? 6 : Math.max(2, Number(settings.slideCount) || 2);
  const hasSourceImage = Boolean(settings.referenceImageUrl);

  if (mediaType === 'video' || mediaType === 'image-to-video') {
    const requestedQuality = settings.videoQuality === 'premium' ? 'premium' : 'standard';
    const willUpgrade = requestedQuality === 'standard' && !hasSourceImage;
    return willUpgrade || requestedQuality === 'premium' ? CREDITS_PRO_VIDEO : CREDITS_STD_VIDEO;
  }

  if (mediaType === 'edit') {
    return CREDITS_PER_EDIT;
  }

  const count = contentType === 'carousel' ? slideCount : batchSize;
  return CREDITS_PER_IMAGE * count;
}
