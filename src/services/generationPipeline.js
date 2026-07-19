// src/services/generationPipeline.js
// CANONICAL GENERATION ORCHESTRATOR
// All generation (single, carousel, edit, video) flows through this file.
// ApiService.js caption/SEO helpers remain active for now (see Task 1C).
//
// The actual image generator is injected at call time via
// registerImageGenerator() — see src/stores/SessionStore.js, which registers
// a function backed by src/services/media.service.js (fal.ai).
import { supabase }                from '../services/supabaseClient';
import { GENERATION_STATUS }       from '../constants/statusEnums';
import { buildGenerationBrief }    from './briefBuilder';
import { callGroqContentPlan }     from './groqClient';
import { validateAndRepairPlan }   from './contentPlanValidator';
import { runQualityGate }          from './qualityGate';
import { loadBrandKit }            from './brandKitLoader';
import { loadUserHistory }         from './historyLoader';
import { triggerQualityGate }      from './media.service';

let _generateImage = null;
export function registerImageGenerator(fn) { _generateImage = fn; }
async function generateImage(prompt, aspectRatio, opts = {}) {
  if (!_generateImage) throw new Error('[Pipeline] No image generator registered. Call registerImageGenerator() first.');
  return _generateImage(prompt, aspectRatio, opts);
}

function normalizeGeneratedAsset(result) {
  if (typeof result === 'string') {
    return { url: result, metadata: {} };
  }

  if (!result || typeof result !== 'object') {
    return { url: '', metadata: {} };
  }

  return {
    url: result.url || result.publicUrl || '',
    metadata: {
      provider: result.provider || 'fal-ai',
      provider_task_id: result.providerTaskId || result.taskId || null,
      provider_model: result.providerModel || null,
      provider_endpoint: result.providerEndpoint || null,
      generation_time_ms: result.generationTimeMs || null,
      generation_cost: result.generationCost || null,
      storage_path: result.storagePath || null,
      width: result.width || null,
      height: result.height || null,
      resolution: result.resolution || null,
      format: result.format || 'image',
      // Reproducibility: the edge fn already wrote these onto the row via
      // completeGeneration, but the client's own row update below merges THIS
      // metadata on top — so carry them through here or the update silently
      // drops the seed/model the edge fn just wrote (0.2). Only overwrites the
      // row's value when the provider actually returned one (?? null keeps the
      // edge-fn write intact if the client didn't receive it).
      ...(result.seed != null ? { seed: result.seed } : {}),
      ...(result.imageModel ? { image_model: result.imageModel } : {}),
      ...(result.promptUsed ? { enhanced_prompt: result.promptUsed } : {}),
    },
  };
}

const HISTORY_WINDOW = 10;

// Maps the content plan's render_intent to a fal image model (1.1). The
// content-plan LLM picks render_intent from what the image needs (photo /
// text_graphic / vector_design); this turns that into the concrete model the
// generateImage edge fn routes on. FLUX.2 Pro is the safe generalist default.
const INTENT_TO_MODEL = {
  photo: 'flux',
  text_graphic: 'ideogram',
  vector_design: 'recraft',
};

// Resolves which image model to use for a generation. An explicit user
// override (settings.imageModel set to a concrete model, i.e. NOT 'auto'/
// falsy) always wins — that's the advanced override chip (1.2). Otherwise we
// route by the plan's render_intent, falling back to FLUX when intent is
// missing or unrecognized.
export function resolveImageModel(settings, plan) {
  const override = settings?.imageModel;
  if (override && override !== 'auto') return override;
  const intent = plan?.visual_prompt?.render_intent;
  return INTENT_TO_MODEL[intent] || 'flux';
}

function normalizeWorkspaceScope(scope = {}) {
  if (scope?.organizationId) {
    return {
      workspaceType: 'organization',
      organizationId: scope.organizationId,
      brandProjectId: scope.brandProjectId || null,
    };
  }

  return {
    workspaceType: 'personal',
    organizationId: null,
    brandProjectId: null,
  };
}

