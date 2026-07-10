// ============================================================================
// ZUSTAND SESSION STORE - SocialAI
// Edge-backed image/video/edit flows + async video polling state
// ============================================================================

import { create } from 'zustand';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import { POST_STATUS, GENERATION_STATUS } from '../constants/statuses';
import { assertPostStatusTransition } from '../utils/postStatusMachine';
import {
  generateImages,
  editImage,
  createVideoJob,
} from '../services/media.service';
import {
  enhancePrompt as apiEnhancePrompt,
} from '../services/ApiService';
import { loadBrandKit } from '../services/brandKitLoader';
import { getOrgRuntimeContext } from '../org/stores/orgRuntimeStore';
import {
  fetchOrgPostAssetLinks,
  syncOrgPostAssetLinks,
} from '../org/services/assetLibraryService';
import { requestOrgDraftMetadata } from '../org/services/orgDraftWorkflowService';
import { ensureLibraryRowsForPosts } from '../services/contentLibraryService';
import { generateSessionTitle } from '../services/sessionTitleService';
import { executeMockPublishAttempts } from '../services/platforms/mockPublishWorkflow';
import { normalizeEdgeFunctionError } from '../services/edgeFunctionClient';

export { GENERATION_STATUS, POST_STATUS } from '../constants/statuses';

const CONTENT_SYNC_EVENT = 'socialai:data-sync';

const DEFAULT_SOCIAL_SEO_BREAKDOWN = {
  readability: 0,
  keywordRelevance: 0,
  hashtagQuality: 0,
  hookStrength: 0,
  ctaStrength: 0,
  platformFit: 0,
  brandConsistency: 0,
  visualCaptionAlignment: 0,
  recommendationPotential: 0,
};

const DEFAULT_POST_PRODUCTION = {
  postId: null,
  title: '',
  caption: '',
  hashtags: [],
  seoScore: 0,
  seoCategory: 'Not scored',
  seoBreakdown: { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
  seoSuggestions: [],
  seoBenchmarkReport: [],
  seoHashtagSuggestions: [],
  seoStatus: 'idle',
  seoProvider: null,
  selectedPlatforms: [],
  scheduleDate: null,
  assetReferences: [],
  metadataStatus: 'idle',
  metadataUpdatedAt: null,
  brandConsistencyStatus: 'idle',
  brandConsistencyScore: null,
  brandConsistencyPass: null,
  brandConsistencyIssues: [],
  brandConsistencyNotes: [],
};

const DEFAULT_VIDEO_JOB_STATE = {
  jobId: null,
  generationId: null,
  providerEndpoint: null,
  prompt: '',
  status: null, // submitting | processing | completed | failed | null
  progress: 0,
  videoUrl: null,
  isMinimized: false,
  pollInterval: null,
};

const normalizeHashtags = (tags = []) => tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
const ALLOWED_METADATA_FIELDS = new Set(['title', 'caption', 'hashtags']);

function isExpectedGenerationProviderError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('media generation quota is exhausted')
    || message.includes('media generation is not configured')
    || message.includes('provider key with available quota')
    || message.includes('add the provider api key');
}

function logGenerationFailure(scope, error) {
  if (isExpectedGenerationProviderError(error)) {
    console.warn(`${scope}:`, error?.message || error);
    return;
  }

  console.error(`${scope}:`, error);
}

function normalizeMetadataFields(fields = []) {
  const normalized = Array.isArray(fields)
    ? fields
      .map((field) => String(field || '').trim().toLowerCase())
      .filter((field) => ALLOWED_METADATA_FIELDS.has(field))
    : [];

  return normalized.length > 0
    ? [...new Set(normalized)]
    : ['title', 'caption', 'hashtags'];
}

function normalizeSeoSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const typed = entry;
        return String(typed.bullet || typed.message || '').trim();
      }
      return String(entry || '').trim();
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeSeoBenchmarkReport(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const typed = entry;
        const benchmark = String(typed.benchmark || typed.title || '').trim();
        const status = String(typed.status || typed.result || '').trim();
        const note = String(typed.note || typed.description || typed.rationale || '').trim();
        return [benchmark, status, note].filter(Boolean).join(' - ');
      }
      return String(entry || '').trim();
    })
    .filter(Boolean)
    .slice(0, 8);
}

function parseSeoNumeric(input) {
  const next = Number(input);
  if (Number.isNaN(next)) return null;
  return next;
}

function clampSeoPercent(input) {
  const next = Number(input);
  if (Number.isNaN(next)) return 0;
  return Math.max(0, Math.min(100, Math.round(next)));
}

function shouldNormalizeSeoTenPointScale(values = []) {
  const numericValues = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!numericValues.length) return false;
  const max = Math.max(...numericValues);
  const avg = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  return max <= 10 && avg <= 8.5;
}

function normalizeSeoNumeric(value, useTenPointScale = false) {
  if (value === null || value === undefined) return 0;
  return clampSeoPercent(useTenPointScale ? value * 10 : value);
}

function normalizeSeoBreakdown(value) {
  const breakdown = value && typeof value === 'object' ? value : {};

  const dimensions = [
    ['readability', ['readability']],
    ['keywordRelevance', ['keywordRelevance', 'keyword_relevance', 'keywordDensity', 'keyword_density']],
    ['hashtagQuality', ['hashtagQuality', 'hashtag_quality', 'hashtags', 'hashtag_relevance']],
    ['hookStrength', ['hookStrength', 'hook_strength', 'caption_structure']],
    ['ctaStrength', ['ctaStrength', 'cta_strength', 'cta_presence']],
    ['platformFit', ['platformFit', 'platform_fit', 'platform_alignment']],
    ['brandConsistency', ['brandConsistency', 'brand_consistency']],
    ['visualCaptionAlignment', ['visualCaptionAlignment', 'visual_caption_alignment']],
    ['recommendationPotential', ['recommendationPotential', 'recommendation_potential']],
  ];

  const raw = dimensions.reduce((accumulator, [key, aliases]) => {
    const match = aliases.reduce((candidate, alias) => (
      candidate ?? breakdown?.[alias]?.score ?? breakdown?.[alias]
    ), null);
    accumulator[key] = parseSeoNumeric(match);
    return accumulator;
  }, {});

  const useTenPointScale = shouldNormalizeSeoTenPointScale(Object.values(raw));

  return dimensions.reduce((accumulator, [key]) => {
    accumulator[key] = normalizeSeoNumeric(raw[key], useTenPointScale);
    return accumulator;
  }, {});
}

function computeWeightedSeoOverall(breakdown = {}) {
  const weights = {
    readability: 0.1,
    keywordRelevance: 0.16,
    hashtagQuality: 0.14,
    hookStrength: 0.12,
    ctaStrength: 0.08,
    platformFit: 0.16,
    brandConsistency: 0.1,
    visualCaptionAlignment: 0.08,
    recommendationPotential: 0.06,
  };

  return clampSeoPercent(
    Object.entries(weights).reduce((sum, [key, weight]) => (
      sum + (Number(breakdown[key] || 0) * weight)
    ), 0),
  );
}

function normalizeSeoOverall(rawOverall, breakdown) {
  const hasBreakdownSignal = Object.values(breakdown || {}).some((value) => Number(value) > 0);
  const weightedOverall = computeWeightedSeoOverall(breakdown);
  if (hasBreakdownSignal) return weightedOverall;
  if (rawOverall === null || rawOverall === undefined) return weightedOverall;
  return normalizeSeoNumeric(rawOverall, rawOverall > 0 && rawOverall <= 10);
}

function normalizeSeoScorePayload(raw = {}) {
  const overallRaw = parseSeoNumeric(
    raw?.overall
    ?? raw?.discoveryScore
    ?? raw?.discovery_score
    ?? raw?.seo_score
    ?? raw?.seoScore
    ?? null,
  );
  const breakdown = normalizeSeoBreakdown(raw?.breakdown || raw?.score_breakdown || raw?.scoreBreakdown || {});
  const overall = normalizeSeoOverall(overallRaw, breakdown);
  const suggestions = normalizeSeoSuggestions(raw?.recommendations || raw?.suggestions || raw?.improvements || raw?.improvement_report || []);
  const benchmarkReport = normalizeSeoBenchmarkReport(raw?.benchmarkReport || raw?.benchmark_report || []);
  const hashtagSuggestions = Array.isArray(raw?.hashtagSuggestions || raw?.hashtag_suggestions)
    ? (raw?.hashtagSuggestions || raw?.hashtag_suggestions)
      .map((item) => (item && typeof item === 'object'
        ? {
            tag: String(item.tag || item.hashtag || '').trim(),
            relevance: clampSeoPercent(item.relevance || item.score || 0),
            reason: String(item.reason || item.rationale || '').trim(),
          }
        : { tag: String(item || '').trim(), relevance: 0, reason: '' }))
      .filter((item) => item.tag)
      .slice(0, 8)
    : [];
  const category = String(
    raw?.score_category
    || raw?.scoreCategory
    || (overall >= 80 ? 'Great' : overall >= 60 ? 'Good' : overall >= 40 ? 'Ok' : 'Poor'),
  ).trim() || 'Poor';

  return {
    overall,
    breakdown,
    suggestions,
    benchmarkReport,
    hashtagSuggestions,
    category,
    provider: raw?.provider || null,
    model: raw?.model || null,
    providerWarning: raw?.provider_warning || null,
  };
}

const NON_TERMINAL_STATUSES = [
  POST_STATUS.DRAFT,
  POST_STATUS.SCHEDULED,
  POST_STATUS.FAILED,
];

function getActiveOrgScope() {
  const context = getOrgRuntimeContext();
  if (!context?.organizationId) return null;

  return {
    organization_id: context.organizationId,
    brand_project_id: context.brandProjectId || null,
  };
}

function withOrgScope(payload = {}) {
  const orgScope = getActiveOrgScope();
  return orgScope ? { ...payload, ...orgScope } : payload;
}

