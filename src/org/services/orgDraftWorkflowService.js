import { supabase } from '../../services/supabaseClient';
import {
  buildUnavailableEdgeFunctionMessage,
  clearEdgeFunctionUnavailable,
  isEdgeFunctionUnavailable,
  markEdgeFunctionUnavailable,
  normalizeEdgeFunctionError,
  shouldSkipEdgeFunction,
} from '../../services/edgeFunctionClient';

const METADATA_FUNCTION = 'generate-post-metadata';
const SEO_OPTIMIZE_FUNCTION = 'optimize-seo';
const SEO_SCORE_FUNCTION = 'seo-score';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeHashtags(value = []) {
  return safeArray(value)
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

function clampScore(value) {
  const score = Number(value);
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function parseScore(value) {
  const score = Number(value);
  if (Number.isNaN(score)) return null;
  return score;
}

function shouldNormalizeTenPointScale(values = []) {
  const numericValues = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!numericValues.length) return false;
  const max = Math.max(...numericValues);
  const avg = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  return max <= 10 && avg <= 8.5;
}

function normalizeScore(value, useTenPointScale = false) {
  if (value === null || value === undefined) return 0;
  return clampScore(useTenPointScale ? value * 10 : value);
}

function computeWeightedSeoOverall(breakdown = {}) {
  return clampScore(
    (Number(breakdown.title || 0) * 0.3)
    + (Number(breakdown.caption || 0) * 0.45)
    + (Number(breakdown.hashtags || 0) * 0.25),
  );
}

function normalizeSeoSuggestions(value = []) {
  return safeArray(value)
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        return String(entry.bullet || entry.message || '').trim();
      }
      return String(entry || '').trim();
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeScoreCategory(score) {
  if (score >= 80) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Ok';
  return 'Poor';
}

async function invokeOrgEdgeFunction(functionName, body = {}) {
  if (shouldSkipEdgeFunction(functionName)) {
    throw new Error(buildUnavailableEdgeFunctionMessage(functionName));
  }

  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    if (isEdgeFunctionUnavailable(error)) {
      markEdgeFunctionUnavailable(functionName);
    }
    throw await normalizeEdgeFunctionError(error, functionName);
  }

  clearEdgeFunctionUnavailable(functionName);
  return data;
}

function dispatchOrgWorkflowSync(reason = 'org-draft-workflow-updated') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('socialai:data-sync', {
      detail: {
        reason,
        at: new Date().toISOString(),
      },
    }),
  );
}

function mergeJsonState(currentValue, nextValue) {
  return {
    ...safeObject(currentValue),
    ...safeObject(nextValue),
  };
}

function normalizePostRow(row) {
  if (!row) return null;

  const generation = Array.isArray(row.generations) ? row.generations[0] || null : row.generations || null;
  const workflowState = safeObject(row.workflow_state);
  const seoState = safeObject(row.seo_state);

  return {
    ...row,
    title: String(row.title || '').trim(),
    caption: String(row.caption || '').trim(),
    hashtags: normalizeHashtags(row.hashtags),
    workflow_state: workflowState,
    seo_state: seoState,
    generations: generation,
    metadata_status: String(workflowState.metadata_status || '').trim() || 'idle',
  };
}

export async function fetchOrgDraftWorkflow(postId) {
  if (!postId) {
    throw new Error('A draft id is required.');
  }

  const { data, error } = await supabase
    .from('posts')
    .select(`
      id,
      user_id,
      generation_id,
      organization_id,
      brand_project_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      account_id,
      scheduled_at,
      created_at,
      updated_at,
      pipeline_item_id,
      seo_state,
      workflow_state,
      generations (
        id,
        session_id,
        prompt,
        storage_path,
        media_type,
        metadata,
        content_plan_id
      )
    `)
    .eq('id', postId)
    .maybeSingle();

  if (error) throw error;
  return normalizePostRow(data);
}

