export const MAGNIFIC_CONTENT_TYPES = [
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

export const FAL_IMAGE_MODELS = [
  { id: 'ideogram', label: 'Ideogram V3', hint: 'Best for text, specs & posters (default)' },
  { id: 'recraft',  label: 'Recraft V3',  hint: 'Best for typography & brand assets' },
  { id: 'flux',     label: 'FLUX.2 Pro',  hint: 'Artistic & photorealistic scenes' },
];

export const MAGNIFIC_IMAGE_MODELS = [
  { id: 'seedream-v4-5', label: 'Seedream 4.5', hint: 'Best for marketing layouts, posters, and readable text' },
  { id: 'flux-2-pro', label: 'Flux 2 Pro', hint: 'Professional product, concept, and campaign visuals' },
  { id: 'realism', label: 'Mystic Realism', hint: 'Natural, photo-forward social content' },
  { id: 'fluid', label: 'Mystic Fluid', hint: 'Strong prompt adherence and creative scenes' },
  { id: 'zen', label: 'Mystic Zen', hint: 'Clean, smooth, simpler compositions' },
  { id: 'flexible', label: 'Mystic Flexible', hint: 'Illustrative and stylized creative range' },
  { id: 'super_real', label: 'Mystic Super Real', hint: 'Reality-priority medium shots' },
  { id: 'editorial_portraits', label: 'Editorial Portraits', hint: 'High-end portrait closeups' },
];

export const MAGNIFIC_VIDEO_MODELS = [
  { id: 'ltx-2-pro', label: 'LTX 2.0 Pro', hint: 'Text-to-video, up to 4K' },
];

export const MAGNIFIC_IMAGE_TO_VIDEO_MODELS = [
  { id: 'kling-v2-6-pro', label: 'Kling 2.6 Pro', hint: 'Strong first-frame motion and social video shots' },
  { id: 'ltx-2-pro-i2v', label: 'LTX 2.0 Pro I2V', hint: 'Use an image as the first frame' },
];

export const MAGNIFIC_EDIT_MODELS = [
  { id: 'seedream-v4-5-edit', label: 'Seedream 4.5 Edit', hint: 'Text-guided image editing' },
];

export const MAGNIFIC_ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', hint: 'Feed square' },
  { id: '4:5', label: '4:5', hint: 'Instagram portrait' },
  { id: '9:16', label: '9:16', hint: 'Stories, Reels, TikTok' },
  { id: '16:9', label: '16:9', hint: 'YouTube, landscape' },
];

export const MAGNIFIC_IMAGE_RESOLUTIONS = [
  { id: '1k', label: '1K' },
  { id: '2k', label: '2K' },
  { id: '4k', label: '4K' },
];

export const MAGNIFIC_VIDEO_RESOLUTIONS = [
  { id: '1080p', label: '1080p' },
  { id: '1440p', label: '1440p' },
  { id: '2160p', label: '2160p' },
];

export const MAGNIFIC_VIDEO_DURATIONS = [6, 8, 10];
export const MAGNIFIC_KLING_DURATIONS = [5, 10];
export const MAGNIFIC_VIDEO_FPS = [25, 50];

export function getMagnificModelsForMode(mode) {
  if (mode === 'video') return MAGNIFIC_VIDEO_MODELS;
  if (mode === 'image-to-video') return MAGNIFIC_IMAGE_TO_VIDEO_MODELS;
  if (mode === 'edit') return MAGNIFIC_EDIT_MODELS;
  return MAGNIFIC_IMAGE_MODELS;
}

export function getMagnificModelLabel(modelId) {
  const allModels = [
    ...FAL_IMAGE_MODELS,
    ...MAGNIFIC_IMAGE_MODELS,
    ...MAGNIFIC_VIDEO_MODELS,
    ...MAGNIFIC_IMAGE_TO_VIDEO_MODELS,
    ...MAGNIFIC_EDIT_MODELS,
  ];
  return allModels.find((model) => model.id === modelId)?.label || modelId || 'Selected model';
}

export function getVideoDurationsForModel(modelId) {
  return modelId === 'kling-v2-6-pro' ? MAGNIFIC_KLING_DURATIONS : MAGNIFIC_VIDEO_DURATIONS;
}

export function estimateMagnificCost(settings = {}) {
  const mediaType = settings.mediaType || 'image';
  const contentType = settings.contentType || 'single';
  const resolution = settings.resolution || (mediaType === 'video' ? '1080p' : '2k');
  const batchSize = Math.max(1, Math.min(Number(settings.batchSize) || 1, 4));
  const slideCount = settings.slideCount === 'auto' ? 6 : Math.max(2, Number(settings.slideCount) || 2);
  const duration = Number(settings.duration || 6);

  if (mediaType === 'video' || mediaType === 'image-to-video') {
    const resolutionMultiplier = resolution === '2160p' ? 2 : resolution === '1440p' ? 1.5 : 1;
    return Math.ceil(40 * resolutionMultiplier + Math.max(0, duration - 6) * 4);
  }

  if (mediaType === 'edit') {
    return resolution === '4k' ? 24 : 16;
  }

  const perImage = resolution === '4k' ? 30 : resolution === '1k' ? 10 : 18;
  const count = contentType === 'carousel' ? slideCount : batchSize;
  return perImage * count;
}
