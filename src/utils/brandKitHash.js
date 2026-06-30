export function computeBrandKitHash(brandKit) {
  if (!brandKit) return 'none';

  const relevant = [
    brandKit.brand_name,
    brandKit.industry,
    brandKit.brand_voice,
    brandKit.target_audience,
    Array.isArray(brandKit.visual_style_keywords)
      ? brandKit.visual_style_keywords.join(',')
      : '',
  ].join('|');

  let hash = 0;
  for (let i = 0; i < relevant.length; i += 1) {
    hash = ((hash << 5) - hash) + relevant.charCodeAt(i);
    hash |= 0;
  }

  return String(Math.abs(hash));
}
