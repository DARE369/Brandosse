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

let _generateImage = null;
export function registerImageGenerator(fn) { _generateImage = fn; }
async function generateImage(prompt, aspectRatio) {
  if (!_generateImage) throw new Error('[Pipeline] No image generator registered. Call registerImageGenerator() first.');
  return _generateImage(prompt, aspectRatio);
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
    },
  };
}

const HISTORY_WINDOW = 10;

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
}) {
  const normalizedWorkspaceScope = normalizeWorkspaceScope(workspaceScope);

  // 1. Load brand kit
  onProgress('Loading brand kit...');
  const brandKit = await loadBrandKit(userId);
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
) {
  const prompt      = plan.visual_prompt?.slides?.[0]?.full_prompt ?? plan.visual_prompt?.global_style ?? '';
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
    const generated = normalizeGeneratedAsset(await generateImage(prompt, aspectRatio));
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
  for (const row of sortedRows) {
    const idx        = row.batch_index ?? 0;
    const fullPrompt = plan.visual_prompt?.slides?.[idx]?.full_prompt ?? slides[idx]?.image_prompt ?? '';

    onProgress(`Generating slide ${idx + 1} of ${slides.length}...`);

    try {
      const generated = normalizeGeneratedAsset(await generateImage(fullPrompt, aspectRatio));
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
    } catch (err) {
      await supabase.from('generations').update({ status: GENERATION_STATUS.FAILED }).eq('id', row.id);
      console.error(`[Pipeline] Slide ${idx + 1} failed:`, err);
      // Continue to next slide — partial carousel is better than none
    }

    generationIds.push(row.id);
  }

  return { contentPlanId, batchId, generationIds };
}