function getSessionScope() {
  const orgScope = getActiveOrgScope();
  if (orgScope?.organization_id) {
    return {
      workspace_type: 'organization',
      organization_id: orgScope.organization_id,
      brand_project_id: orgScope.brand_project_id || null,
    };
  }

  return {
    workspace_type: 'personal',
    organization_id: null,
    brand_project_id: null,
  };
}

function withSessionScope(payload = {}) {
  return {
    ...payload,
    ...getSessionScope(),
  };
}

function applySessionScope(query) {
  const scope = getSessionScope();
  let nextQuery = query.eq('workspace_type', scope.workspace_type);

  if (scope.workspace_type === 'organization') {
    nextQuery = nextQuery.eq('organization_id', scope.organization_id);
  } else {
    nextQuery = nextQuery.is('organization_id', null);
  }

  return nextQuery;
}

function applyGenerationScope(query) {
  const orgScope = getActiveOrgScope();

  if (orgScope?.organization_id) {
    return query.eq('organization_id', orgScope.organization_id);
  }

  return query.is('organization_id', null);
}

async function touchSession(sessionId) {
  if (!sessionId) return;

  const { error } = await applySessionScope(
    supabase
      .from('sessions')
      .update({ updated_at: new Date().toISOString() }),
  )
    .eq('id', sessionId);

  if (error) throw error;
}

function getTitleFromPrompt(prompt = '') {
  const words = String(prompt || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Untitled Session';
  const base = words.slice(0, 7).join(' ');
  return words.length > 7 ? `${base}...` : base;
}

function getDraftMetadataStatus(post) {
  const workflowState = post?.workflow_state && typeof post.workflow_state === 'object'
    ? post.workflow_state
    : {};
  return String(workflowState.metadata_status || '').trim().toLowerCase() || 'idle';
}

function shouldGenerateDraftMetadata(post) {
  if (!post?.id) return false;
  const metadataStatus = getDraftMetadataStatus(post);
  return metadataStatus !== 'completed' && metadataStatus !== 'in_progress';
}

async function requestPostMetadataForDraft(post, fields = ['title', 'caption', 'hashtags']) {
  if (!post?.id) return null;

  if (post.organization_id) {
    return requestOrgDraftMetadata({
      postId: post.id,
      generationId: post.generation_id || null,
      fields,
    });
  }

  const { data, error } = await supabase.functions.invoke('generate-post-metadata', {
    body: {
      post_id: post.id,
      generation_id: post.generation_id || null,
      fields,
    },
  });

  if (error) {
    throw normalizeEdgeFunctionError(error, 'generate-post-metadata');
  }

  return data || null;
}

async function tryUpdateDraftWorkflowState(postId, patch) {
  if (!postId) return;

  try {
    const { error } = await supabase
      .from('posts')
      .update(patch)
      .eq('id', postId);

    if (error) {
      console.warn('Draft metadata workflow update skipped:', error.message);
    }
  } catch (error) {
    console.warn('Draft metadata workflow update failed:', error?.message || error);
  }
}

async function scheduleDraftMetadataGeneration(post) {
  if (!shouldGenerateDraftMetadata(post)) return;

  const metadataUpdatedAt = new Date().toISOString();

  if (!post?.organization_id && post?.id) {
    const nextWorkflowState = {
      ...(post.workflow_state && typeof post.workflow_state === 'object' ? post.workflow_state : {}),
      metadata_status: 'in_progress',
      metadata_error: null,
      metadata_updated_at: metadataUpdatedAt,
    };

    post.workflow_state = nextWorkflowState;
    await tryUpdateDraftWorkflowState(post.id, {
      workflow_state: nextWorkflowState,
      updated_at: metadataUpdatedAt,
    });
  }

  try {
    await requestPostMetadataForDraft(post, ['title', 'caption', 'hashtags']);
    dispatchContentSync(post?.organization_id ? 'org-draft-metadata-generated' : 'draft-metadata-generated');
  } catch (error) {
    console.error('Failed to generate draft metadata:', error);
    if (!post?.organization_id && post?.id) {
      await tryUpdateDraftWorkflowState(post.id, {
        workflow_state: {
          ...(post.workflow_state && typeof post.workflow_state === 'object' ? post.workflow_state : {}),
          metadata_status: 'failed',
          metadata_error: error?.message || 'Metadata generation failed.',
          metadata_updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      });
    }
  }
}

async function syncOrgScopeToGenerations(generationIds = []) {
  const normalizedIds = Array.from(new Set((generationIds || []).filter(Boolean)));
  const orgScope = getActiveOrgScope();

  if (!orgScope || normalizedIds.length === 0) return;

  const { error: generationError } = await supabase
    .from('generations')
    .update(orgScope)
    .in('id', normalizedIds);

  if (generationError) throw generationError;

  const { error: postError } = await supabase
    .from('posts')
    .update(orgScope)
    .in('generation_id', normalizedIds);

  if (postError) throw postError;
}

function dispatchContentSync(reason = 'updated') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CONTENT_SYNC_EVENT, {
      detail: {
        reason,
        at: new Date().toISOString(),
      },
    }),
  );
}

function buildFinalCaption(caption = '', hashtags = []) {
  const normalizedTags = normalizeHashtags(hashtags).join(' ');
  const safeCaption = String(caption || '').trim();
  return `${safeCaption}${normalizedTags ? `\n\n${normalizedTags}` : ''}`.trim();
}

