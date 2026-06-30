// src/services/contentPlanValidator.js

/**
 * Validates a raw ContentPlan from Groq and auto-repairs missing/invalid fields.
 * Returns { plan: ContentPlan, repairLog: string[] }
 */
export function validateAndRepairPlan(raw) {
  const repairLog = [];
  const plan = { ...raw };

  // ── Required string fields → default to ""
  const requiredStrings = [
    'intent_summary', 'content_goal', 'primary_platform', 'content_type',
  ];
  for (const field of requiredStrings) {
    if (typeof plan[field] !== 'string' || plan[field] === null) {
      plan[field] = '';
      repairLog.push(`Repaired: ${field} was null/missing → ""`);
    }
  }

  // ── Arrays
  if (!Array.isArray(plan.platforms)) {
    plan.platforms = ['instagram'];
    repairLog.push('Repaired: platforms → ["instagram"]');
  }

  // ── SEO score
  if (typeof plan.seo?.score !== 'number') {
    plan.seo = plan.seo ?? {};
    plan.seo.score = 0;
    repairLog.push('Repaired: seo.score was not a number → 0');
  }

  // ── SEO score_category
  const scoreCategories = { Poor: 39, Ok: 59, Good: 79, Great: 100 };
  if (!['Poor', 'Ok', 'Good', 'Great'].includes(plan.seo?.score_category)) {
    const s = plan.seo.score;
    plan.seo.score_category =
      s <= 39 ? 'Poor' : s <= 59 ? 'Ok' : s <= 79 ? 'Good' : 'Great';
    repairLog.push('Repaired: seo.score_category derived from score');
  }

  // ── score_breakdown scores sum > 100 → normalize
  if (plan.seo?.score_breakdown) {
    const dims = Object.values(plan.seo.score_breakdown);
    const total = dims.reduce((acc, d) => acc + (d.score ?? 0), 0);
    if (total > 100) {
      const factor = 100 / total;
      for (const key of Object.keys(plan.seo.score_breakdown)) {
        plan.seo.score_breakdown[key].score = Math.round(
          (plan.seo.score_breakdown[key].score ?? 0) * factor
        );
      }
      repairLog.push('Repaired: score_breakdown scores normalized to ≤ 100');
    }
  }

  // ── Carousel: synthesize default if content_type === carousel but carousel missing
  if (plan.content_type === 'carousel' && !plan.carousel) {
    plan.carousel = {
      slide_count: 3,
      theme: plan.intent_summary || 'Brand content',
      slides: [
        { slide_index: 1, slide_purpose: 'hook',     headline: 'Attention-grabbing hook', image_prompt: `Bold hero image for ${plan.intent_summary || 'the brand'}, dramatic lighting, cinematic composition` },
        { slide_index: 2, slide_purpose: 'solution',  headline: 'The solution', image_prompt: `Clean product or solution reveal, minimal background, confident mood` },
        { slide_index: 3, slide_purpose: 'cta',       headline: 'Take action', image_prompt: `Minimal brand graphic with call-to-action space, brand color palette` },
      ],
    };
    repairLog.push('Repaired: carousel missing for carousel content_type → synthesized 3-slide default');
  }

  // ── visual_prompt: ensure slides array aligned to carousel slides
  if (!plan.visual_prompt?.slides?.length) {
    const slideCount = plan.carousel?.slides?.length ?? 1;
    plan.visual_prompt = {
      global_style: plan.visual_prompt?.global_style ?? 'professional photography',
      aspect_ratio:  plan.visual_prompt?.aspect_ratio ?? '1:1',
      slides: (plan.carousel?.slides ?? [null]).map((slide, i) => ({
        slide_index: i + 1,
        full_prompt: slide?.image_prompt ?? `Professional photo for ${plan.intent_summary || 'social media'}`,
        negative_prompt: '',
      })),
    };
    repairLog.push('Repaired: visual_prompt.slides was missing → generated from carousel.slides');
  }

  // ── hashtags.platform_sets: derive if missing
  if (!plan.hashtags?.platform_sets || typeof plan.hashtags.platform_sets !== 'object') {
    const allTags = [
      ...(plan.hashtags?.primary ?? []),
      ...(plan.hashtags?.niche ?? []),
      ...(plan.hashtags?.brand ?? []),
    ];
    plan.hashtags = plan.hashtags ?? {};
    plan.hashtags.platform_sets = {
      instagram: allTags.slice(0, 30),
      tiktok:    allTags.slice(0, 5),
      linkedin:  allTags.slice(0, 7),
      x:         allTags.slice(0, 3),
    };
    repairLog.push('Repaired: hashtags.platform_sets was missing → derived from primary+niche+brand');
  }

  // ── guardrails_check: default to pass if missing
  if (!plan.guardrails_check || typeof plan.guardrails_check !== 'object') {
    plan.guardrails_check = { pass: true, violations: [], notes: 'Default — not checked.' };
    repairLog.push('Repaired: guardrails_check missing → default pass');
  }

  // ── caption: ensure all required sub-fields
  plan.caption = plan.caption ?? {};
  if (!plan.caption.primary)             { plan.caption.primary = ''; repairLog.push('Repaired: caption.primary'); }
  if (!plan.caption.hook)                { plan.caption.hook    = ''; repairLog.push('Repaired: caption.hook'); }
  if (!plan.caption.cta)                 { plan.caption.cta     = ''; repairLog.push('Repaired: caption.cta'); }
  if (!plan.caption.platform_overrides)  { plan.caption.platform_overrides = {}; }

  // ── title
  plan.title = plan.title ?? {};
  if (!plan.title.generic)             { plan.title.generic = ''; repairLog.push('Repaired: title.generic'); }
  if (!plan.title.platform_overrides)  { plan.title.platform_overrides = {}; }

  // ── schema_version and generated_at
  if (!plan.schema_version) plan.schema_version = '1.0';
  if (!plan.generated_at)   plan.generated_at   = new Date().toISOString();

  return { plan, repairLog };
}