export async function updateOrgDraftWorkflow(postId, updates = {}, options = {}) {
  if (!postId) {
    throw new Error('A draft id is required.');
  }

  const currentDraft = options.currentDraft || await fetchOrgDraftWorkflow(postId);
  const payload = { ...updates };

  if (Object.prototype.hasOwnProperty.call(payload, 'hashtags')) {
    payload.hashtags = normalizeHashtags(payload.hashtags);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'workflow_state')) {
    payload.workflow_state = mergeJsonState(currentDraft?.workflow_state, payload.workflow_state);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'seo_state')) {
    payload.seo_state = mergeJsonState(currentDraft?.seo_state, payload.seo_state);
  }

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('posts')
    .update(payload)
    .eq('id', postId)
    .select(`
      id,
      user_id,
      generation_id,
      organization_id,
      brand_project_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      account_id,
      scheduled_at,
      created_at,
      updated_at,
      pipeline_item_id,
      seo_state,
      workflow_state,
      generations (
        id,
        session_id,
        prompt,
        storage_path,
        media_type,
        metadata,
        content_plan_id
      )
    `)
    .single();

  if (error) throw error;
  dispatchOrgWorkflowSync('org-draft-workflow-saved');
  return normalizePostRow(data);
}

export async function updateOrgDraftMetadataStatus(postId, status, extra = {}, options = {}) {
  return updateOrgDraftWorkflow(postId, {
    workflow_state: {
      metadata_status: status,
      metadata_updated_at: new Date().toISOString(),
      ...safeObject(extra),
    },
  }, options);
}

export async function requestOrgDraftMetadata({
  postId,
  generationId = null,
  fields = ['title', 'caption', 'hashtags'],
}) {
  if (!postId && !generationId) {
    throw new Error('A post or generation is required to generate metadata.');
  }

  if (postId) {
    await updateOrgDraftMetadataStatus(postId, 'in_progress');
  }

  try {
    const data = await invokeOrgEdgeFunction(METADATA_FUNCTION, {
      post_id: postId || null,
      generation_id: generationId || null,
      fields,
    });

    dispatchOrgWorkflowSync('org-draft-metadata-generated');
    return {
      ...safeObject(data),
      hashtags: normalizeHashtags(data?.hashtags),
    };
  } catch (error) {
    if (postId) {
      await updateOrgDraftMetadataStatus(postId, 'failed', {
        metadata_error: error?.message || 'Metadata generation failed.',
      }).catch(() => {});
    }
    throw error;
  }
}

export async function runOrgDraftSeo({
  postId,
  title = '',
  caption = '',
  hashtags = [],
  platform = 'instagram',
  targetKeywords = [],
}) {
  if (!postId) {
    throw new Error('A draft id is required.');
  }

  const optimizeData = await invokeOrgEdgeFunction(SEO_OPTIMIZE_FUNCTION, {
    title,
    caption,
    hashtags,
    platform,
    targetKeywords,
  });

  const rawOptimizeScore = parseScore(optimizeData?.seo_score ?? optimizeData?.seoScore ?? null);
  const normalizedOptimizeScore = normalizeScore(
    rawOptimizeScore,
    rawOptimizeScore > 0 && rawOptimizeScore <= 10,
  );

  const normalizedSeoState = {
    optimized_title: String(optimizeData?.optimized_title || optimizeData?.optimizedTitle || title).trim(),
    optimized_caption: String(optimizeData?.optimized_caption || optimizeData?.optimizedCaption || caption).trim(),
    optimized_hashtags: normalizeHashtags(optimizeData?.optimized_hashtags || optimizeData?.optimizedHashtags || hashtags),
    seo_score: normalizedOptimizeScore,
    score_category: String(optimizeData?.score_category || optimizeData?.scoreCategory || '').trim()
      || normalizeScoreCategory(normalizedOptimizeScore),
    score_breakdown: safeObject(optimizeData?.score_breakdown || optimizeData?.scoreBreakdown),
    improvement_report: safeArray(optimizeData?.improvement_report || optimizeData?.improvementReport),
    provider: optimizeData?.provider || null,
    model: optimizeData?.model || null,
    provider_warning: optimizeData?.provider_warning || null,
    updated_at: new Date().toISOString(),
  };

  const updatedDraft = await updateOrgDraftWorkflow(postId, {
    seo_state: normalizedSeoState,
    workflow_state: {
      seo_status: 'completed',
      seo_updated_at: new Date().toISOString(),
    },
  });

  return {
    draft: updatedDraft,
    seoState: normalizedSeoState,
  };
}