function splitCaptionAndHashtags(value = '') {
  const raw = String(value || '').trim();
  const hashtags = normalizeHashtags(raw.match(/#[\w_]+/g) || []);

  if (!hashtags.length) {
    return { caption: raw, hashtags: [] };
  }

  const caption = raw
    .replace(/#[\w_]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { caption, hashtags };
}

function normalizeAssetReference(asset) {
  if (!asset?.id) return null;
  return {
    id: asset.id,
    name: asset.name || 'Asset',
    fileType: asset.file_type || asset.fileType || 'document',
    fileUrl: asset.file_url || asset.fileUrl || null,
    thumbnailUrl: asset.thumbnail_url || asset.thumbnailUrl || null,
    assetRole: asset.asset_role || asset.assetRole || 'reference',
  };
}

function normalizeAssetReferences(assets = []) {
  return assets
    .map((asset) => normalizeAssetReference(asset))
    .filter(Boolean);
}

function toLineageObject(value) {
  if (!value || typeof value !== 'object') return null;

  const source = String(value.source || '').trim();
  if (!source) return null;

  const next = {
    source,
    at: String(value.at || '').trim() || new Date().toISOString(),
  };

  const sourceId = String(value.sourceId || value.assetId || value.postId || value.templateId || '').trim();
  if (sourceId) {
    next.source_id = sourceId;
  }

  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata : null;
  if (metadata) {
    next.metadata = metadata;
  }

  return next;
}

function sanitizeBrandKitForPrompt(value) {
  if (!value || typeof value !== 'object') return null;

  const pick = (key) => {
    const next = value[key];
    return typeof next === 'string' ? next.trim() : '';
  };

  const tags = Array.isArray(value.approved_hashtag_sets)
    ? value.approved_hashtag_sets.flatMap((entry) => (Array.isArray(entry?.hashtags) ? entry.hashtags : []))
    : [];

  const uniqueTags = [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 10);

  const summary = {
    brand_name: pick('brand_name'),
    brand_voice: pick('brand_voice'),
    tone: pick('tone') || pick('tone_guidelines'),
    messaging_pillars: Array.isArray(value.messaging_pillars)
      ? value.messaging_pillars.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    do_not_use: Array.isArray(value.do_not_use)
      ? value.do_not_use.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    preferred_hashtags: uniqueTags,
  };

  return summary;
}

async function fetchGenerationPosts(userId, generationId) {
  if (!userId || !generationId) return [];

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .eq('generation_id', generationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchPostAssetReferences(post) {
  if (!post?.id || !post?.organization_id) return [];
  const links = await fetchOrgPostAssetLinks({
    organizationId: post.organization_id,
    postIds: [post.id],
  });

  return normalizeAssetReferences(
    links
      .filter((link) => link.post_id === post.id)
      .map((link) => ({
        ...(link.asset || {}),
        asset_role: link.asset_role,
      })),
  );
}

async function resolvePrimaryPlatform(selectedAccountIds = []) {
  const [primaryAccountId] = Array.isArray(selectedAccountIds) ? selectedAccountIds : [];
  if (!primaryAccountId) return 'instagram';

  const { data: account, error } = await supabase
    .from('connected_accounts')
    .select('platform')
    .eq('id', primaryAccountId)
    .maybeSingle();

  if (error || !account?.platform) {
    return 'instagram';
  }

  return String(account.platform).trim().toLowerCase() || 'instagram';
}

async function ensureDraftForGeneration({
  userId,
  generationId,
  caption = '',
}) {
  if (!userId || !generationId) return null;

  const existing = await fetchGenerationPosts(userId, generationId);
  const existingDraft = existing.find((row) => row.status === POST_STATUS.DRAFT);
  if (existingDraft) {
    void scheduleDraftMetadataGeneration(existingDraft);
    return existingDraft;
  }

  // If any lifecycle row already exists for this generation, do not mutate it.
  // We only auto-create draft rows for generations with no post records yet.
  if (existing.length > 0) return null;

  const { data: inserted, error: insertError } = await supabase
    .from('posts')
    .insert(withOrgScope({
      user_id: userId,
      generation_id: generationId,
      title: getTitleFromPrompt(caption || ''),
      caption: caption || '',
      hashtags: [],
      scheduled_at: null,
      status: POST_STATUS.DRAFT,
      workflow_state: {
        metadata_status: 'in_progress',
        metadata_updated_at: new Date().toISOString(),
      },
    }))
    .select('*')
    .single();

  if (insertError) throw insertError;

  await ensureLibraryRowsForPosts([{ id: inserted.id, user_id: userId }]);
  void scheduleDraftMetadataGeneration(inserted);
  return inserted;
}

const STAGE_PROGRESS = {
  'Loading brand kit...': { pct: 5, label: 'Loading brand kit...' },
  'Planning content...': { pct: 15, label: 'Planning your content...' },
  'Generating content plan...': { pct: 30, label: 'Generating content plan...' },
  'Quality check...': { pct: 40, label: 'Checking brand guardrails...' },
  'Generating image...': { pct: 60, label: 'Creating your image...' },
};

const mapStageProgress = (stage = '') => {
  if (STAGE_PROGRESS[stage]) return STAGE_PROGRESS[stage];
  if (stage.startsWith('Generating slide')) return { pct: 62, label: stage };
  return { pct: 50, label: stage || 'Generating...' };
};

async function fetchSessionGenerations(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await applyGenerationScope(
    supabase
      .from('generations')
      .select('*')
      .eq('session_id', sessionId),
  )
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function ensureSession(get, userInput) {
  const { activeSession, ensureSessionFromPromptInput, createNewSession } = get();
  if (activeSession?.id) return activeSession;
  const prompt = String(userInput || '').trim();
  if (prompt) {
    const seededSession = await ensureSessionFromPromptInput(prompt);
    if (seededSession?.id) return seededSession;
  }

  const autoTitle = getTitleFromPrompt(prompt);
  return createNewSession(autoTitle, {
    metadata: {
      draft_prompt: prompt || null,
      title_source: 'fallback',
    },
  });
}

const useSessionStore = create((set, get) => ({
  // -- STATE ------------------------------------------------------------------
  sessions: [],
  activeSession: null,
  projects: [],
  activeProject: null,
  projectsLoading: false,
  activeGenerations: [],
  selectedGeneration: null,
  selectedGenerationId: null,
  generationsLoading: false,
  generationsError: null,

  isGenerating: false,
  generationProgress: 0,
  progressLabel: null,
  generationStage: null,
  pendingClarifications: {},
  error: null,

  videoJobState: { ...DEFAULT_VIDEO_JOB_STATE },

  settings: {
    mediaType: 'image', // image | video | edit | image-to-video
    aspectRatio: '1:1',
    batchSize: 1,
    contentType: 'single',
    slideCount: 'auto',
    model: 'realism',
    imageModel: 'ideogram',
    resolution: '2k',
    duration: 6,
    fps: 25,
    generateAudio: false,
    referenceImageUrl: '',
  },

  postProduction: { ...DEFAULT_POST_PRODUCTION },
  generationLineage: null,

  // -- SESSION MANAGEMENT ----------------------------------------------------
  sessionsLoading: false,
  fetchSessions: async () => {
    try {
      set({ sessionsLoading: true });
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { set({ sessionsLoading: false }); return; }

      const { data, error } = await applySessionScope(
        supabase
          .from('sessions')
          .select('*')
          .eq('user_id', user.id),
      )
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      set({ sessions: data || [], sessionsLoading: false });
    } catch (err) {
      console.error('fetchSessions:', err);
      set({ error: err.message, sessionsLoading: false });
    }
  },

  setGenerationLineage: (lineage) => {
    set({ generationLineage: toLineageObject(lineage) });
  },

  fetchGenerations: async (sessionId, options = {}) => {
    const { silent = false } = options;
    if (!sessionId) return [];

    const state = get();
    const hasExisting = state.activeSession?.id === sessionId && state.activeGenerations.length > 0;

    if (!silent && !hasExisting) {
      set({ generationsLoading: true, generationsError: null });
    }

    try {
      const generations = await fetchSessionGenerations(sessionId);
      const selectedId = state.selectedGenerationId;
      const matchedSelection = selectedId
        ? generations.find((generation) => generation.id === selectedId) || null
        : null;

      set({
        activeGenerations: generations,
        selectedGeneration: matchedSelection,
        generationsLoading: false,
        generationsError: null,
      });
      return generations;
    } catch (err) {
      set({ generationsLoading: false });
      if (!hasExisting) {
        set({ generationsError: err.message, error: err.message });
      }
      return state.activeGenerations;
    }
  },

  createNewSession: async (title = 'New Session', options = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const metadata = options?.metadata && typeof options.metadata === 'object'
        ? options.metadata
        : {};

      // Explicit options.projectId (used by the session-history drawer's
      // per-project "+ New session") wins; falls back to activeProject for
      // any older caller that still relies on it. `null` means General.
      const activeProject = get().activeProject;
      const resolvedProjectId = Object.prototype.hasOwnProperty.call(options, 'projectId')
        ? options.projectId
        : (activeProject?.id || null);
      const insertPayload = withSessionScope({ user_id: user.id, title, metadata });
      if (resolvedProjectId) insertPayload.project_id = resolvedProjectId;

      const { data, error } = await supabase
        .from('sessions')
        .insert([insertPayload])
        .select()
        .single();

      if (error) throw error;

      set((state) => ({
        sessions: [data, ...state.sessions],
        activeSession: data,
        activeGenerations: [],
        selectedGeneration: null,
        selectedGenerationId: null,
        generationsLoading: false,
        generationsError: null,
      }));

      return data;
    } catch (err) {
      console.error('createNewSession:', err);
      set({ error: err.message });
      throw err;
    }
  },

  ensureSessionFromPromptInput: async (promptText) => {
    const prompt = String(promptText || '').trim();
    if (!prompt) return get().activeSession;

    const { activeSession } = get();
    if (activeSession?.id) return activeSession;

    const generatedTitle = await generateSessionTitle(prompt);
    return get().createNewSession(generatedTitle, {
      metadata: {
        draft_prompt: prompt,
        title_source: 'groq',
      },
    });
  },

  createSession: async (title = 'New Session') => {
    return get().createNewSession(title);
  },

  // -- PROJECT MANAGEMENT ----------------------------------------------------
  fetchProjects: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      set({ projectsLoading: true });
      const { data, error } = await supabase
        .from('studio_projects')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      set({ projects: data || [], projectsLoading: false });
    } catch (err) {
      console.error('fetchProjects:', err);
      set({ projectsLoading: false });
    }
  },

  createProject: async (name, color = '#7C5CFC') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Append at the end of the current manual order.
      const nextSortOrder = get().projects.length;
      const { data, error } = await supabase
        .from('studio_projects')
        .insert([{ user_id: user.id, name, color, sort_order: nextSortOrder }])
        .select()
        .single();
      if (error) throw error;
      set((state) => ({
        projects: [...state.projects, data],
        activeProject: data,
      }));
      return data;
    } catch (err) {
      console.error('createProject:', err);
      throw err;
    }
  },

  renameProject: async (projectId, name) => {
    const trimmed = String(name || '').trim();
    if (!projectId || !trimmed) return;
    try {
      const { error } = await supabase
        .from('studio_projects')
        .update({ name: trimmed })
        .eq('id', projectId);
      if (error) throw error;
      set((state) => ({
        projects: state.projects.map((p) => (p.id === projectId ? { ...p, name: trimmed } : p)),
      }));
    } catch (err) {
      console.error('renameProject:', err);
      throw err;
    }
  },

  // Deleting a project does NOT delete its sessions — sessions.project_id has
  // ON DELETE SET NULL, so they fall back into "General" automatically.
  deleteProject: async (projectId) => {
    if (!projectId) return;
    try {
      const { error } = await supabase
        .from('studio_projects')
        .delete()
        .eq('id', projectId);
      if (error) throw error;
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== projectId),
        activeProject: state.activeProject?.id === projectId ? null : state.activeProject,
        sessions: state.sessions.map((s) => (s.project_id === projectId ? { ...s, project_id: null } : s)),
      }));
    } catch (err) {
      console.error('deleteProject:', err);
      throw err;
    }
  },

  // orderedIds: full list of this user's project ids in the new display order.
  reorderProjects: async (orderedIds) => {
    const prevProjects = get().projects;
    const byId = new Map(prevProjects.map((p) => [p.id, p]));
    const nextProjects = orderedIds.map((id, index) => ({ ...byId.get(id), sort_order: index })).filter((p) => p.id);
    set({ projects: nextProjects }); // optimistic
    try {
      await Promise.all(
        nextProjects.map((p, index) =>
          supabase.from('studio_projects').update({ sort_order: index }).eq('id', p.id)
        )
      );
    } catch (err) {
      console.error('reorderProjects:', err);
      set({ projects: prevProjects }); // revert on failure
      throw err;
    }
  },

  setActiveProject: (project) => {
    set({ activeProject: project });
  },

  clearActiveSession: () => {
    set({
      activeSession: null,
      activeGenerations: [],
      selectedGeneration: null,
      selectedGenerationId: null,
      generationsLoading: false,
      generationsError: null,
      postProduction: { ...DEFAULT_POST_PRODUCTION },
    });

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  },

  loadSession: async (sessionId) => {
    if (!sessionId) return null;

    try {
      let session = get().sessions.find((item) => item.id === sessionId);

      if (!session) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data, error } = await applySessionScope(
          supabase
            .from('sessions')
            .select('*')
            .eq('id', sessionId)
            .eq('user_id', user.id),
        )
          .maybeSingle();

        if (error) throw error;
        if (!data) return null;
        session = data;
      }

      const currentState = get();
      const isSameSession = currentState.activeSession?.id === sessionId;
      const hasCached = isSameSession && currentState.activeGenerations.length > 0;

      set((state) => ({
        sessions: state.sessions.some((item) => item.id === session.id)
          ? state.sessions
          : [session, ...state.sessions],
        activeSession: session,
        ...(isSameSession
          ? {}
          : {
              activeGenerations: [],
              selectedGeneration: null,
              selectedGenerationId: null,
            }),
        error: null,
      }));

      await get().fetchGenerations(sessionId, { silent: hasCached });
      return session;
    } catch (err) {
      console.error('loadSession:', err);
      set({ error: err.message });
      return null;
    }
  },

  switchSession: async (sessionId) => {
    return get().loadSession(sessionId);
  },

  deleteSession: async (sessionId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await applySessionScope(
        supabase
          .from('sessions')
          .delete()
          .eq('id', sessionId)
          .eq('user_id', user.id),
      );
      if (error) throw error;

      set((state) => ({
        sessions: state.sessions.filter((item) => item.id !== sessionId),
        ...(state.activeSession?.id === sessionId
          ? {
              activeSession: null,
              activeGenerations: [],
              selectedGeneration: null,
              selectedGenerationId: null,
              generationsLoading: false,
              generationsError: null,
            }
          : {}),
      }));
    } catch (err) {
      console.error('deleteSession:', err);
      set({ error: err.message });
      throw err;
    }
  },

  updateSessionTitle: async (sessionId, title) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await applySessionScope(
        supabase
          .from('sessions')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', sessionId)
          .eq('user_id', user.id),
      );
      if (error) throw error;

      set((state) => ({
        sessions: state.sessions.map((item) => (item.id === sessionId ? { ...item, title } : item)),
        activeSession: state.activeSession?.id === sessionId
          ? { ...state.activeSession, title }
          : state.activeSession,
      }));
    } catch (err) {
      console.error('updateSessionTitle:', err);
    }
  },

  // -- GENERATION ACTIONS ----------------------------------------------------
  startGeneration: async (userInput) => {
    const prompt = String(userInput || '').trim();
    if (!prompt) return;

    const { settings, generationLineage } = get();

    if (settings.mediaType === 'video' || settings.mediaType === 'image-to-video') {
      await get().startVideoGeneration(prompt);
      return;
    }

    if (settings.mediaType === 'edit') {
      throw new Error('Edit mode requires a source image. Use startEditGeneration.');
    }

    set({
      isGenerating: true,
      error: null,
      generationProgress: 0,
      progressLabel: 'Preparing generation...',
      generationStage: null,
    });

    try {
      const session = await ensureSession(get, prompt);
      const { pendingClarifications } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);
      const { registerImageGenerator, runGenerationPipeline } = await import('../services/generationPipeline');

      registerImageGenerator(async (promptText, aspectRatio) => {
        set({
          generationProgress: 68,
          progressLabel: 'Requesting image render...',
          generationStage: 'Generating image...',
        });

        const images = await generateImages({
          prompt: promptText,
          aspectRatio,
          numImages: 1,
          brandKit,
          sessionId: session.id,
          imageModel: settings.imageModel || 'ideogram',
          category: 'image',
        });

        const first = images?.[0];
        if (!first?.url) throw new Error('Image renderer returned no image URL');

        set({
          generationProgress: 90,
          progressLabel: 'Uploading to Supabase storage...',
          generationStage: 'Uploading...',
        });

        return first;
      });

      const requestedVariants = Math.max(1, Math.min(Number(settings.batchSize) || 1, 4));
      const generationIds = [];

      for (let index = 0; index < requestedVariants; index += 1) {
        const pipelineResult = await runGenerationPipeline({
          userInput: prompt,
          clarifications: pendingClarifications ?? {},
          sessionId: session.id,
          userId: user.id,
          workspaceScope: getSessionScope(),
          lineageMetadata: {
            ...(generationLineage || {}),
            variant_index: index + 1,
            variant_total: requestedVariants,
          },
          settings: {
            ...settings,
            contentType: settings.contentType ?? 'single',
            mediaType: 'image',
          },
          onProgress: (stage) => {
            const mapped = mapStageProgress(stage);
            const variantOffset = requestedVariants > 1 ? ((index / requestedVariants) * 100) : 0;
            const variantPct = requestedVariants > 1
              ? Math.min(98, Math.round(variantOffset + (mapped.pct / requestedVariants)))
              : mapped.pct;
            set({
              generationProgress: variantPct,
              progressLabel: requestedVariants > 1 ? `Variant ${index + 1}/${requestedVariants}: ${mapped.label}` : mapped.label,
              generationStage: stage,
            });
          },
        });

        if (Array.isArray(pipelineResult?.generationIds)) {
          generationIds.push(...pipelineResult.generationIds);
        }
      }

      if (generationIds.length > 0) {
        await syncOrgScopeToGenerations(generationIds);
      }

      for (const generationId of generationIds) {
        await ensureDraftForGeneration({
          userId: user.id,
          generationId,
          caption: prompt,
        });
      }

      await touchSession(session.id);

      await get().fetchGenerations(session.id, { silent: true });
      dispatchContentSync('generation-completed');
      set({ error: null });
    } catch (err) {
      logGenerationFailure('startGeneration error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
      });
    }
  },

  startCarouselGeneration: async (userInput, slideCount = 'auto') => {
    const prompt = String(userInput || '').trim();
    if (!prompt) return;

    const resolvedCount = slideCount === 'auto'
      ? 'auto'
      : Math.max(2, Number(slideCount) || 2);

    get().updateSettings({
      mediaType: 'image',
      contentType: 'carousel',
      slideCount: resolvedCount,
      batchSize: 1,
    });

    set({
      isGenerating: true,
      error: null,
      generationProgress: 0,
      progressLabel: 'Planning carousel...',
      generationStage: 'Planning carousel...',
    });

    try {
      const { settings, generationLineage } = get();
      const session = await ensureSession(get, prompt);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);
      const { registerImageGenerator, runGenerationPipeline } = await import('../services/generationPipeline');
      const pipelineSettings = {
        ...settings,
        mediaType: 'image',
        contentType: 'carousel',
        slideCount: resolvedCount,
        batchSize: 1,
      };

      set({
        generationProgress: 15,
        progressLabel: 'Breaking into slides...',
        generationStage: 'Breaking into slides...',
      });

      registerImageGenerator(async (promptText, aspectRatio) => {
        const images = await generateImages({
          prompt: promptText,
          aspectRatio,
          numImages: 1,
          brandKit,
          sessionId: session.id,
          imageModel: settings.imageModel || 'ideogram',
          category: 'carousel',
        });

        const first = images?.[0];
        if (!first?.url) throw new Error('Image renderer returned no image URL');
        return first;
      });

      const pipelineResult = await runGenerationPipeline({
        userInput: prompt,
        clarifications: {},
        sessionId: session.id,
        userId: user.id,
        workspaceScope: getSessionScope(),
        lineageMetadata: generationLineage,
        settings: pipelineSettings,
        onProgress: (stage) => {
          const mapped = mapStageProgress(stage);
          set({
            generationProgress: mapped.pct,
            progressLabel: mapped.label,
            generationStage: stage,
          });
        },
      });

      const generationIds = Array.isArray(pipelineResult?.generationIds)
        ? pipelineResult.generationIds
        : [];

      if (generationIds.length > 0) {
        await syncOrgScopeToGenerations(generationIds);
      }

      await touchSession(session.id);

      await get().fetchGenerations(session.id, { silent: true });

      const generatedRows = generationIds.length > 0
        ? await fetchSessionGenerations(session.id)
        : [];
      const generatedById = new Map(generatedRows.map((row) => [row.id, row]));

      for (const generationId of generationIds) {
        const generationRow = generatedById.get(generationId);
        if (generationRow?.status !== GENERATION_STATUS.COMPLETED) continue;
        await ensureDraftForGeneration({
          userId: user.id,
          generationId,
          caption: generationRow?.prompt || prompt,
        });
      }

      dispatchContentSync('carousel-completed');
      set({ error: null });

      set({
        generationProgress: 100,
        progressLabel: 'Done!',
        generationStage: 'Done!',
      });
    } catch (err) {
      logGenerationFailure('startCarouselGeneration error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
      });
    }
  },

  startEditGeneration: async (sourceImageUrl, instruction) => {
    const cleanSource = String(sourceImageUrl || '').trim();
    const prompt = String(instruction || '').trim();

    if (!cleanSource) throw new Error('Source image is required for edit mode');
    if (!prompt) throw new Error('Edit instruction is required');

    set({
      isGenerating: true,
      error: null,
      generationProgress: 8,
      progressLabel: 'Preparing edit...',
      generationStage: 'Preparing',
    });

    let createdGeneration = null;

    try {
      const session = await ensureSession(get, prompt);
      const { settings, generationLineage } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);

      const { data: created, error: insertError } = await supabase
        .from('generations')
        .insert(withOrgScope({
          user_id: user.id,
          session_id: session.id,
          prompt,
          media_type: 'image',
          status: GENERATION_STATUS.PROCESSING,
          progress: 10,
          metadata: {
            edit_mode: true,
            source_image_url: cleanSource,
            aspect_ratio: settings.aspectRatio,
            model: 'flux-pro/kontext',
            provider: 'fal-ai',
            ...(generationLineage ? { lineage: generationLineage } : {}),
          },
        }))
        .select()
        .single();

      if (insertError) throw insertError;
      createdGeneration = created;

      set((state) => ({
        activeGenerations: [...state.activeGenerations, created],
        generationProgress: 35,
        progressLabel: 'Applying image edit...',
        generationStage: 'Editing image...',
      }));

      const edited = await editImage({
        prompt,
        sourceImageUrl: cleanSource,
        brandKit,
        aspectRatio: settings.aspectRatio,
      });

      set({
        generationProgress: 88,
        progressLabel: 'Saving edited image...',
        generationStage: 'Uploading...',
      });

      const metadata = {
        ...(created.metadata || {}),
        width: edited.width,
        height: edited.height,
        provider: edited.provider || 'fal-ai',
        provider_model: edited.providerModel || 'fal-ai/flux-pro/kontext',
        provider_endpoint: edited.providerEndpoint || 'fal-ai/flux-pro/kontext',
        generation_time_ms: edited.generationTimeMs || null,
        generation_cost: edited.generationCost || null,
      };

      const { error: updateError } = await supabase
        .from('generations')
        .update({
          status: GENERATION_STATUS.COMPLETED,
          progress: 100,
          storage_path: edited.url,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', created.id);

      if (updateError) throw updateError;

      await touchSession(session.id);

      await get().fetchGenerations(session.id, { silent: true });
      await ensureDraftForGeneration({
        userId: user.id,
        generationId: created.id,
        caption: prompt,
      });
      dispatchContentSync('edit-completed');
      set({ error: null });
      return edited.url;
    } catch (err) {
      logGenerationFailure('startEditGeneration error', err);
      if (createdGeneration?.id) {
        await supabase
          .from('generations')
          .update({
            status: GENERATION_STATUS.FAILED,
            updated_at: new Date().toISOString(),
          })
          .eq('id', createdGeneration.id);
      }
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
      });
    }
  },

  startVideoGeneration: async (userInput) => {
    const prompt = String(userInput || '').trim();
    if (!prompt) return;

    const existingInterval = get().videoJobState.pollInterval;
    if (existingInterval) clearInterval(existingInterval);

    set((state) => ({
      isGenerating: true,
      error: null,
      generationProgress: 10,
      progressLabel: 'Queuing video job...',
      generationStage: 'Video queued',
      videoJobState: {
        ...state.videoJobState,
        ...DEFAULT_VIDEO_JOB_STATE,
        status: 'submitting',
        prompt,
        progress: 10,
      },
    }));

    try {
      const session = await ensureSession(get, prompt);
      const { settings } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);
      const videoMode = settings.mediaType === 'image-to-video' ? 'image-to-video' : 'text-to-video';
      if (videoMode === 'image-to-video' && !String(settings.referenceImageUrl || '').trim()) {
        throw new Error('Source image is required for image-to-video generation');
      }
      const videoJob = await createVideoJob({
        prompt,
        aspectRatio: settings.aspectRatio,
        duration: settings.duration || 6,
        brandKit,
        mode: videoMode,
        imageUrl: settings.referenceImageUrl || '',
        quality: settings.videoQuality === 'premium' ? 'premium' : 'standard',
        sessionId: session.id,
      });

      if (videoJob.tierUpgraded) {
        toast(
          'Standard tier requires a source image — this rendered at premium quality instead, billed accordingly.',
          { icon: 'ℹ️', duration: 6000 },
        );
      }

      const { data: created, error: insertError } = await supabase
        .from('generations')
        .insert(withOrgScope({
          user_id: user.id,
          session_id: session.id,
          prompt,
          media_type: 'video',
          status: GENERATION_STATUS.COMPLETED,
          progress: 100,
          storage_path: videoJob.videoUrl || null,
          metadata: {
            provider: videoJob.provider || 'fal-ai',
            provider_model: videoJob.providerModel || null,
            provider_endpoint: videoJob.providerEndpoint || null,
            generation_mode: videoMode,
            source_image_url: videoMode === 'image-to-video' ? settings.referenceImageUrl || null : null,
            aspect_ratio: settings.aspectRatio,
            requested_quality: videoJob.requestedQuality,
            actual_quality: videoJob.actualQuality,
            tier_upgraded: Boolean(videoJob.tierUpgraded),
            duration: settings.duration || 6,
            generation_cost: videoJob.generationCost || null,
          },
        }))
        .select()
        .single();

      if (insertError) throw insertError;

      set((state) => ({
        activeGenerations: [...state.activeGenerations, created],
        generationProgress: 100,
        progressLabel: 'Video completed',
        generationStage: 'Processing video...',
        videoJobState: {
          ...state.videoJobState,
          status: GENERATION_STATUS.COMPLETED,
          generationId: created.id,
          providerEndpoint: videoJob.providerEndpoint || null,
          progress: 100,
          videoUrl: videoJob.videoUrl || null,
        },
      }));

      await touchSession(session.id);

      await get().fetchGenerations(session.id, { silent: true });
      await ensureDraftForGeneration({
        userId: user.id,
        generationId: created.id,
        caption: prompt,
      });
      dispatchContentSync('video-completed');
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
      });
      return videoJob.videoUrl;
    } catch (err) {
      logGenerationFailure('startVideoGeneration error', err);
      set((state) => ({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
        error: err.message,
        videoJobState: {
          ...state.videoJobState,
          status: GENERATION_STATUS.FAILED,
          progress: 100,
          pollInterval: null,
        },
      }));
      throw err;
    }
  },

  dismissVideoJob: () => {
    const pollInterval = get().videoJobState.pollInterval;
    if (pollInterval) clearInterval(pollInterval);

    set({
      isGenerating: false,
      videoJobState: { ...DEFAULT_VIDEO_JOB_STATE },
      generationProgress: 0,
      progressLabel: null,
      generationStage: null,
    });
  },

  setVideoJobMinimized: (isMinimized) => {
    set((state) => ({
      videoJobState: {
        ...state.videoJobState,
        isMinimized: Boolean(isMinimized),
      },
    }));
  },

  enhancePrompt: async (prompt) => {
    try {
      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        return {
          enhancedPrompt: '',
          suggestions: [],
        };
      }

      let promptContext = {};
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const brandKit = await loadBrandKit(user.id);
          const previousPrompts = Array.from(new Set(
            (get().activeGenerations || [])
              .map((generation) => String(generation?.prompt || '').trim())
              .filter(Boolean),
          )).slice(0, 8);

          promptContext = {
            brandKit: sanitizeBrandKitForPrompt(brandKit?.raw || brandKit),
            previousPrompts,
          };
        }
      } catch (contextError) {
        console.warn('[SessionStore] enhancePrompt context fallback:', contextError?.message || contextError);
      }

      const edgeResponse = await supabase.functions.invoke('enhance-prompt', {
        body: {
          prompt: cleanPrompt,
          variantCount: 3,
          ...promptContext,
        },
      });

      if (!edgeResponse.error) {
        const fromEdge = edgeResponse.data?.enhancedPrompt || edgeResponse.data?.enhanced_prompt || '';
        const options = Array.isArray(edgeResponse.data?.suggestions)
          ? edgeResponse.data.suggestions
          : [fromEdge];

        const normalized = options
          .map((entry) => String(entry || '').trim())
          .filter(Boolean);

        if (normalized.length > 0) {
          return {
            enhancedPrompt: normalized[0],
            suggestions: normalized,
          };
        }
      }

      const fallback = await apiEnhancePrompt(cleanPrompt);
      const normalizedFallback = String(fallback || cleanPrompt).trim();
      return {
        enhancedPrompt: normalizedFallback,
        suggestions: normalizedFallback ? [normalizedFallback] : [],
      };
    } catch (err) {
      console.error('enhancePrompt:', err);
      const safe = String(prompt || '').trim();
      return {
        enhancedPrompt: safe,
        suggestions: safe ? [safe] : [],
      };
    }
  },

  // -- POST-PRODUCTION -------------------------------------------------------
  setSelectedGenerationId: (id) => {
    const nextId = id ? String(id) : null;
    const matchedGeneration = nextId
      ? get().activeGenerations.find((generation) => generation.id === nextId) || null
      : null;

    set({
      selectedGenerationId: nextId,
      selectedGeneration: matchedGeneration,
    });
  },

  selectGeneration: (generationOrId) => {
    const byId = typeof generationOrId === 'string' ? generationOrId : generationOrId?.id;
    const selectedId = byId ? String(byId) : null;
    const selectedGeneration = selectedId
      ? (
          typeof generationOrId === 'object' && generationOrId
            ? generationOrId
            : get().activeGenerations.find((generation) => generation.id === selectedId) || null
        )
      : null;

    set({
      selectedGenerationId: selectedId,
      selectedGeneration,
    });

    const currentPath = window.location.pathname;
    if (selectedId) {
      window.history.replaceState(null, '', `${currentPath}#${selectedId}`);
    } else {
      window.history.replaceState(null, '', currentPath);
    }
  },

  resetPostProduction: () => {
    set({ postProduction: { ...DEFAULT_POST_PRODUCTION } });
  },

  generateCaption: async (platform = 'instagram') => {
    const { selectedGeneration } = get();
    if (!selectedGeneration) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: previousCaptionRows, error: previousCaptionError } = await supabase
        .from('posts')
        .select('caption')
        .eq('user_id', user.id)
        .not('caption', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5);
      if (previousCaptionError) throw previousCaptionError;

      const brandKit = await loadBrandKit(user.id);
      const { data, error } = await supabase.functions.invoke('generate-caption', {
        body: {
          imageDescription: selectedGeneration.prompt || selectedGeneration.metadata?.enhanced_prompt || '',
          platform: String(platform || 'instagram').toLowerCase(),
          brandKit,
          previousCaptions: (previousCaptionRows || [])
            .map((row) => String(row.caption || '').trim())
            .filter(Boolean),
          tone: null,
        },
      });
      if (error) throw error;

      const result = data || {};
      set((state) => ({
        postProduction: {
          ...state.postProduction,
          caption: result.caption || '',
          hashtags: normalizeHashtags(result.hashtags || []),
        },
      }));
      return result;
    } catch (err) {
      console.error('generateCaption:', err);
      throw err;
    }
  },

  regeneratePostMetadata: async (fields = ['title', 'caption', 'hashtags']) => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration?.id) {
      throw new Error('No generation selected.');
    }

    const requestedFields = normalizeMetadataFields(fields);
    const metadataUpdatedAt = new Date().toISOString();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const rows = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const preferred = rows.find((row) => row.status === POST_STATUS.DRAFT)
        || rows.find((row) => NON_TERMINAL_STATUSES.includes(row.status))
        || rows[0]
        || null;

      const postId = preferred?.id || postProduction.postId || null;
      if (postId) {
        const nextWorkflowState = {
          ...(preferred?.workflow_state && typeof preferred.workflow_state === 'object'
            ? preferred.workflow_state
            : {}),
          metadata_status: 'in_progress',
          metadata_error: null,
          metadata_updated_at: metadataUpdatedAt,
        };

        const { error: metadataUpdateError } = await supabase
          .from('posts')
          .update({
            workflow_state: nextWorkflowState,
            updated_at: metadataUpdatedAt,
          })
          .eq('id', postId);
        if (metadataUpdateError) throw metadataUpdateError;
      }

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          metadataStatus: 'in_progress',
          seoStatus: 'metadata_generating',
          metadataUpdatedAt,
        },
      }));

      let result = null;
      if (postId) {
        result = await requestPostMetadataForDraft({
          id: postId,
          generation_id: selectedGeneration.id,
          organization_id: preferred?.organization_id || null,
          workflow_state: preferred?.workflow_state || {},
        }, requestedFields);
      } else {
        const { data, error } = await supabase.functions.invoke('generate-post-metadata', {
          body: {
            generation_id: selectedGeneration.id,
            fields: requestedFields,
          },
        });
        if (error) {
          throw normalizeEdgeFunctionError(error, 'generate-post-metadata');
        }
        result = data || null;
      }

      const hydrated = await get().hydratePostProductionFromGeneration(selectedGeneration.id);
      if (!hydrated && result) {
        set((state) => ({
          postProduction: {
            ...state.postProduction,
            ...(requestedFields.includes('title')
              ? { title: String(result?.title || state.postProduction.title || '').trim() }
              : {}),
            ...(requestedFields.includes('caption')
              ? { caption: String(result?.caption || state.postProduction.caption || '').trim() }
              : {}),
            ...(requestedFields.includes('hashtags')
              ? { hashtags: normalizeHashtags(result?.hashtags || state.postProduction.hashtags || []) }
              : {}),
            metadataStatus: 'completed',
            metadataUpdatedAt: new Date().toISOString(),
            seoScore: 0,
            seoCategory: 'Not scored',
            seoBreakdown: { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
            seoSuggestions: [],
            seoBenchmarkReport: [],
            seoHashtagSuggestions: [],
            seoStatus: 'idle',
          },
        }));
      } else {
        set((state) => ({
          postProduction: {
            ...state.postProduction,
            seoScore: 0,
            seoCategory: 'Not scored',
            seoBreakdown: { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
            seoSuggestions: [],
            seoBenchmarkReport: [],
            seoHashtagSuggestions: [],
            seoStatus: 'idle',
          },
        }));
      }

      return result || {};
    } catch (error) {
      set((state) => ({
        postProduction: {
          ...state.postProduction,
          metadataStatus: 'failed',
          metadataUpdatedAt: new Date().toISOString(),
        },
      }));
      throw error;
    }
  },

  scoreSeo: async () => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration) {
      throw new Error('No generation selected');
    }

    if (!String(postProduction.caption || '').trim()) {
      throw new Error('Caption is required before scoring SEO.');
    }

    try {
      set((state) => ({
        postProduction: {
          ...state.postProduction,
          seoStatus: 'scoring',
        },
      }));

      const platform = await resolvePrimaryPlatform(postProduction.selectedPlatforms || []);
      const { data, error } = await supabase.functions.invoke('seo-score', {
        body: {
          content_id: postProduction.postId || null,
          title: String(postProduction.title || '').trim(),
          caption: String(postProduction.caption || '').trim(),
          hashtags: normalizeHashtags(postProduction.hashtags || []),
          platform,
          media_type: selectedGeneration.media_type || 'image',
          visual_prompt: selectedGeneration.prompt || '',
        },
      });

      if (error) {
        throw normalizeEdgeFunctionError(error, 'seo-score');
      }

      const normalized = normalizeSeoScorePayload(data || {});

      if (postProduction.postId) {
        const { data: currentPost } = await supabase
          .from('posts')
          .select('seo_state, workflow_state')
          .eq('id', postProduction.postId)
          .maybeSingle();

        await supabase
          .from('posts')
          .update({
            seo_state: {
              ...(currentPost?.seo_state && typeof currentPost.seo_state === 'object' ? currentPost.seo_state : {}),
              seo_score: normalized.overall,
              discovery_score: normalized.overall,
              score_category: normalized.category,
              score_breakdown: normalized.breakdown,
              suggestions: normalized.suggestions,
              recommendations: normalized.suggestions,
              benchmark_report: normalized.benchmarkReport,
              hashtag_suggestions: normalized.hashtagSuggestions,
              provider: normalized.provider,
              model: normalized.model,
              provider_warning: normalized.providerWarning,
              updated_at: new Date().toISOString(),
            },
            workflow_state: {
              ...(currentPost?.workflow_state && typeof currentPost.workflow_state === 'object' ? currentPost.workflow_state : {}),
              seo_status: 'scored',
              seo_updated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', postProduction.postId);
      }

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          seoScore: normalized.overall,
          seoCategory: normalized.category,
          seoBreakdown: normalized.breakdown,
          seoSuggestions: normalized.suggestions,
          seoBenchmarkReport: normalized.benchmarkReport,
          seoHashtagSuggestions: normalized.hashtagSuggestions,
          seoProvider: normalized.provider,
          seoStatus: 'scored',
        },
      }));

      return normalized;
    } catch (err) {
      set((state) => ({
        postProduction: {
          ...state.postProduction,
          seoStatus: 'failed',
        },
      }));
      console.error('scoreSeo:', err);
      throw err;
    }
  },

  // Org-only: checks the current caption/hashtags against the org's brand
  // voice via ai-brand-consistency-check. organizationId/brandProjectId are
  // passed explicitly by the caller (PostProductionPanel reads them from
  // useOrgContext()) since this store isn't itself org-scoped.
  checkBrandConsistency: async (organizationId, brandProjectId) => {
    const { postProduction } = get();
    if (!organizationId || !brandProjectId) {
      throw new Error('Brand consistency check requires an active organization and brand project.');
    }
    if (!String(postProduction.caption || '').trim()) {
      throw new Error('Caption is required before checking brand consistency.');
    }

    try {
      set((state) => ({
        postProduction: { ...state.postProduction, brandConsistencyStatus: 'checking' },
      }));

      const platform = await resolvePrimaryPlatform(postProduction.selectedPlatforms || []);
      const { data, error } = await supabase.functions.invoke('ai-brand-consistency-check', {
        body: {
          organization_id: organizationId,
          brand_project_id: brandProjectId,
          caption: String(postProduction.caption || '').trim(),
          hashtags: normalizeHashtags(postProduction.hashtags || []),
          platform,
        },
      });

      if (error) {
        throw normalizeEdgeFunctionError(error, 'ai-brand-consistency-check');
      }

      const result = data?.result || {};
      const normalized = {
        score: typeof result.overall_score === 'number' ? result.overall_score : null,
        pass: typeof result.passes === 'boolean' ? result.passes : null,
        issues: Array.isArray(result.issues) ? result.issues : [],
        notes: Array.isArray(result.positive_notes) ? result.positive_notes : [],
      };

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          brandConsistencyStatus: 'checked',
          brandConsistencyScore: normalized.score,
          brandConsistencyPass: normalized.pass,
          brandConsistencyIssues: normalized.issues,
          brandConsistencyNotes: normalized.notes,
        },
      }));

      return normalized;
    } catch (err) {
      set((state) => ({
        postProduction: { ...state.postProduction, brandConsistencyStatus: 'failed' },
      }));
      console.error('checkBrandConsistency:', err);
      throw err;
    }
  },

  optimizeSeo: async () => {
    const { postProduction, selectedGeneration } = get();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          seoStatus: 'optimizing',
        },
      }));

      const platform = await resolvePrimaryPlatform(postProduction.selectedPlatforms || []);
      const brandKit = await loadBrandKit(user.id);
      const { data, error } = await supabase.functions.invoke('optimize-seo', {
        body: {
          title: String(postProduction.title || '').trim(),
          caption: postProduction.caption,
          hashtags: normalizeHashtags(postProduction.hashtags),
          platform,
          brandKit,
          targetKeywords: [],
          mediaType: selectedGeneration?.media_type || 'image',
          visualPrompt: selectedGeneration?.prompt || '',
        },
      });
      if (error) throw normalizeEdgeFunctionError(error, 'optimize-seo');

      const result = data || {};
      const optimizedTitle = String(
        result.optimized_title
          || result.optimizedTitle
          || postProduction.title
          || '',
      ).trim();
      const optimizedCaption = String(
        result.optimized_caption
          || result.optimizedCaption
          || postProduction.caption
          || '',
      ).trim();
      const optimizedHashtags = normalizeHashtags(
        result.optimized_hashtags
          || result.optimizedHashtags
          || postProduction.hashtags
          || [],
      );

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          title: optimizedTitle,
          caption: optimizedCaption,
          hashtags: optimizedHashtags,
        },
      }));

      if (postProduction.postId) {
        const { data: currentPost } = await supabase
          .from('posts')
          .select('workflow_state')
          .eq('id', postProduction.postId)
          .maybeSingle();

        await supabase
          .from('posts')
          .update({
            title: optimizedTitle || null,
            caption: optimizedCaption,
            hashtags: optimizedHashtags,
            workflow_state: {
              ...(currentPost?.workflow_state && typeof currentPost.workflow_state === 'object'
                ? currentPost.workflow_state
                : {}),
              seo_status: 'optimized',
              seo_optimized_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', postProduction.postId);
      }

      const scored = await get().scoreSeo();
      return {
        ...scored,
        optimizedTitle,
        optimizedCaption,
        optimizedHashtags,
      };
    } catch (err) {
      set((state) => ({
        postProduction: {
          ...state.postProduction,
          seoStatus: 'failed',
        },
      }));
      console.error('optimizeSeo:', err);
      throw err;
    }
  },

  optimizeCaption: async () => {
    return get().optimizeSeo();
  },

  updatePostProduction: (updates) => {
    set((state) => ({
      postProduction: {
        ...state.postProduction,
        ...updates,
        ...(
          Object.prototype.hasOwnProperty.call(updates || {}, 'title')
          || Object.prototype.hasOwnProperty.call(updates || {}, 'caption')
          || Object.prototype.hasOwnProperty.call(updates || {}, 'hashtags')
            ? { seoStatus: 'idle' }
            : {}
        ),
      },
    }));
  },

  hydratePostProductionFromGeneration: async (generationId) => {
    if (!generationId) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const rows = await fetchGenerationPosts(user.id, generationId);
    if (!rows.length) return null;

    const requestedPostId = get().postProduction?.postId || null;
    const preferred = (requestedPostId ? rows.find((row) => row.id === requestedPostId) : null)
      || rows.find((row) => row.status === POST_STATUS.DRAFT)
      || rows.find((row) => NON_TERMINAL_STATUSES.includes(row.status))
      || rows[0];

    if (!preferred) return null;

    const { caption, hashtags } = splitCaptionAndHashtags(preferred.caption || '');
    const workflowState = preferred.workflow_state && typeof preferred.workflow_state === 'object'
      ? preferred.workflow_state
      : {};
    const metadataStatus = String(workflowState.metadata_status || '').trim().toLowerCase() || 'idle';
    const metadataUpdatedAt = workflowState.metadata_generated_at
      || workflowState.metadata_updated_at
      || null;
    const selectedPlatforms = rows
      .filter((row) => row.account_id && row.status !== POST_STATUS.FAILED)
      .map((row) => row.account_id);
    const assetReferences = await fetchPostAssetReferences(preferred);
    const title = String(preferred.title || '').trim();
    const preferredHashtags = Array.isArray(preferred.hashtags) && preferred.hashtags.length > 0
      ? normalizeHashtags(preferred.hashtags)
      : hashtags;
    const seoState = preferred.seo_state && typeof preferred.seo_state === 'object'
      ? preferred.seo_state
      : {};
    const normalizedSeo = normalizeSeoScorePayload(seoState);
    const hasSeoScore = Number(normalizedSeo.overall) > 0;

    set((state) => ({
      postProduction: {
        ...state.postProduction,
        postId: preferred.id,
        title: title || state.postProduction.title || '',
        caption,
        hashtags: preferredHashtags,
        selectedPlatforms: [...new Set(selectedPlatforms)],
        scheduleDate: preferred.status === POST_STATUS.SCHEDULED
          ? preferred.scheduled_at
          : (state.postProduction.scheduleDate || null),
        assetReferences,
        metadataStatus,
        metadataUpdatedAt,
        seoScore: hasSeoScore ? normalizedSeo.overall : 0,
        seoCategory: hasSeoScore ? normalizedSeo.category : 'Not scored',
        seoBreakdown: hasSeoScore
          ? normalizedSeo.breakdown
          : { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
        seoSuggestions: hasSeoScore ? normalizedSeo.suggestions : [],
        seoBenchmarkReport: hasSeoScore ? normalizedSeo.benchmarkReport : [],
        seoHashtagSuggestions: hasSeoScore ? normalizedSeo.hashtagSuggestions : [],
        seoProvider: normalizedSeo.provider,
        seoStatus: hasSeoScore ? 'scored' : 'idle',
      },
    }));

    if (shouldGenerateDraftMetadata(preferred)) {
      void scheduleDraftMetadataGeneration(preferred);
    }

    return preferred;
  },

  preparePostForApproval: async () => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration) throw new Error('No generation selected');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const finalCaption = buildFinalCaption(
        postProduction.caption || selectedGeneration.prompt || '',
        postProduction.hashtags,
      );
      const title = String(postProduction.title || '').trim()
        || getTitleFromPrompt(postProduction.caption || selectedGeneration.prompt || '');
      const selectedAccountId = postProduction.selectedPlatforms[0] || null;

      const existing = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const orgScope = getActiveOrgScope();
      const reusable = (postProduction.postId
        ? existing.find((row) => row.id === postProduction.postId)
        : null)
        || existing.find((row) => row.status === POST_STATUS.DRAFT)
        || existing.find((row) => NON_TERMINAL_STATUSES.includes(row.status));
      let targetPostId = reusable?.id || null;

      if (reusable) {
        const nextStatus = assertPostStatusTransition(reusable.status, POST_STATUS.DRAFT, 'preparePostForApproval');
        const { error: updateError } = await supabase
          .from('posts')
          .update(withOrgScope({
            title,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            account_id: selectedAccountId,
            scheduled_at: null,
            status: nextStatus,
            updated_at: new Date().toISOString(),
          }))
          .eq('id', reusable.id);

        if (updateError) throw updateError;
        targetPostId = reusable.id;
        await ensureLibraryRowsForPosts([{ id: reusable.id, user_id: user.id }]);
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('posts')
          .insert(withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: selectedAccountId,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: null,
            status: POST_STATUS.DRAFT,
          }))
          .select('id, user_id')
          .single();

        if (insertError) throw insertError;
        await ensureLibraryRowsForPosts([inserted]);
        targetPostId = inserted.id;
      }

      if (targetPostId && orgScope?.organization_id) {
        await syncOrgPostAssetLinks({
          organizationId: orgScope.organization_id,
          postId: targetPostId,
          assetReferences: normalizeAssetReferences(postProduction.assetReferences),
          createdBy: user.id,
        });
      }

      const { data: preparedPost, error: preparedError } = await supabase
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
          pipeline_item_id,
          workflow_state
        `)
        .eq('id', targetPostId)
        .single();

      if (preparedError) throw preparedError;

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          postId: preparedPost.id,
        },
      }));

      dispatchContentSync('approval-draft-prepared');
      return preparedPost;
    } catch (err) {
      console.error('preparePostForApproval:', err);
      throw err;
    }
  },

  saveDraft: async () => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration) throw new Error('No generation selected');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const finalCaption = buildFinalCaption(
        postProduction.caption || selectedGeneration.prompt || '',
        postProduction.hashtags,
      );
      const title = String(postProduction.title || '').trim()
        || getTitleFromPrompt(postProduction.caption || selectedGeneration.prompt || '');

      const selectedAccountId = postProduction.selectedPlatforms[0] || null;
      const existing = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const reusable = existing.find((row) => row.status === POST_STATUS.DRAFT)
        || existing.find((row) => NON_TERMINAL_STATUSES.includes(row.status));
      const orgScope = getActiveOrgScope();
      let targetPostId = reusable?.id || null;

      if (reusable) {
        const nextStatus = assertPostStatusTransition(reusable.status, POST_STATUS.DRAFT, 'saveDraft');
        const { error: updateError } = await supabase
          .from('posts')
          .update(withOrgScope({
            title,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            account_id: selectedAccountId,
            scheduled_at: null,
            status: nextStatus,
          }))
          .eq('id', reusable.id);

        if (updateError) throw updateError;
        targetPostId = reusable.id;
        await ensureLibraryRowsForPosts([{ id: reusable.id, user_id: user.id }]);
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('posts')
          .insert(withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: selectedAccountId,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: null,
            status: POST_STATUS.DRAFT,
          }))
          .select('id, user_id')
          .single();

        if (insertError) throw insertError;
        await ensureLibraryRowsForPosts([inserted]);
        targetPostId = inserted.id;
      }

      if (targetPostId && orgScope?.organization_id) {
        await syncOrgPostAssetLinks({
          organizationId: orgScope.organization_id,
          postId: targetPostId,
          assetReferences: normalizeAssetReferences(postProduction.assetReferences),
          createdBy: user.id,
        });
      }

      set({
        selectedGeneration: null,
        selectedGenerationId: null,
        postProduction: { ...DEFAULT_POST_PRODUCTION },
      });
      window.history.replaceState(null, '', window.location.pathname);
      dispatchContentSync('draft-saved');

      return {
        success: true,
        message: 'Saved to drafts!',
        status: POST_STATUS.DRAFT,
      };
    } catch (err) {
      console.error('saveDraft:', err);
      throw err;
    }
  },

  publishContent: async () => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration) throw new Error('No generation selected');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (postProduction.selectedPlatforms.length === 0) {
        throw new Error('Select at least one platform');
      }

      const finalCaption = buildFinalCaption(
        postProduction.caption || selectedGeneration.prompt || '',
        postProduction.hashtags,
      );
      const title = String(postProduction.title || '').trim()
        || getTitleFromPrompt(postProduction.caption || selectedGeneration.prompt || '');

      const scheduleDate = postProduction.scheduleDate || new Date().toISOString();
      const isImmediatePublish = !postProduction.scheduleDate;
      const status = postProduction.scheduleDate ? POST_STATUS.SCHEDULED : POST_STATUS.PUBLISHING;
      const [primaryAccountId, ...secondaryAccountIds] = postProduction.selectedPlatforms;
      const accountIdsForPublish = [...new Set(postProduction.selectedPlatforms.filter(Boolean))];
      const { data: selectedAccountRows, error: selectedAccountsError } = await supabase
        .from('connected_accounts')
        .select('id, platform, account_name, display_name, username, avatar_url, profile_picture_url')
        .in('id', accountIdsForPublish);
      if (selectedAccountsError) throw selectedAccountsError;

      const selectedAccountMap = new Map((selectedAccountRows || []).map((account) => [account.id, account]));
      const unresolvedAccountId = accountIdsForPublish.find((accountId) => !selectedAccountMap.get(accountId)?.platform);
      if (unresolvedAccountId) {
        throw new Error('One selected platform account is no longer available. Refresh connected accounts and try again.');
      }
      const primaryPlatform = selectedAccountMap.get(primaryAccountId)?.platform || await resolvePrimaryPlatform([primaryAccountId]);
      const existing = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const insertedRows = [];
      const targetPostIds = [];
      const publishTargets = [];
      const orgScope = getActiveOrgScope();

      const reusable = existing.find((row) => row.status === POST_STATUS.DRAFT)
        || existing.find((row) => NON_TERMINAL_STATUSES.includes(row.status));

      if (reusable) {
        const nextStatus = assertPostStatusTransition(reusable.status, status, 'publishContent-primary');
        const { error: updateError } = await supabase
          .from('posts')
          .update(withOrgScope({
            title,
            account_id: primaryAccountId,
            platform: primaryPlatform,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduleDate,
            status: nextStatus,
          }))
          .eq('id', reusable.id);
        if (updateError) throw updateError;
        targetPostIds.push(reusable.id);
        publishTargets.push({ postId: reusable.id, accountId: primaryAccountId });
      } else {
        const { data: insertedPrimary, error: insertPrimaryError } = await supabase
          .from('posts')
          .insert(withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: primaryAccountId,
            platform: primaryPlatform,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduleDate,
            status,
          }))
          .select('id, user_id')
          .single();

        if (insertPrimaryError) throw insertPrimaryError;
        insertedRows.push(insertedPrimary);
        targetPostIds.push(insertedPrimary.id);
        publishTargets.push({ postId: insertedPrimary.id, accountId: primaryAccountId });
      }

      for (const accountId of secondaryAccountIds) {
        const platform = selectedAccountMap.get(accountId)?.platform || null;
        const accountRow = existing.find((row) => row.account_id === accountId);
        if (accountRow && NON_TERMINAL_STATUSES.includes(accountRow.status)) {
          const nextStatus = assertPostStatusTransition(accountRow.status, status, 'publishContent-secondary');
          const { error: updateAccountError } = await supabase
            .from('posts')
          .update(withOrgScope({
              title,
              platform,
              caption: finalCaption,
              hashtags: normalizeHashtags(postProduction.hashtags),
              scheduled_at: scheduleDate,
              status: nextStatus,
            }))
            .eq('id', accountRow.id);
          if (updateAccountError) throw updateAccountError;
          targetPostIds.push(accountRow.id);
          publishTargets.push({ postId: accountRow.id, accountId });
          continue;
        }

        const { data: insertedAccount, error: insertAccountError } = await supabase
          .from('posts')
          .insert(withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: accountId,
            platform,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduleDate,
            status,
          }))
          .select('id, user_id')
          .single();
        if (insertAccountError) throw insertAccountError;
        insertedRows.push(insertedAccount);
        targetPostIds.push(insertedAccount.id);
        publishTargets.push({ postId: insertedAccount.id, accountId });
      }

      const libraryRows = [
        ...insertedRows,
        ...targetPostIds
          .filter((postId) => !insertedRows.some((row) => row.id === postId))
          .map((postId) => ({ id: postId, user_id: user.id })),
      ];

      if (libraryRows.length > 0) {
        await ensureLibraryRowsForPosts(libraryRows);
      }

      const refreshedRows = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const staleDraftIds = refreshedRows
        .filter((row) => row.status === POST_STATUS.DRAFT)
        .map((row) => row.id);

      if (staleDraftIds.length > 0) {
        const { error: cleanupError } = await supabase
          .from('posts')
          .delete()
          .in('id', staleDraftIds);
        if (cleanupError) throw cleanupError;
      }

      if (orgScope?.organization_id && targetPostIds.length > 0) {
        await Promise.all(targetPostIds.map((postId) => syncOrgPostAssetLinks({
          organizationId: orgScope.organization_id,
          postId,
          assetReferences: normalizeAssetReferences(postProduction.assetReferences),
          createdBy: user.id,
        })));
      }

      set({
        selectedGeneration: null,
        selectedGenerationId: null,
        postProduction: { ...DEFAULT_POST_PRODUCTION },
      });
      window.history.replaceState(null, '', window.location.pathname);

      if (isImmediatePublish) {
        const { attempts, summary } = await executeMockPublishAttempts({
          source: orgScope?.organization_id ? 'org_generate' : 'generate',
          sessionId: selectedGeneration.session_id || selectedGeneration.id || null,
          viewPath: orgScope?.organization_id ? `/app/org/${orgScope.organization_id}/calendar` : '/app/library',
          viewLabel: orgScope?.organization_id ? 'View in Calendar' : 'View in Library',
          accountsPath: orgScope?.organization_id ? `/app/org/${orgScope.organization_id}/admin/settings` : '/app/settings',
          accountsLabel: 'Open Connected Accounts',
          attempts: publishTargets.map((target) => {
            const account = selectedAccountMap.get(target.accountId) || {};
            return {
              postId: target.postId,
              accountId: target.accountId,
              userId: user.id,
              organizationId: orgScope?.organization_id || null,
              platform: account.platform || 'unknown',
              platformDisplayName: account.platform || 'Platform',
              accountDisplayName: account.display_name || account.account_name || account.username || 'Connected account',
              accountUsername: account.username || '',
              profilePictureUrl: account.profile_picture_url || account.avatar_url || '',
              caption: finalCaption,
              mediaUrl: selectedGeneration.storage_path || null,
              mediaType: selectedGeneration.media_type || 'image',
              settingsPath: orgScope?.organization_id ? `/app/org/${orgScope.organization_id}/admin/settings` : '/app/settings',
            };
          }),
        });

        dispatchContentSync(summary.anyFailed ? 'post-publish-complete' : 'post-published');

        if (summary.anyFailed) {
          const error = new Error(summary.message);
          error.publishEventDispatched = true;
          error.publishResults = attempts;
          throw error;
        }

        return {
          success: true,
          message: summary.message,
          status: POST_STATUS.PUBLISHED,
          publishResults: attempts,
        };
      }

      dispatchContentSync('post-scheduled');

      return {
        success: true,
        message: 'Scheduled successfully!',
        status: POST_STATUS.SCHEDULED,
      };
    } catch (err) {
      console.error('publishContent:', err);
      throw err;
    }
  },

  // -- SETTINGS ---------------------------------------------------------------
  updateSettings: (updates) => {
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  setClarifications: (clarifications) => {
    set({ pendingClarifications: clarifications ?? {} });
  },

  setPendingClarifications: (clarifications) => {
    set({ pendingClarifications: clarifications ?? {} });
  },

  clearClarifications: () => {
    set({ pendingClarifications: {} });
  },

  clearError: () => set({ error: null }),

  // -- REALTIME ---------------------------------------------------------------
  subscribeToGenerations: (callback) => {
    const channel = supabase
      .channel('generations_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'generations' },
        (payload) => {
          const { activeSession, videoJobState } = get();

          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const updated = payload.new;

            if (updated.session_id === activeSession?.id) {
              set((state) => {
                const exists = state.activeGenerations.find((generation) => generation.id === updated.id);
                const nextGenerations = exists
                  ? state.activeGenerations.map((generation) => (generation.id === updated.id ? updated : generation))
                  : [...state.activeGenerations, updated];
                return {
                  activeGenerations: nextGenerations,
                  selectedGeneration: state.selectedGenerationId === updated.id
                    ? updated
                    : state.selectedGeneration,
                };
              });

              if (updated.status === GENERATION_STATUS.COMPLETED && updated.storage_path && updated.user_id) {
                ensureDraftForGeneration({
                  userId: updated.user_id,
                  generationId: updated.id,
                  caption: updated.prompt || '',
                })
                  .then(() => dispatchContentSync('generation-realtime-completed'))
                  .catch((err) => {
                    console.error('Failed to sync generation draft from realtime:', err);
                  });
              }
            }

            if (videoJobState.generationId && updated.id === videoJobState.generationId) {
              if (updated.status === GENERATION_STATUS.COMPLETED && updated.storage_path) {
                const pollInterval = videoJobState.pollInterval;
                if (pollInterval) clearInterval(pollInterval);

                set((state) => ({
                  isGenerating: false,
                  generationProgress: 100,
                  progressLabel: 'Video completed',
                  generationStage: 'Completed',
                  videoJobState: {
                    ...state.videoJobState,
                    status: GENERATION_STATUS.COMPLETED,
                    progress: 100,
                    videoUrl: updated.storage_path,
                    pollInterval: null,
                  },
                }));
              }

              if (updated.status === GENERATION_STATUS.FAILED) {
                const pollInterval = videoJobState.pollInterval;
                if (pollInterval) clearInterval(pollInterval);

                set((state) => ({
                  isGenerating: false,
                  generationProgress: 0,
                  progressLabel: null,
                  generationStage: null,
                  videoJobState: {
                    ...state.videoJobState,
                    status: GENERATION_STATUS.FAILED,
                    progress: 100,
                    pollInterval: null,
                  },
                }));
              }
            }
          }

          if (typeof callback === 'function') callback(payload);
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  },

  // -- CLEANUP ----------------------------------------------------------------
  reset: () => {
    const pollInterval = get().videoJobState.pollInterval;
    if (pollInterval) clearInterval(pollInterval);

    set({
      sessions: [],
      activeSession: null,
      activeGenerations: [],
      selectedGeneration: null,
      selectedGenerationId: null,
      generationsLoading: false,
      generationsError: null,
      isGenerating: false,
      generationProgress: 0,
      progressLabel: null,
      generationStage: null,
      pendingClarifications: {},
      error: null,
      videoJobState: { ...DEFAULT_VIDEO_JOB_STATE },
      postProduction: { ...DEFAULT_POST_PRODUCTION },
      generationLineage: null,
      settings: {
        mediaType: 'image',
        aspectRatio: '1:1',
        batchSize: 1,
        contentType: 'single',
        slideCount: 'auto',
        model: 'realism',
        resolution: '2k',
        duration: 6,
        fps: 25,
        generateAudio: false,
        referenceImageUrl: '',
      },
    });
  },
}));

export default useSessionStore;