function withGenerationScope(payload = {}, workspaceScope = {}) {
  const normalizedScope = normalizeWorkspaceScope(workspaceScope);

  if (normalizedScope.workspaceType === 'organization' && normalizedScope.organizationId) {
    return {
      ...payload,
      organization_id: normalizedScope.organizationId,
      brand_project_id: normalizedScope.brandProjectId || null,
    };
  }

  return {
    ...payload,
    organization_id: null,
    brand_project_id: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — called by SessionStore.startGeneration()
// ---------------------------------------------------------------------------
export async function runGenerationPipeline({
  userInput,
  clarifications = {},
  sessionId,
  userId,
  settings,
  workspaceScope = {},
  lineageMetadata = null,
  onProgress = () => {},
  requestId = null,
  requestSlot = 0,
  cancelSignal = null,
}) {
  if (cancelSignal?.aborted) {
    const err = new Error('Generation cancelled before it started.');
    err.name = 'AbortError';
    throw err;
  }
  const normalizedWorkspaceScope = normalizeWorkspaceScope(workspaceScope);

  // 1. Load brand kit — skipped only when the user's persisted "Match brand
  // kit" content default (Settings > Content defaults) is explicitly off.
  // Unset/true preserves the original unconditional-load behavior exactly.
  const shouldMatchBrandKit = settings?.matchBrandKit !== false;
  onProgress(shouldMatchBrandKit ? 'Loading brand kit...' : 'Skipping brand kit (disabled in settings)...');
  const brandKit = shouldMatchBrandKit ? await loadBrandKit(userId) : null;
  const brandKitHash = brandKit?.raw?.version_hash || null;

  // 2. Load history
  const history = await loadUserHistory(userId, HISTORY_WINDOW, normalizedWorkspaceScope);

  // 3. Build brief
  onProgress('Planning content...');
  const brief = buildGenerationBrief({ userInput, clarifications, brandKit, history, settings });

  // 4. Call Groq for ContentPlan (falls back to Claude if Groq fails — the
  //    provider/model actually used is whatever the edge function reports,
  //    not necessarily Groq)
  onProgress('Generating content plan...');
  const { plan: rawGroqResponse, provider: planProvider, model: planModel, totalTokens: planTokens } =
    await callGroqContentPlan(brief);

  // 5. Validate + auto-repair
  const { plan, repairLog } = validateAndRepairPlan(rawGroqResponse);
  if (repairLog.length > 0) {
    console.warn('[Pipeline] Auto-repaired plan fields:', repairLog);
  }

  // 6. Quality gate
  onProgress('Quality check...');
  const { passed, revisedPlan, notes, revisionProvider, revisionModel } = await runQualityGate(plan, brandKit);
  const finalPlan = revisedPlan ?? plan;

  // 7. Store ContentPlan
  const { data: storedPlan, error: planErr } = await supabase
    .from('content_plans')
    .insert({
      user_id:            userId,
      session_id:         sessionId,
      raw_user_input:     userInput,
      intent_summary:     finalPlan.intent_summary,
      content_plan:       finalPlan,
      groq_model:         planModel,
      groq_tokens_used:   planTokens,
      plan_provider:      planProvider,
      revision_provider:  revisionProvider,
      revision_model:     revisionModel,
      quality_gate_pass:  passed,
      quality_gate_notes: notes,
    })
    .select()
    .single();

  if (planErr) throw new Error(`[Pipeline] Failed to store content plan: ${planErr.message}`);

  // Resolve the image model once from the final plan's render_intent (+ any
  // user override) so every slide/variant of this generation uses the same
  // engine (1.1/1.2).
  const resolvedImageModel = resolveImageModel(settings, finalPlan);

  // 4.1/4.2/4.3: reference images (brand style anchors, a "match these" set, or
  // a pinned subject) that ride along on every image so output stays on-brand /
  // consistent. Deduped, cap 9 (FLUX.2's multi-reference limit).
  const resolvedReferenceImages = Array.isArray(settings?.referenceImages)
    ? [...new Set(settings.referenceImages.filter(Boolean))].slice(0, 9)
    : [];

  // 8. Dispatch to image orchestrator
  if (settings.contentType === 'carousel') {
    return runCarouselOrchestration(
      finalPlan,
      storedPlan.id,
      sessionId,
      userId,
      onProgress,
      brandKitHash,
      lineageMetadata,
      normalizedWorkspaceScope,
      { requestId, cancelSignal, resolvedImageModel, resolvedReferenceImages },
    );
  } else {
    return runSingleGeneration(
      finalPlan,
      storedPlan.id,
      sessionId,
      userId,
      settings,
      onProgress,
      brandKitHash,
      lineageMetadata,
      normalizedWorkspaceScope,
      { requestId, requestSlot, cancelSignal, resolvedImageModel, resolvedReferenceImages },
    );
  }
}

// ---------------------------------------------------------------------------
// Single image path
// ---------------------------------------------------------------------------
async function runSingleGeneration(
  plan,
  contentPlanId,
  sessionId,
  userId,
  settings,
  onProgress,
  brandKitHash = null,
  lineageMetadata = null,
  workspaceScope = {},
  { requestId = null, requestSlot = 0, cancelSignal = null, resolvedImageModel = null, resolvedReferenceImages = [] } = {},
) {
  // The content plan produces a strong model-agnostic full_prompt; the
  // generateImage edge fn then runs ONE model-aware render-prompt pass on it
  // (1.3 — it used to always assume FLUX vocabulary regardless of the model).
  // We deliberately leave enhance_prompt ON (do not pass enhancePrompt:false)
  // so that single pass tailors the prompt to the resolved engine. Fully
  // de-tuning the plan's full_prompt to save the pass is a creative-core
  // change that needs before/after image A/B (see plan 1.3 risk) — a
  // follow-up, not this PR.
  const basePrompt  = plan.visual_prompt?.slides?.[0]?.full_prompt ?? plan.visual_prompt?.global_style ?? '';
  // 3.4: a per-variant direction hint (set by startGeneration for multi-variant
  // batches) nudges each variant toward a different angle/lighting/crop so the
  // batch isn't 4 near-dupes. Empty for single images and variant 0.
  const variantHint = String(settings?.variantHint || '').trim();
  const prompt      = variantHint ? `${basePrompt}. Variation: ${variantHint}.` : basePrompt;
  const aspectRatio = plan.visual_prompt?.aspect_ratio ?? '1:1';

  onProgress('Generating image...');

  const { data: generation, error: genErr } = await supabase
    .from('generations')
    .insert(withGenerationScope({
      user_id:        userId,
      session_id:     sessionId,
      prompt,
      media_type:     settings.mediaType ?? 'image',
      status:         GENERATION_STATUS.PROCESSING,
      content_plan_id: contentPlanId,
      request_id:     requestId,
      request_slot:   requestSlot,
      metadata:       {
        aspect_ratio: aspectRatio,
        brand_kit_hash: brandKitHash,
        ...(lineageMetadata ? { lineage: lineageMetadata } : {}),
      },
    }, workspaceScope))
    .select()
    .single();

  if (genErr) throw new Error(`[Pipeline] Failed to insert generation: ${genErr.message}`);

  try {
    const generated = normalizeGeneratedAsset(
      await generateImage(prompt, aspectRatio, {
        requestId, requestSlot, signal: cancelSignal, generationId: generation.id,
        imageModel: resolvedImageModel, referenceImages: resolvedReferenceImages,
      }),
    );
    if (!generated.url) throw new Error('[Pipeline] Image provider returned no image URL.');
    await supabase.from('generations').update({
      status:       GENERATION_STATUS.COMPLETED,
      storage_path: generated.url,
      progress:     100,
      metadata:     {
        ...(generation.metadata || {}),
        ...generated.metadata,
      },
    }).eq('id', generation.id);
    // 2.1: score the finished image asynchronously (never awaited).
    triggerQualityGate(generation.id);
  } catch (err) {
    await supabase.from('generations').update({ status: GENERATION_STATUS.FAILED }).eq('id', generation.id);
    throw err;
  }

  return { contentPlanId, generationIds: [generation.id] };
}

// ---------------------------------------------------------------------------
// Carousel path — sequential, one slide at a time
// ---------------------------------------------------------------------------
async function runCarouselOrchestration(
  plan,
  contentPlanId,
  sessionId,
  userId,
  onProgress,
  brandKitHash = null,
  lineageMetadata = null,
  workspaceScope = {},
  { requestId = null, cancelSignal = null, resolvedImageModel = null, resolvedReferenceImages = [] } = {},
) {
  const slides      = plan.carousel?.slides ?? [];
  const aspectRatio = plan.visual_prompt?.aspect_ratio ?? '1:1';
  const batchId     = crypto.randomUUID();
  const generationIds = [];

  if (!slides.length) throw new Error('[Pipeline] Carousel has no slides in plan.');

  // Insert all placeholder rows upfront so UI shows skeleton cards immediately
  const placeholders = slides.map((slide, idx) => withGenerationScope({
    user_id:               userId,
    session_id:            sessionId,
    prompt:                slide.image_prompt,
    media_type:            'image',
    status:                GENERATION_STATUS.PROCESSING,
    batch_id:              batchId,
    batch_index:           idx,
    request_id:            requestId,
    request_slot:          idx,
    content_plan_id:       contentPlanId,
    carousel_slide_index:  idx + 1,
    carousel_slide_total:  slides.length,
    slide_prompt:          slide.image_prompt,
    metadata: {
      aspect_ratio:  aspectRatio,
      brand_kit_hash: brandKitHash,
      slide_purpose: slide.slide_purpose,
      headline:      slide.headline,
      ...(lineageMetadata ? { lineage: lineageMetadata } : {}),
    },
  }, workspaceScope));

  const { data: insertedRows, error: insertErr } = await supabase
    .from('generations')
    .insert(placeholders)
    .select();

  if (insertErr) throw new Error(`[Pipeline] Failed to insert carousel placeholders: ${insertErr.message}`);

  // Sort inserted rows by batch_index to ensure correct order
  const sortedRows = [...insertedRows].sort((a, b) => (a.batch_index ?? 0) - (b.batch_index ?? 0));

  // Generate one at a time — sequential
  const outcomes = [];
  for (const row of sortedRows) {
    const idx        = row.batch_index ?? 0;
    const fullPrompt = plan.visual_prompt?.slides?.[idx]?.full_prompt ?? slides[idx]?.image_prompt ?? '';

    // Honest cancel: a slide not yet started when Cancel fires is marked
    // skipped and never sent to the provider — it never gets billed. Slides
    // already in flight when cancelSignal fires are handled by the abort
    // reaching invokeFunction's fetch below (media.service.js).
    if (cancelSignal?.aborted) {
      await supabase.from('generations').update({ status: GENERATION_STATUS.FAILED, metadata: { ...(row.metadata || {}), skipped_reason: 'cancelled' } }).eq('id', row.id);
      outcomes.push({ id: row.id, index: idx, ok: false, cancelled: true });
      generationIds.push(row.id);
      continue;
    }

    onProgress(`Generating slide ${idx + 1} of ${slides.length}...`);

    try {
      const generated = normalizeGeneratedAsset(
        await generateImage(fullPrompt, aspectRatio, {
          requestId, requestSlot: idx, signal: cancelSignal, generationId: row.id,
          imageModel: resolvedImageModel, referenceImages: resolvedReferenceImages,
        }),
      );
      if (!generated.url) throw new Error('[Pipeline] Image provider returned no image URL.');
      await supabase.from('generations').update({
        status:       GENERATION_STATUS.COMPLETED,
        storage_path: generated.url,
        progress:     100,
        metadata:     {
          ...(row.metadata || {}),
          ...generated.metadata,
        },
      }).eq('id', row.id);
      // 2.1: score each finished slide asynchronously (never awaited).
      triggerQualityGate(row.id);
      outcomes.push({ id: row.id, index: idx, ok: true });
    } catch (err) {
      await supabase.from('generations').update({ status: GENERATION_STATUS.FAILED }).eq('id', row.id);
      console.error(`[Pipeline] Slide ${idx + 1} failed:`, err);
      outcomes.push({ id: row.id, index: idx, ok: false, error: err?.message || 'Slide generation failed' });
      // Continue to next slide — partial carousel is better than none
    }

    generationIds.push(row.id);
  }

  const succeededCount = outcomes.filter((o) => o.ok).length;
  return {
    contentPlanId,
    batchId,
    generationIds,
    outcomes,
    succeededCount,
    failedCount: outcomes.length - succeededCount,
    totalCount: outcomes.length,
  };
}