export async function scoreOrgDraftSeo({
  postId,
  title = '',
  caption = '',
  hashtags = [],
  platform = 'instagram',
}) {
  if (!postId) {
    throw new Error('A draft id is required.');
  }

  const data = await invokeOrgEdgeFunction(SEO_SCORE_FUNCTION, {
    content_id: postId,
    title,
    caption,
    hashtags,
    platform,
  });

  const rawBreakdown = {
    title: parseScore(data?.breakdown?.title ?? data?.score_breakdown?.title),
    caption: parseScore(data?.breakdown?.caption ?? data?.score_breakdown?.caption),
    hashtags: parseScore(data?.breakdown?.hashtags ?? data?.score_breakdown?.hashtags),
  };
  const useTenPointScale = shouldNormalizeTenPointScale([
    rawBreakdown.title,
    rawBreakdown.caption,
    rawBreakdown.hashtags,
  ]);
  const breakdown = {
    title: normalizeScore(rawBreakdown.title, useTenPointScale),
    caption: normalizeScore(rawBreakdown.caption, useTenPointScale),
    hashtags: normalizeScore(rawBreakdown.hashtags, useTenPointScale),
  };
  const rawOverall = parseScore(data?.overall ?? data?.seo_score ?? data?.seoScore ?? null);
  const hasBreakdownSignal = Object.values(breakdown).some((score) => score > 0);
  const overall = hasBreakdownSignal
    ? computeWeightedSeoOverall(breakdown)
    : normalizeScore(rawOverall, rawOverall > 0 && rawOverall <= 10);
  const suggestions = normalizeSeoSuggestions(data?.suggestions || data?.improvements || []);
  const normalizedSeoState = {
    seo_score: overall,
    score_category: normalizeScoreCategory(overall),
    score_breakdown: breakdown,
    suggestions,
    provider: data?.provider || null,
    model: data?.model || null,
    provider_warning: data?.provider_warning || null,
    updated_at: new Date().toISOString(),
  };

  const updatedDraft = await updateOrgDraftWorkflow(postId, {
    seo_state: normalizedSeoState,
    workflow_state: {
      seo_status: 'scored',
      seo_updated_at: new Date().toISOString(),
    },
  });

  return {
    draft: updatedDraft,
    seoState: normalizedSeoState,
  };
}

export async function applyOrgSeoSuggestions(postId, seoState = {}, options = {}) {
  const nextTitle = String(seoState.optimized_title || options.title || '').trim();
  const nextCaption = String(seoState.optimized_caption || options.caption || '').trim();
  const nextHashtags = normalizeHashtags(seoState.optimized_hashtags || options.hashtags || []);

  return updateOrgDraftWorkflow(postId, {
    ...(nextTitle ? { title: nextTitle } : {}),
    ...(nextCaption ? { caption: nextCaption } : {}),
    hashtags: nextHashtags,
    workflow_state: {
      seo_applied_at: new Date().toISOString(),
    },
  }, options);
}

export async function cloneOrgDraftForAccount({
  sourceDraft,
  accountId,
  platform = null,
}) {
  if (!sourceDraft?.id || !accountId) {
    throw new Error('A source draft and account are required.');
  }

  const payload = {
    user_id: sourceDraft.user_id,
    generation_id: sourceDraft.generation_id,
    organization_id: sourceDraft.organization_id,
    brand_project_id: sourceDraft.brand_project_id || null,
    title: sourceDraft.title || null,
    caption: sourceDraft.caption || '',
    hashtags: normalizeHashtags(sourceDraft.hashtags),
    status: 'draft',
    platform: platform || null,
    account_id: accountId,
    seo_state: safeObject(sourceDraft.seo_state),
    workflow_state: safeObject(sourceDraft.workflow_state),
  };

  const { data, error } = await supabase
    .from('posts')
    .insert(payload)
    .select(`
      id,
      user_id,
      generation_id,
      organization_id,
      brand_project_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      account_id,
      scheduled_at,
      created_at,
      updated_at,
      pipeline_item_id,
      seo_state,
      workflow_state,
      generations (
        id,
        session_id,
        prompt,
        storage_path,
        media_type,
        metadata,
        content_plan_id
      )
    `)
    .single();

  if (error) throw error;
  dispatchOrgWorkflowSync('org-draft-cloned');
  return normalizePostRow(data);
}
