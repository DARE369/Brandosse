// src/services/briefBuilder.js

/**
 * Assembles all context into a GenerationBrief object
 * that gets passed to groqClient.callGroqContentPlan().
 */
export function buildGenerationBrief({ userInput, clarifications, brandKit, history, settings }) {
  const intent_hints = {};

  if (clarifications?.content_goal)     intent_hints.content_goal     = clarifications.content_goal;
  if (clarifications?.primary_platform) intent_hints.primary_platform = clarifications.primary_platform;

  // Derive platform targets from brand kit preferences + clarifications
  const platform_targets = (() => {
    const fromKit = Object.keys(brandKit?.raw?.platform_preferences ?? {});
    const fromClarification = clarifications?.primary_platform
      ? [clarifications.primary_platform]
      : [];
    const merged = [...new Set([...fromClarification, ...fromKit])];
    return merged.length > 0 ? merged : ['instagram'];
  })();

  const aspect_ratio = settings.aspectRatio ?? '1:1';
  const requested_slide_count = settings.contentType === 'carousel'
    ? (
        settings.slideCount === 'auto'
          ? 'auto'
          : Math.max(2, Number(settings.slideCount) || 2)
      )
    : null;

  return {
    raw_input:        userInput,
    intent_hints,
    brand_summary:    brandKit?.summary ?? '',
    asset_context:    brandKit?.asset_context ?? '',
    history_summary:  history ?? '',
    platform_targets,
    content_type:     settings.contentType ?? 'single',
    media_type:       settings.mediaType    ?? 'image',
    aspect_ratio,
    requested_slide_count,
  };
}
