export const TIER_1_FIELDS = [
  { key: 'brand_name', label: 'Brand Name' },
  { key: 'brand_voice', label: 'Brand Voice' },
  { key: 'target_audience', label: 'Target Audience' },
  { key: 'forbidden_phrases', label: 'Forbidden Phrases' },
  { key: 'content_restrictions', label: 'Content Restrictions' },
];

export function isFilled(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return !Number.isNaN(value);
  return Boolean(String(value ?? '').trim());
}

export function getMissingTier1Fields(brandKit = {}) {
  return TIER_1_FIELDS.filter(({ key }) => !isFilled(brandKit[key]));
}

export function getHealthScore(brandKit = {}, fieldKeys = []) {
  if (!Array.isArray(fieldKeys) || fieldKeys.length === 0) return 0;

  let weightedMax = 0;
  let weightedFilled = 0;

  fieldKeys.forEach((key) => {
    const isTier1 = TIER_1_FIELDS.some((field) => field.key === key);
    const weight = isTier1 ? 2 : 1;
    weightedMax += weight;
    if (isFilled(brandKit[key])) weightedFilled += weight;
  });

  if (weightedMax === 0) return 0;
  return Math.round((weightedFilled / weightedMax) * 100);
}
