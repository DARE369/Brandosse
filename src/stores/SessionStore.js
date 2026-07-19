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
  isAbortError,
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
import { generateSessionTitle } from '../services/sessionTitleService';
import { executeMockPublishAttempts } from '../services/platforms/mockPublishWorkflow';
import { normalizeEdgeFunctionError, getEdgeStatus } from '../services/edgeFunctionClient';

export { GENERATION_STATUS, POST_STATUS } from '../constants/statuses';

const CONTENT_SYNC_EVENT = 'socialai:data-sync';

// Module-level singleton guard for the realtime channel — see
// subscribeToSession. Not store state on purpose: it's not meant to be
// reactive/rendered, just a lifecycle handle.
let _activeRealtimeChannel = null;

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

// WEEK 2 FIX 4: this function (and its shouldNormalizeSeoTenPointScale/
// normalizeSeoBreakdown/computeWeightedSeoOverall helpers above) used to be
// called on every LIVE seo-score response too — i.e. the exact same
// weighting/scale-detection algorithm ran twice for the same content: once
// server-side (now in supabase/functions/_shared/seo.ts), once again here.
// That duplication is gone from the live path: scoreSeo/optimizeSeo now
// read the server's already-normalized response fields directly via
// readSeoResponseFields() below, with no re-computation. This function is
// kept ONLY as a tolerant reader for hydrating posts.seo_state rows written
// before this fix (or, defensively, any future shape drift) — normalizing
// already-normalized 0-100 data through this same math is a safe no-op
// (the ten-point-scale heuristic only fires on data that still looks like a
// 0-10 scale), so it doubles as backward-compatible hydration without being
// a second live-scoring implementation.
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

// Reads an already-normalized score payload straight off a live
// seo-score/optimize-seo response — no re-computation, since the server
// (supabase/functions/_shared/seo.ts) is now the single source of the
// scoring algorithm. Only field-mapping/defaults, not an alternate
// normalization implementation.
function readSeoResponseFields(raw = {}) {
  return {
    overall: Number(raw?.overall ?? raw?.discoveryScore ?? raw?.discovery_score ?? 0) || 0,
    breakdown: raw?.breakdown && typeof raw.breakdown === 'object' ? raw.breakdown : { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
    benchmarkReport: Array.isArray(raw?.benchmarkReport) ? raw.benchmarkReport : [],
    hashtagSuggestions: Array.isArray(raw?.hashtagSuggestions) ? raw.hashtagSuggestions : [],
    category: String(raw?.scoreCategory || raw?.score_category || 'Poor'),
    provider: raw?.provider || null,
    model: raw?.model || null,
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
    throw await normalizeEdgeFunctionError(error, 'generate-post-metadata');
  }

  return data || null;
}

// WEEK 2 FIX 3: generate-post-metadata (personal workspace) now owns the
// entire workflow_state.metadata_status lifecycle itself — 'in_progress'
// before the LLM call, 'completed'/'failed' after, always combined with
// whatever content field(s) that same write touches. The client used to
// also write 'in_progress' optimistically before calling it and 'failed' in
// its own catch; both were removed (see git history / FIXLOG Fix 3) so
// there is exactly one writer of this field for the personal-workspace
// path. Org-workspace drafts route through requestOrgDraftMetadata, a
// separate service not covered by this pass.
async function scheduleDraftMetadataGeneration(post) {
  if (!shouldGenerateDraftMetadata(post)) return;

  try {
    await requestPostMetadataForDraft(post, ['title', 'caption', 'hashtags']);
    dispatchContentSync(post?.organization_id ? 'org-draft-metadata-generated' : 'draft-metadata-generated');
  } catch (error) {
    console.error('Failed to generate draft metadata:', error);
  }
}

// Writes org scope onto the generations rows only. Nothing in the DB ever
// sets generations.organization_id/brand_project_id on its own, so this is
// the sole writer for that direction (see FIXLOG Week 3 Fix 1 ownership
// map). Propagation from generation -> its posts is handled automatically
// by the zz_sync_generation_org_scope_to_posts trigger the instant this
// UPDATE commits — a second, client-side posts UPDATE here would just be a
// redundant race with that trigger, so it was removed.
async function syncOrgScopeToGenerations(generationIds = []) {
  const normalizedIds = Array.from(new Set((generationIds || []).filter(Boolean)));
  const orgScope = getActiveOrgScope();

  if (!orgScope || normalizedIds.length === 0) return;

  const { error: generationError } = await supabase
    .from('generations')
    .update(orgScope)
    .in('id', normalizedIds);

  if (generationError) throw generationError;
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

// Single source of truth for "is this post scheduled, and what should
// scheduled_at/status be" — shared by saveDraft and publishContent so there
// is exactly one place that decides the scheduled-post payload shape.
function resolveScheduledPostFields(postProduction, { immediateStatus, immediateScheduledAt = new Date().toISOString() }) {
  const scheduleDate = postProduction.scheduleDate || null;
  if (scheduleDate) {
    return { scheduled_at: scheduleDate, status: POST_STATUS.SCHEDULED };
  }
  return { scheduled_at: immediateScheduledAt, status: immediateStatus };
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

// Client-side post inserts (saveDraft, preparePostForApproval, publishContent)
// still exist for user-driven publish-flow writes the DB trigger has no
// reason to perform on its own (those flows fill in title/caption/hashtags/
// account_id/scheduled_at from user input, not just a bare draft shell).
// Because the DB trigger can independently create a bare draft row for the
// same user+generation the moment a generation completes, a race between
// "the trigger already created a draft" and "this insert is also trying to
// create one" is a real, reachable 23505 (unique_draft_per_generation_account)
// — not a bug, just two legitimate writers momentarily overlapping. Recover
// by re-fetching and reusing the row that won, instead of surfacing a raw
// Postgres error to the user.
async function insertDraftPostWithConflictRecovery(payload, { userId, generationId }) {
  const { data: inserted, error: insertError } = await supabase
    .from('posts')
    .insert(payload)
    .select('id, user_id')
    .single();

  if (!insertError) return inserted;

  if (insertError.code === '23505') {
    const existing = await fetchGenerationPosts(userId, generationId);
    const draft = existing.find((row) => row.status === POST_STATUS.DRAFT);
    if (draft) return { id: draft.id, user_id: draft.user_id };
  }

  throw insertError;
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

// Draft-post CREATION is owned entirely by the ensure_draft_post_for_generation
// DB trigger now (Week 3 Fix 1) — it fires in the same transaction as the
// generation's completion, so by the time any caller here is running (either
// synchronously after awaiting that completion, or asynchronously off a
// realtime broadcast of it), the row already exists or is about to be
// visible. This function's remaining job is purely read-side: find the
// trigger-created draft (with a brief bounded retry to absorb the small
// window between the trigger's INSERT committing and it becoming visible to
// a subsequent SELECT on a different connection/replica) and kick off
// metadata generation for it exactly once. It never inserts into `posts`
// itself and never touches content_library_items (create_library_item_from_post
// already covers every post insert, including the trigger's own).
async function findDraftForGeneration(userId, generationId, { retries = 4, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const existing = await fetchGenerationPosts(userId, generationId);
    const draft = existing.find((row) => row.status === POST_STATUS.DRAFT);
    if (draft) return draft;
    if (existing.length > 0) return null; // some other lifecycle row already exists; not our concern
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

async function ensureDraftForGeneration({ userId, generationId }) {
  if (!userId || !generationId) return null;

  const draft = await findDraftForGeneration(userId, generationId);
  if (!draft) return null;

  void scheduleDraftMetadataGeneration(draft);
  return draft;
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

// ADDENDUM UPGRADE 4: a generation starting from a session "uses up" that
// session's saved prompt draft — the prompt is now embodied in a real
// generation, so the draft that was standing in for it is cleared. Clearing
// rule (deliberately chosen and documented, per the addendum's own
// instruction to decide and document it): clear the moment a generation
// STARTS against that session, not on success/completion — attempting a
// generation is the point the user "used" the draft, regardless of whether
// that particular attempt succeeds or fails. Fire-and-forget/best-effort:
// failing to clear it is not worth blocking or failing a generation over.
async function clearSessionDraftPrompt(sessionId) {
  if (!sessionId) return;

  try {
    const { data: row, error: readError } = await applySessionScope(
      supabase.from('sessions').select('metadata').eq('id', sessionId),
    ).maybeSingle();
    if (readError) throw readError;

    const metadata = row?.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {};
    if (!('draft_prompt' in metadata) && !('draft_settings' in metadata) && !('draft_saved_at' in metadata)) {
      return;
    }

    delete metadata.draft_prompt;
    delete metadata.draft_settings;
    delete metadata.draft_saved_at;

    const { error: updateError } = await applySessionScope(
      supabase.from('sessions').update({ metadata }),
    ).eq('id', sessionId);
    if (updateError) throw updateError;
  } catch (err) {
    console.warn('Failed to clear session draft prompt:', err?.message || err);
  }
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
  // Store-level cancellation (Week 3 Fix 2) — the AbortController backing
  // whatever generation attempt is currently in flight, so Cancel aborts the
  // actual in-flight request(s) rather than only hiding them in the UI.
  generationAbortController: null,
  // Summary of the most recently completed multi-unit attempt (image batch
  // or carousel), for the partial-failure banner: { kind, succeededCount,
  // failedCount, totalCount, failedSlots, requestId }.
  lastBatchOutcome: null,
  // 5.2: a planned-but-not-yet-approved carousel awaiting storyboard approval.
  // { storyboard, bundle, prompt, sessionId, userId } — held in memory only;
  // a refresh discards it (re-plan). null when no carousel is pending.
  pendingCarousel: null,
  // 1.4: a planned-but-not-yet-approved single-image batch awaiting prompt
  // review/edit before spend. { bundle, renderPrompt, variants, ...ctx }.
  pendingGeneration: null,
  // Generation ids currently being redone in place via regenerateVariant/
  // regenerateSlides — lets the grid/filmstrip/lightbox show a per-item
  // spinner without touching the page-level isGenerating/studioStage
  // machine (this happens ON the results/carousel screen, not before it).
  regeneratingIds: [],

  videoJobState: { ...DEFAULT_VIDEO_JOB_STATE },
  // Real, persistent, multi-job video history (Week 3 Fix 3) — fed by
  // fetchVideoJobs (initial load) + subscribeToBackgroundJobs (live
  // updates). Survives refresh/tab-close since it's a query against
  // background_jobs, not in-memory-only state.
  videoJobs: [],

  settings: {
    mediaType: 'image', // image | video | edit | image-to-video
    aspectRatio: '1:1',
    batchSize: 1,
    contentType: 'single',
    slideCount: 'auto',
    model: 'realism',
    // 'auto' → route by the content plan's render_intent (1.1). A concrete
    // value ('flux'|'ideogram'|'recraft') is the advanced override (1.2) and
    // wins over intent. Was hardcoded 'ideogram', which sent every image
    // through the text-rendering engine regardless of what it needed.
    imageModel: 'auto',
    // 4.1/4.2: reference images that condition generation for brand/subject
    // consistency; styleLock persists them across sessions ("match my feed").
    referenceImages: [],
    styleLock: false,
    // 1.4: when on, single-image generation pauses to let the user review/edit
    // the final render prompt BEFORE credits are spent. Off = unchanged fast path.
    previewPrompt: false,
    resolution: '2k',
    duration: 6,
    fps: 25,
    generateAudio: false,
    referenceImageUrl: '',
  },

  postProduction: { ...DEFAULT_POST_PRODUCTION },
  generationLineage: null,

  // One-shot prompt seed for cross-page handoffs (library asset / template /
  // repurpose-edit). Replaces the old socialai:seed-prompt /
  // socialai:activate-generation-edit window events, which had no listener
  // anywhere in the current Studio component tree. Shape:
  // { text, source, assetReference?, activateEditMode?, sourceImageUrl?, seededAt }
  promptSeed: null,
  setPromptSeed: (seed) => {
    set({
      promptSeed: seed ? { ...seed, seededAt: new Date().toISOString() } : null,
    });
  },
  consumePromptSeed: () => {
    const seed = get().promptSeed;
    if (seed) set({ promptSeed: null });
    return seed;
  },

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

  // ADDENDUM UPGRADE 4 — replaces Week 1 Fix 5's disable-only
  // implementation: persists the typed prompt + a snapshot of current
  // generation settings (mode, aspect ratio, slide count, etc.) into the
  // active session's metadata, creating a session via ensureSession if none
  // exists yet — exactly the "Save as draft" affordance the brief panel
  // button always implied but never actually did before this.
  saveDraftPrompt: async (promptText) => {
    const trimmed = String(promptText || '').trim();
    if (!trimmed) {
      throw new Error('Type a prompt before saving a draft.');
    }

    const session = await ensureSession(get, trimmed);
    if (!session?.id) {
      throw new Error('Could not create a session for this draft.');
    }

    const { settings } = get();
    const draftSavedAt = new Date().toISOString();
    const nextMetadata = {
      ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
      draft_prompt: trimmed,
      draft_settings: settings,
      draft_saved_at: draftSavedAt,
    };

    const { error } = await applySessionScope(
      supabase.from('sessions').update({ metadata: nextMetadata, updated_at: draftSavedAt }),
    ).eq('id', session.id);
    if (error) throw error;

    set((state) => ({
      activeSession: state.activeSession?.id === session.id
        ? { ...state.activeSession, metadata: nextMetadata }
        : state.activeSession,
      sessions: state.sessions.map((item) => (item.id === session.id ? { ...item, metadata: nextMetadata } : item)),
    }));

    return { success: true, session: { ...session, metadata: nextMetadata } };
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

      // ADDENDUM UPGRADE 4: seed the brief panel from a saved prompt draft
      // (session.metadata.draft_prompt, written by saveDraftPrompt) when
      // this session has nothing else to restore — i.e. no generations at
      // all yet, so there's no completed-generation selection state that
      // would otherwise take priority. Reuses the same one-shot promptSeed
      // mechanism Week 1 Fix 3 built for cross-page handoffs, rather than a
      // second seeding path.
      const draftPrompt = String(session?.metadata?.draft_prompt || '').trim();
      if (draftPrompt && get().activeGenerations.length === 0) {
        get().setPromptSeed({
          text: draftPrompt,
          source: 'session_draft',
          settingsSnapshot: session?.metadata?.draft_settings && typeof session.metadata.draft_settings === 'object'
            ? session.metadata.draft_settings
            : null,
        });
      }

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

    // One id per user-initiated attempt — a Retry click calls startGeneration
    // again, which runs this line again, minting a NEW id; nothing inside a
    // single call ever reuses another attempt's id. Each variant gets its
    // own request_slot under this same id so a duplicate/retried invocation
    // of the SAME attempt can't double-render/double-bill any one variant.
    const requestId = crypto.randomUUID();
    const abortController = new AbortController();

    set({
      isGenerating: true,
      error: null,
      generationProgress: 0,
      progressLabel: 'Preparing generation...',
      generationStage: null,
      generationAbortController: abortController,
      lastBatchOutcome: null,
    });

    try {
      const session = await ensureSession(get, prompt);
      void clearSessionDraftPrompt(session?.id);
      const { pendingClarifications } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);
      const { registerImageGenerator, runGenerationPipeline } = await import('../services/generationPipeline');

      registerImageGenerator(async (promptText, aspectRatio, opts = {}) => {
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
          // opts.imageModel = the pipeline-resolved model (render_intent +
          // override, 1.1/1.2); settings fallback preserves old behavior when
          // a caller doesn't thread it.
          imageModel: opts.imageModel || settings.imageModel || 'ideogram',
          referenceImageUrls: opts.referenceImages || undefined,
          category: 'image',
          requestId: opts.requestId,
          slotOffset: opts.requestSlot ?? 0,
          generationId: opts.generationId,
          signal: opts.signal,
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

      // 1.4: preview-before-spend — plan ONCE (no render, no image credits),
      // then hold the plan for the user to review/edit the render prompt. On
      // approve, approveGeneration() renders all variants from this one shared
      // plan. Only the plan LLM has run at this point (cheap); no image spend.
      if (settings.previewPrompt) {
        const bundle = await runGenerationPipeline({
          userInput: prompt,
          clarifications: pendingClarifications ?? {},
          sessionId: session.id,
          userId: user.id,
          workspaceScope: getSessionScope(),
          requestId,
          cancelSignal: abortController.signal,
          lineageMetadata: generationLineage,
          settings: { ...settings, contentType: settings.contentType ?? 'single', mediaType: 'image' },
          planOnly: true,
          onProgress: (stage) => {
            const mapped = mapStageProgress(stage);
            set({ generationProgress: mapped.pct, progressLabel: mapped.label, generationStage: stage });
          },
        });
        set({
          pendingGeneration: {
            bundle,
            renderPrompt: bundle.renderPrompt || '',
            requestedVariants,
            sessionId: session.id,
            userId: user.id,
            lineageMetadata: generationLineage,
            settingsSnapshot: { ...settings, contentType: settings.contentType ?? 'single', mediaType: 'image' },
          },
        });
        return { pending: true, renderPrompt: bundle.renderPrompt || '' };
      }

      const generationIds = [];
      const outcomes = [];

      // 3.4: deliberate batch variation — instead of sending the same prompt N
      // times (near-dupes), give each variant a distinct creative direction so
      // the batch explores angle/lighting/crop/mood. Only applied for true
      // multi-variant image batches; a single image is untouched.
      const VARIANT_DIRECTIONS = [
        '',
        'a different camera angle and tighter composition',
        'different lighting and mood, wider shot',
        'an alternative composition with a fresh perspective',
      ];

      for (let index = 0; index < requestedVariants; index += 1) {
        // Store-level cancellation check (not just a UI stage guard): a
        // variant not yet started when Cancel fires is skipped entirely —
        // it never gets a request sent to the provider, never gets billed.
        if (abortController.signal.aborted) {
          outcomes.push({ index, ok: false, cancelled: true });
          continue;
        }

        try {
          const pipelineResult = await runGenerationPipeline({
            userInput: prompt,
            clarifications: pendingClarifications ?? {},
            sessionId: session.id,
            userId: user.id,
            workspaceScope: getSessionScope(),
            requestId,
            requestSlot: index,
            cancelSignal: abortController.signal,
            lineageMetadata: {
              ...(generationLineage || {}),
              variant_index: index + 1,
              variant_total: requestedVariants,
            },
            settings: {
              ...settings,
              contentType: settings.contentType ?? 'single',
              mediaType: 'image',
              // 3.4: distinct direction per variant (empty for variant 0 and
              // for single-image runs, so those are unchanged).
              variantHint: requestedVariants > 1 ? VARIANT_DIRECTIONS[index % VARIANT_DIRECTIONS.length] : '',
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
          outcomes.push({ index, ok: true });
        } catch (variantErr) {
          if (isAbortError(variantErr)) {
            outcomes.push({ index, ok: false, cancelled: true });
            continue;
          }
          console.error(`[startGeneration] variant ${index + 1} failed:`, variantErr);
          outcomes.push({ index, ok: false, error: variantErr?.message || 'Variant failed' });
          // Isolate the failure — continue to the next variant instead of
          // aborting the whole batch (mirrors the carousel path's existing
          // per-slide isolation in generationPipeline.js).
        }
      }

      const succeededCount = outcomes.filter((o) => o.ok).length;
      if (requestedVariants > 1) {
        set({
          lastBatchOutcome: {
            kind: 'image',
            succeededCount,
            failedCount: outcomes.length - succeededCount,
            totalCount: outcomes.length,
            failedSlots: outcomes.filter((o) => !o.ok && !o.cancelled).map((o) => o.index),
            requestId,
          },
        });
        if (succeededCount === 0) {
          throw new Error('All variants failed to generate.');
        }
      }

      if (generationIds.length > 0) {
        await syncOrgScopeToGenerations(generationIds);
      }

      for (const generationId of generationIds) {
        await ensureDraftForGeneration({
          userId: user.id,
          generationId,
        });
      }

      await touchSession(session.id);

      await get().fetchGenerations(session.id, { silent: true });
      dispatchContentSync('generation-completed');
      set({ error: null });
    } catch (err) {
      if (isAbortError(err)) {
        // Cancelled on purpose — not a real failure, don't surface a scary error.
        set({ error: null });
        return;
      }
      logGenerationFailure('startGeneration error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
        generationAbortController: null,
      });
    }
  },

  // 1.4: discard a planned-but-unapproved single-image batch.
  cancelPendingGeneration: () => set({ pendingGeneration: null }),

  // 1.4: render the approved (optionally prompt-edited) single-image batch from
  // the shared plan. Mints a fresh requestId; renders each variant via
  // renderSingleFromPlan with the edited prompt as promptOverride. Same
  // per-variant isolation + post-loop bookkeeping as startGeneration's inline
  // path, just sourced from one shared plan instead of re-planning per variant.
  approveGeneration: async (editedPrompt) => {
    const pending = get().pendingGeneration;
    if (!pending) return undefined;
    const { bundle, requestedVariants, sessionId, userId, lineageMetadata, settingsSnapshot } = pending;
    const promptOverride = String(editedPrompt ?? pending.renderPrompt ?? '').trim() || null;

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();
    set({
      isGenerating: true, error: null, generationProgress: 10,
      progressLabel: 'Rendering approved image...', generationStage: 'Generating image...',
      generationAbortController: abortController, pendingGeneration: null, lastBatchOutcome: null,
    });

    const VARIANT_DIRECTIONS = [
      '', 'a different camera angle and tighter composition',
      'different lighting and mood, wider shot', 'an alternative composition with a fresh perspective',
    ];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const brandKit = await loadBrandKit(user.id);
      const { registerImageGenerator, renderSingleFromPlan } = await import('../services/generationPipeline');

      registerImageGenerator(async (promptText, aspectRatio, opts = {}) => {
        const images = await generateImages({
          prompt: promptText,
          aspectRatio,
          numImages: 1,
          brandKit,
          sessionId,
          imageModel: opts.imageModel || settingsSnapshot.imageModel || 'ideogram',
          referenceImageUrls: opts.referenceImages || undefined,
          category: 'image',
          requestId: opts.requestId,
          slotOffset: opts.requestSlot ?? 0,
          generationId: opts.generationId,
          signal: opts.signal,
        });
        const first = images?.[0];
        if (!first?.url) throw new Error('Image renderer returned no image URL');
        return first;
      });

      const generationIds = [];
      const outcomes = [];

      for (let index = 0; index < requestedVariants; index += 1) {
        if (abortController.signal.aborted) { outcomes.push({ index, ok: false, cancelled: true }); continue; }
        // Per-variant direction hint appended to the (possibly edited) prompt so
        // a multi-variant batch still explores rather than duplicating.
        const variantHint = requestedVariants > 1 ? VARIANT_DIRECTIONS[index % VARIANT_DIRECTIONS.length] : '';
        const variantPrompt = variantHint && promptOverride ? `${promptOverride}. Variation: ${variantHint}.` : promptOverride;
        try {
          const pipelineResult = await renderSingleFromPlan({
            plan: bundle.plan,
            contentPlanId: bundle.contentPlanId,
            sessionId,
            userId,
            settings: settingsSnapshot,
            brandKitHash: bundle.brandKitHash,
            lineageMetadata: { ...(lineageMetadata || {}), variant_index: index + 1, variant_total: requestedVariants },
            workspaceScope: bundle.workspaceScope,
            resolvedImageModel: bundle.resolvedImageModel,
            resolvedReferenceImages: bundle.resolvedReferenceImages,
            promptOverride: variantPrompt,
            requestId,
            requestSlot: index,
            cancelSignal: abortController.signal,
            onProgress: (stage) => {
              const mapped = mapStageProgress(stage);
              const variantOffset = requestedVariants > 1 ? ((index / requestedVariants) * 100) : 0;
              const variantPct = requestedVariants > 1 ? Math.min(98, Math.round(variantOffset + (mapped.pct / requestedVariants))) : mapped.pct;
              set({ generationProgress: variantPct, progressLabel: requestedVariants > 1 ? `Variant ${index + 1}/${requestedVariants}: ${mapped.label}` : mapped.label, generationStage: stage });
            },
          });
          if (Array.isArray(pipelineResult?.generationIds)) generationIds.push(...pipelineResult.generationIds);
          outcomes.push({ index, ok: true });
        } catch (variantErr) {
          if (isAbortError(variantErr)) { outcomes.push({ index, ok: false, cancelled: true }); continue; }
          console.error(`[approveGeneration] variant ${index + 1} failed:`, variantErr);
          outcomes.push({ index, ok: false, error: variantErr?.message || 'Variant failed' });
        }
      }

      const succeededCount = outcomes.filter((o) => o.ok).length;
      if (requestedVariants > 1) {
        set({
          lastBatchOutcome: {
            kind: 'image', succeededCount,
            failedCount: outcomes.length - succeededCount, totalCount: outcomes.length,
            failedSlots: outcomes.filter((o) => !o.ok && !o.cancelled).map((o) => o.index), requestId,
          },
        });
        if (succeededCount === 0) throw new Error('All variants failed to generate.');
      }

      if (generationIds.length > 0) await syncOrgScopeToGenerations(generationIds);
      for (const generationId of generationIds) await ensureDraftForGeneration({ userId, generationId });
      await touchSession(sessionId);
      await get().fetchGenerations(sessionId, { silent: true });
      dispatchContentSync('generation-completed');
      set({ error: null, generationProgress: 100, progressLabel: 'Done!', generationStage: 'Done!' });
      return { ok: true };
    } catch (err) {
      if (isAbortError(err)) { set({ error: null }); return undefined; }
      logGenerationFailure('approveGeneration error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({ isGenerating: false, generationProgress: 0, progressLabel: null, generationStage: null, generationAbortController: null });
    }
  },

  // Retries ONLY the variants that failed in the last batch, reusing the
  // SAME request_id so idempotency protects the slots that already
  // succeeded (see generateImage/index.ts findCachedGeneration) — a
  // re-invocation of a succeeded slot replays its cached result instead of
  // rendering/billing it again.
  retryFailedVariants: async (userInput) => {
    const { lastBatchOutcome, settings } = get();
    if (!lastBatchOutcome?.failedSlots?.length) return;
    const prompt = String(userInput || '').trim();
    if (!prompt) return;

    const { registerImageGenerator, runGenerationPipeline } = await import('../services/generationPipeline');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const session = get().activeSession;
    if (!session) return;

    const brandKit = await loadBrandKit(user.id);
    const abortController = new AbortController();
    set({ isGenerating: true, generationAbortController: abortController });

    registerImageGenerator(async (promptText, aspectRatio, opts = {}) => {
      const images = await generateImages({
        prompt: promptText,
        aspectRatio,
        numImages: 1,
        brandKit,
        sessionId: session.id,
        imageModel: opts.imageModel || settings.imageModel || 'ideogram',
        referenceImageUrls: opts.referenceImages || undefined,
        category: 'image',
        requestId: opts.requestId,
        slotOffset: opts.requestSlot ?? 0,
        generationId: opts.generationId,
        signal: opts.signal,
      });
      const first = images?.[0];
      if (!first?.url) throw new Error('Image renderer returned no image URL');
      return first;
    });

    const outcomes = [];
    try {
      for (const slot of lastBatchOutcome.failedSlots) {
        try {
          await runGenerationPipeline({
            userInput: prompt,
            sessionId: session.id,
            userId: user.id,
            workspaceScope: getSessionScope(),
            requestId: lastBatchOutcome.requestId,
            requestSlot: slot,
            cancelSignal: abortController.signal,
            settings: { ...settings, contentType: settings.contentType ?? 'single', mediaType: 'image' },
            onProgress: () => {},
          });
          outcomes.push({ index: slot, ok: true });
        } catch (err) {
          outcomes.push({ index: slot, ok: false, error: err?.message });
        }
      }
    } finally {
      set({ isGenerating: false, generationAbortController: null });
    }

    const stillFailed = outcomes.filter((o) => !o.ok).map((o) => o.index);
    set({
      lastBatchOutcome: stillFailed.length
        ? { ...lastBatchOutcome, failedSlots: stillFailed, failedCount: stillFailed.length }
        : null,
    });
    await get().fetchGenerations(session.id, { silent: true });
    dispatchContentSync('generation-completed');
  },

  // Aborts whatever generation attempt is currently in flight. Variants/
  // slides not yet started are skipped (never billed); ones already
  // in-flight are aborted via the AbortSignal reaching invokeFunction's
  // fetch (media.service.js) where the provider hasn't been reached yet.
  cancelActiveGeneration: () => {
    get().generationAbortController?.abort();
  },

  // Re-renders a single already-completed variant or carousel slide IN
  // PLACE — passing generationId to generateImages/generateImage writes the
  // new render onto that same row (completeGeneration in the edge function),
  // rather than creating a new one, so the grid/filmstrip position is
  // unchanged. Always mints a fresh request_id: the same one that produced
  // the original render would idempotency-replay the OLD cached image
  // instead of actually re-rendering (see findCachedGeneration), so a real
  // regenerate must look like a brand-new billed render.
  regenerateVariant: async (generation) => {
    if (!generation?.id) return;
    set((state) => ({ regeneratingIds: [...new Set([...state.regeneratingIds, generation.id])] }));
    try {
      const { settings } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const prompt = generation.slide_prompt || generation.prompt || '';
      if (!prompt.trim()) throw new Error('No prompt available to regenerate this variant.');

      const brandKit = await loadBrandKit(user.id);
      const aspectRatio = generation.metadata?.aspect_ratio || settings.aspectRatio || '1:1';
      const category = generation.carousel_slide_index ? 'carousel' : 'image';

      const images = await generateImages({
        prompt,
        aspectRatio,
        numImages: 1,
        brandKit,
        sessionId: generation.session_id,
        // Regenerate with the SAME model the original used (now stored on the
        // row's metadata, 0.2) so a re-roll stays visually consistent; fall
        // back to the user's setting, then the safe default.
        imageModel: generation.metadata?.image_model || settings.imageModel || 'ideogram',
        category,
        requestId: crypto.randomUUID(),
        slotOffset: 0,
        generationId: generation.id,
      });

      const first = images?.[0];
      if (!first?.url) throw new Error('Image renderer returned no image URL');
    } catch (err) {
      console.error('regenerateVariant:', err);
      throw err;
    } finally {
      set((state) => ({ regeneratingIds: state.regeneratingIds.filter((id) => id !== generation.id) }));
      if (generation.session_id) await get().fetchGenerations(generation.session_id, { silent: true });
    }
  },

  // Regenerates a user-picked subset of carousel slides, one at a time
  // (matching the sequential, per-slide-isolated style the initial carousel
  // orchestration uses) — a failure on one selected slide doesn't stop the
  // rest from being retried.
  regenerateSlides: async (generationIds) => {
    const ids = Array.from(new Set(generationIds || []));
    const { activeGenerations } = get();
    for (const id of ids) {
      const generation = activeGenerations.find((g) => g.id === id);
      if (!generation) continue;
      try {
        await get().regenerateVariant(generation);
      } catch (err) {
        console.error(`regenerateSlides: slide ${id} failed:`, err);
      }
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

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();

    set({
      isGenerating: true,
      error: null,
      generationProgress: 0,
      progressLabel: 'Planning carousel...',
      generationStage: 'Planning carousel...',
      generationAbortController: abortController,
      lastBatchOutcome: null,
    });

    try {
      const { settings, generationLineage } = get();
      const session = await ensureSession(get, prompt);
      void clearSessionDraftPrompt(session?.id);
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

      registerImageGenerator(async (promptText, aspectRatio, opts = {}) => {
        const images = await generateImages({
          prompt: promptText,
          aspectRatio,
          numImages: 1,
          brandKit,
          sessionId: session.id,
          imageModel: opts.imageModel || settings.imageModel || 'ideogram',
          referenceImageUrls: opts.referenceImages || undefined,
          category: 'carousel',
          requestId: opts.requestId,
          slotOffset: opts.requestSlot ?? 0,
          generationId: opts.generationId,
          signal: opts.signal,
        });

        const first = images?.[0];
        if (!first?.url) throw new Error('Image renderer returned no image URL');
        return first;
      });

      // 5.2: PLAN ONLY — get the slide plan without rendering, then hold it for
      // storyboard approval. Rendering (and all credit spend) happens in
      // approveCarousel(). The registered renderer above is reused there.
      const bundle = await runGenerationPipeline({
        userInput: prompt,
        clarifications: {},
        sessionId: session.id,
        userId: user.id,
        workspaceScope: getSessionScope(),
        requestId,
        cancelSignal: abortController.signal,
        lineageMetadata: generationLineage,
        settings: pipelineSettings,
        planOnly: true,
        onProgress: (stage) => {
          const mapped = mapStageProgress(stage);
          set({ generationProgress: mapped.pct, progressLabel: mapped.label, generationStage: stage });
        },
      });

      // Build a human-readable storyboard from the plan's slides.
      const planSlides = bundle?.plan?.carousel?.slides ?? [];
      const storyboard = planSlides.map((s, i) => ({
        index: i + 1,
        purpose: s.slide_purpose || '',
        headline: s.headline || `Slide ${i + 1}`,
        body: s.body_text || '',
      }));

      set({
        pendingCarousel: {
          storyboard,
          bundle,
          prompt,
          sessionId: session.id,
          userId: user.id,
          lineageMetadata: generationLineage,
        },
      });
      return { storyboard, pending: true };
    } catch (err) {
      if (isAbortError(err)) {
        set({ error: null });
        return undefined;
      }
      logGenerationFailure('startCarouselGeneration (plan) error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
        generationAbortController: null,
      });
    }
  },

  // 5.2: discard a planned-but-unapproved carousel.
  cancelPendingCarousel: () => set({ pendingCarousel: null }),

  // 5.2: render the approved carousel storyboard. Mints a FRESH requestId (the
  // render's idempotency key belongs to the render, not the preview) and runs
  // renderCarouselFromPlan with the carried resolved-model/references/aspect so
  // the rendered carousel matches exactly what was approved. Then runs the same
  // post-render bookkeeping the old inline path did.
  approveCarousel: async () => {
    const pending = get().pendingCarousel;
    if (!pending) return undefined;
    const { bundle, sessionId, userId, lineageMetadata } = pending;

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();
    set({
      isGenerating: true,
      error: null,
      generationProgress: 15,
      progressLabel: 'Rendering approved carousel...',
      generationStage: 'Rendering slides...',
      generationAbortController: abortController,
      pendingCarousel: null,
      lastBatchOutcome: null,
    });

    try {
      const { renderCarouselFromPlan } = await import('../services/generationPipeline');
      const pipelineResult = await renderCarouselFromPlan({
        plan: bundle.plan,
        contentPlanId: bundle.contentPlanId,
        sessionId,
        userId,
        brandKitHash: bundle.brandKitHash,
        lineageMetadata,
        workspaceScope: bundle.workspaceScope,
        resolvedImageModel: bundle.resolvedImageModel,
        resolvedReferenceImages: bundle.resolvedReferenceImages,
        requestId,
        cancelSignal: abortController.signal,
        onProgress: (stage) => {
          const mapped = mapStageProgress(stage);
          set({ generationProgress: mapped.pct, progressLabel: mapped.label, generationStage: stage });
        },
      });

      const generationIds = Array.isArray(pipelineResult?.generationIds) ? pipelineResult.generationIds : [];

      if (Number.isFinite(pipelineResult?.totalCount) && pipelineResult.totalCount > 1) {
        set({
          lastBatchOutcome: {
            kind: 'carousel',
            succeededCount: pipelineResult.succeededCount,
            failedCount: pipelineResult.failedCount,
            totalCount: pipelineResult.totalCount,
            failedSlots: (pipelineResult.outcomes || []).filter((o) => !o.ok && !o.cancelled).map((o) => o.index),
            requestId,
          },
        });
      }

      if (generationIds.length > 0) await syncOrgScopeToGenerations(generationIds);
      await touchSession(sessionId);
      await get().fetchGenerations(sessionId, { silent: true });

      const generatedRows = generationIds.length > 0 ? await fetchSessionGenerations(sessionId) : [];
      const generatedById = new Map(generatedRows.map((row) => [row.id, row]));
      for (const generationId of generationIds) {
        const generationRow = generatedById.get(generationId);
        if (generationRow?.status !== GENERATION_STATUS.COMPLETED) continue;
        await ensureDraftForGeneration({ userId, generationId });
      }

      dispatchContentSync('carousel-completed');
      set({ error: null, generationProgress: 100, progressLabel: 'Done!', generationStage: 'Done!' });
      return pipelineResult;
    } catch (err) {
      if (isAbortError(err)) { set({ error: null }); return undefined; }
      logGenerationFailure('approveCarousel error', err);
      set({ error: err.message });
      throw err;
    } finally {
      set({
        isGenerating: false,
        generationProgress: 0,
        progressLabel: null,
        generationStage: null,
        generationAbortController: null,
      });
    }
  },

  startEditGeneration: async (sourceImageUrl, instruction) => {
    const cleanSource = String(sourceImageUrl || '').trim();
    const prompt = String(instruction || '').trim();

    if (!cleanSource) throw new Error('Source image is required for edit mode');
    if (!prompt) throw new Error('Edit instruction is required');

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();

    set({
      isGenerating: true,
      error: null,
      generationProgress: 8,
      progressLabel: 'Preparing edit...',
      generationStage: 'Preparing',
      generationAbortController: abortController,
    });

    let createdGeneration = null;

    try {
      const session = await ensureSession(get, prompt);
      void clearSessionDraftPrompt(session?.id);
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
          request_id: requestId,
          request_slot: 0,
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
        requestId,
        generationId: created.id,
        signal: abortController.signal,
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

  // Week 3 Fix 3 — submit-and-return. generateVideo now returns a job id
  // immediately (fal.ai's queue submit, not a blocking wait for the queue
  // to resolve) — isGenerating clears right after submit, not after the
  // video actually finishes rendering. The video's own generations row is
  // created server-side by generateVideo/index.ts with status 'processing'
  // (fixing the prior video-only inconsistency of being born 'completed');
  // its transition to 'completed'/'failed' happens via job-webhook/
  // process-jobs, which this tab observes through the SAME session-scoped
  // generations broadcast every other media type already uses (Week 2 Fix
  // 1) — no video-specific realtime branch needed for that part anymore.
  // videoJobs (fed by subscribeToBackgroundJobs) is the real, persistent,
  // multi-job history that survives refresh/tab-close; videoJobState keeps
  // tracking only "the job this tab most recently submitted or is looking
  // at," for the existing single-job UI affordances (progress bar, minimize
  // pill) to key off without a larger UI rewrite.
  // 5.1: generate a single STILL first frame for a text-to-video request so
  // the user can approve it before the (expensive) animate step. Billed as an
  // image (category 'image') — separate from the later video charge, per the
  // credit model. Returns { url } or throws. Does NOT create a session-visible
  // results grid entry; the frame is a staging artifact the caller manages.
  generateVideoFirstFrame: async (userInput) => {
    const prompt = String(userInput || '').trim();
    if (!prompt) throw new Error('A prompt is required to generate a first frame.');
    const { settings } = get();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const session = await ensureSession(get, prompt);
    const brandKit = settings.brandKit || (await loadBrandKit(user.id));

    const images = await generateImages({
      prompt,
      aspectRatio: settings.aspectRatio || '16:9',
      numImages: 1,
      brandKit,
      sessionId: session.id,
      imageModel: settings.imageModel || 'auto',
      referenceImageUrls: settings.styleLock ? settings.referenceImages : undefined,
      category: 'image',
      requestId: crypto.randomUUID(),
      slotOffset: 0,
    });
    const url = images?.[0]?.url;
    if (!url) throw new Error('First-frame renderer returned no image.');
    return { url };
  },

  startVideoGeneration: async (userInput) => {
    const prompt = String(userInput || '').trim();
    if (!prompt) return;

    const requestId = crypto.randomUUID();

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
      void clearSessionDraftPrompt(session?.id);
      const { settings } = get();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const brandKit = await loadBrandKit(user.id);
      const videoMode = settings.mediaType === 'image-to-video' ? 'image-to-video' : 'text-to-video';
      if (videoMode === 'image-to-video' && !String(settings.referenceImageUrl || '').trim()) {
        throw new Error('Source image is required for image-to-video generation');
      }
      const submitted = await createVideoJob({
        prompt,
        aspectRatio: settings.aspectRatio,
        duration: settings.duration || 6,
        brandKit,
        mode: videoMode,
        imageUrl: settings.referenceImageUrl || '',
        quality: settings.videoQuality === 'premium' ? 'premium' : 'standard',
        sessionId: session.id,
        requestId,
      });

      if (submitted.tierUpgraded) {
        toast(
          'Standard tier requires a source image — this renders (and is billed) at premium quality instead.',
          { icon: 'ℹ️', duration: 6000 },
        );
      }

      set((state) => ({
        videoJobState: {
          ...state.videoJobState,
          jobId: submitted.jobId,
          generationId: submitted.generationId,
          status: 'processing',
          progress: 40,
        },
        videoJobs: [
          { id: submitted.jobId, generationId: submitted.generationId, prompt, status: 'running', createdAt: new Date().toISOString() },
          ...state.videoJobs.filter((j) => j.id !== submitted.jobId),
        ],
      }));

      await touchSession(session.id);
      dispatchContentSync('video-queued');

      return { jobId: submitted.jobId, generationId: submitted.generationId };
    } catch (err) {
      logGenerationFailure('startVideoGeneration error', err);
      set((state) => ({
        error: err.message,
        videoJobState: {
          ...state.videoJobState,
          status: GENERATION_STATUS.FAILED,
          progress: 100,
        },
      }));
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

  // Video jobs genuinely keep running server-side after this — dismissing
  // only stops this tab from foregrounding it as "the" active job; it
  // remains visible (and, if still in flight, live-updating) in the
  // persistent videoJobs list / drawer.
  dismissVideoJob: () => {
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

  // Fetches the user's recent video jobs (so the drawer has real history
  // immediately on mount, before any realtime event arrives) and subscribes
  // to live updates on their private background-jobs-<uid> topic (see
  // migration 20260712110000_week3_background_jobs.sql). Mirrors
  // subscribeToSession's private-channel pattern (Week 2 Fix 1).
  fetchVideoJobs: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('background_jobs')
      .select('id, status, payload, result, error, created_at')
      .eq('user_id', user.id)
      .eq('job_type', 'video_generation')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('Failed to fetch video jobs:', error);
      return;
    }
    set({
      videoJobs: (data || []).map((row) => ({
        id: row.id,
        generationId: row.payload?.generation_id ?? null,
        prompt: null,
        status: row.status,
        videoUrl: row.result?.video_url ?? null,
        errorMessage: row.error ?? null,
        createdAt: row.created_at,
      })),
    });
  },

  subscribeToBackgroundJobs: (userId) => {
    if (!userId) return () => {};
    const channel = supabase.channel(`background-jobs-${userId}`, { config: { private: true } });
    channel.on('broadcast', { event: '*' }, (message) => {
      const payload = message?.payload || {};
      const updated = payload.record || payload.new_record || payload.new || null;
      if (!updated || updated.job_type !== 'video_generation') return;

      set((state) => {
        const nextJob = {
          id: updated.id,
          generationId: updated.payload?.generation_id ?? null,
          prompt: state.videoJobs.find((j) => j.id === updated.id)?.prompt ?? null,
          status: updated.status,
          videoUrl: updated.result?.video_url ?? null,
          errorMessage: updated.error ?? null,
          createdAt: updated.created_at || new Date().toISOString(),
        };
        const exists = state.videoJobs.some((j) => j.id === updated.id);
        const nextJobs = exists
          ? state.videoJobs.map((j) => (j.id === updated.id ? nextJob : j))
          : [nextJob, ...state.videoJobs];

        const matchesActive = state.videoJobState.jobId === updated.id;
        return {
          videoJobs: nextJobs,
          videoJobState: matchesActive
            ? {
                ...state.videoJobState,
                status: updated.status === 'completed' ? GENERATION_STATUS.COMPLETED
                  : updated.status === 'failed' ? GENERATION_STATUS.FAILED
                  : state.videoJobState.status,
                progress: updated.status === 'completed' || updated.status === 'failed' ? 100 : state.videoJobState.progress,
                videoUrl: updated.result?.video_url ?? state.videoJobState.videoUrl,
              }
            : state.videoJobState,
        };
      });

      if (updated.status === 'completed' || updated.status === 'failed') {
        dispatchContentSync(updated.status === 'completed' ? 'video-completed' : 'video-failed');
      }
    });
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  cancelVideoJob: async (jobId) => {
    if (!jobId) return;
    try {
      const { error } = await supabase.functions.invoke('cancel-video-job', { body: { job_id: jobId } });
      if (error) throw await normalizeEdgeFunctionError(error, 'cancel-video-job');
      set((state) => ({
        videoJobs: state.videoJobs.map((j) => (j.id === jobId ? { ...j, status: 'cancelled' } : j)),
      }));
    } catch (err) {
      toast.error(err?.message || 'Could not cancel this video job.');
    }
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

      // An auth failure (expired/missing session) is not the same as the
      // edge function being unreachable — it must NOT fall through to the
      // legacy ApiService.enhancePrompt path below, since that would mask
      // the fact that the user is no longer authenticated. Only genuine
      // availability failures (network/deploy issues) reach the fallback.
      const edgeStatus = edgeResponse.error ? getEdgeStatus(edgeResponse.error) : null;
      if (edgeStatus === 401 || edgeStatus === 403) {
        console.warn('[SessionStore] enhancePrompt auth failure:', edgeResponse.error?.message || edgeResponse.error);
        toast.error('Your session has expired. Please log in again to enhance prompts.');
        return {
          enhancedPrompt: cleanPrompt,
          suggestions: [cleanPrompt],
        };
      }

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
      // WEEK 2 FIX 3: no longer writes workflow_state.metadata_status here.
      // generate-post-metadata now writes 'in_progress' (with
      // metadata_started_at) itself the moment it has a post_id, before it
      // calls the LLM — the server is the single writer of this field, so a
      // client-side pre-write here would just be a redundant, race-prone
      // second writer of the same value. The local postProduction state
      // update right below is UI-only (not a DB write) and stays, purely as
      // instant feedback while the request is in flight.
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
          throw await normalizeEdgeFunctionError(error, 'generate-post-metadata');
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
        throw await normalizeEdgeFunctionError(error, 'seo-score');
      }

      // WEEK 2 FIX 4: no client-side re-normalization (data is already
      // canonical, server-computed) and no client-side seo_state write —
      // seo-score itself now persists posts.seo_state/workflow_state when
      // given a content_id (which this call already sends above), matching
      // Fix 3's "server owns its own writes" philosophy.
      const normalized = readSeoResponseFields(data || {});

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
        throw await normalizeEdgeFunctionError(error, 'ai-brand-consistency-check');
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
      // WEEK 2 FIX 4: optimize-seo now scores its own optimized output
      // server-side (via the same _shared/seo.ts scoreContent() seo-score
      // uses) and, given a content_id, persists posts.seo_state/
      // workflow_state itself — one round trip covers optimize + score,
      // with one canonical normalization. This no longer chains a separate
      // get().scoreSeo() call below.
      const { data, error } = await supabase.functions.invoke('optimize-seo', {
        body: {
          content_id: postProduction.postId || null,
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
      if (error) throw await normalizeEdgeFunctionError(error, 'optimize-seo');

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
      const normalizedScore = readSeoResponseFields(result);

      set((state) => ({
        postProduction: {
          ...state.postProduction,
          title: optimizedTitle,
          caption: optimizedCaption,
          hashtags: optimizedHashtags,
          seoScore: normalizedScore.overall,
          seoCategory: normalizedScore.category,
          seoBreakdown: normalizedScore.breakdown,
          seoSuggestions: normalizedScore.suggestions,
          seoBenchmarkReport: normalizedScore.benchmarkReport,
          seoHashtagSuggestions: normalizedScore.hashtagSuggestions,
          seoProvider: normalizedScore.provider,
          seoStatus: 'scored',
        },
      }));

      // Content persistence (title/caption/hashtags) stays client-owned —
      // only seo_state/workflow_state.seo_status ownership moved
      // server-side in this fix, per FIXLOG's documented scope decision.
      if (postProduction.postId) {
        await supabase
          .from('posts')
          .update({
            title: optimizedTitle || null,
            caption: optimizedCaption,
            hashtags: optimizedHashtags,
            updated_at: new Date().toISOString(),
          })
          .eq('id', postProduction.postId);
      }

      return {
        ...normalizedScore,
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
    const rawMetadataStatus = String(workflowState.metadata_status || '').trim().toLowerCase() || 'idle';
    const metadataUpdatedAt = workflowState.metadata_generated_at
      || workflowState.metadata_updated_at
      || null;

    // WEEK 2 FIX 3 — stale-'in_progress' reconciliation: the server now
    // owns writing 'in_progress'/'completed'/'failed' (see
    // generate-post-metadata), but a lost response, network drop, or closed
    // tab mid-request can still leave a row stuck at 'in_progress' forever
    // with nothing to ever correct it server-side. On every read here, a
    // row that has been 'in_progress' for more than 2 minutes (or has no
    // timestamp to prove otherwise — covers rows stuck from before this fix
    // existed) is treated as failed instead, both in what's surfaced to the
    // UI and in-memory on `preferred` itself so the existing
    // shouldGenerateDraftMetadata/scheduleDraftMetadataGeneration retry
    // gate below (which reads preferred.workflow_state directly) sees it as
    // recoverable rather than permanently blocked.
    const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;
    const metadataStartedAt = workflowState.metadata_started_at || workflowState.metadata_updated_at || null;
    const isStaleInProgress = rawMetadataStatus === 'in_progress' && (
      !metadataStartedAt || (Date.now() - new Date(metadataStartedAt).getTime()) > STALE_IN_PROGRESS_MS
    );
    const metadataStatus = isStaleInProgress ? 'failed' : rawMetadataStatus;
    if (isStaleInProgress) {
      preferred.workflow_state = { ...workflowState, metadata_status: 'failed' };
    }
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
      } else {
        const inserted = await insertDraftPostWithConflictRecovery(
          withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: selectedAccountId,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: null,
            status: POST_STATUS.DRAFT,
          }),
          { userId: user.id, generationId: selectedGeneration.id },
        );
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

  // Real conflict check for the Schedule dialog — true if any OTHER
  // scheduled post on one of the currently-selected target accounts already
  // lands within 30 minutes of the proposed time. Never blocks scheduling
  // (the mock's own copy says "nothing will be overwritten") — it's purely
  // informational, so a query failure is swallowed as "no conflict found"
  // rather than surfaced as an error.
  checkScheduleConflict: async (scheduledAtISO) => {
    try {
      const accountIds = (get().postProduction.selectedPlatforms || []).filter(Boolean);
      if (!accountIds.length || !scheduledAtISO) return false;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const target = new Date(scheduledAtISO).getTime();
      if (!Number.isFinite(target)) return false;
      const windowMs = 30 * 60 * 1000;

      const { data, error } = await supabase
        .from('posts')
        .select('id, account_id, scheduled_at')
        .eq('user_id', user.id)
        .eq('status', POST_STATUS.SCHEDULED)
        .in('account_id', accountIds)
        .gte('scheduled_at', new Date(target - windowMs).toISOString())
        .lte('scheduled_at', new Date(target + windowMs).toISOString());

      if (error) throw error;
      const currentPostId = get().postProduction.postId;
      return (data || []).some((row) => row.id !== currentPostId);
    } catch (err) {
      console.error('checkScheduleConflict:', err);
      return false;
    }
  },

  saveDraft: async () => {
    const { selectedGeneration, postProduction } = get();
    if (!selectedGeneration) throw new Error('Select a generation to save as a draft.');

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

      const { scheduled_at: scheduledAt, status: targetStatus } = resolveScheduledPostFields(postProduction, {
        immediateStatus: POST_STATUS.DRAFT,
        immediateScheduledAt: null,
      });
      const isScheduled = targetStatus === POST_STATUS.SCHEDULED;
      // A scheduled post with no target account can never be dispatched —
      // process_scheduled_posts() matches by account_id (or, absent that, by
      // platform), and both are null here, so the cron's join never finds a
      // row to publish. It would otherwise sit as "scheduled" forever with
      // no error shown anywhere. A plain (non-scheduled) draft is fine
      // without a target account — only the scheduled path requires one.
      if (isScheduled && !selectedAccountId) {
        throw new Error('Select a platform before scheduling — otherwise there’s nothing to publish to.');
      }

      const existing = await fetchGenerationPosts(user.id, selectedGeneration.id);
      const reusable = existing.find((row) => row.status === POST_STATUS.DRAFT)
        || existing.find((row) => NON_TERMINAL_STATUSES.includes(row.status));
      const orgScope = getActiveOrgScope();
      let targetPostId = reusable?.id || null;

      if (reusable) {
        const nextStatus = assertPostStatusTransition(reusable.status, targetStatus, 'saveDraft');
        const { error: updateError } = await supabase
          .from('posts')
          .update(withOrgScope({
            title,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            account_id: selectedAccountId,
            scheduled_at: scheduledAt,
            status: nextStatus,
          }))
          .eq('id', reusable.id);

        if (updateError) throw updateError;
        targetPostId = reusable.id;
      } else {
        const inserted = await insertDraftPostWithConflictRecovery(
          withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: selectedAccountId,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduledAt,
            status: targetStatus,
          }),
          { userId: user.id, generationId: selectedGeneration.id },
        );
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
      dispatchContentSync(isScheduled ? 'post-scheduled' : 'draft-saved');

      return isScheduled
        ? {
            success: true,
            message: 'Scheduled successfully!',
            status: POST_STATUS.SCHEDULED,
            scheduledAt,
          }
        : {
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

      const isImmediatePublish = !postProduction.scheduleDate;
      const { scheduled_at: scheduleDate, status } = resolveScheduledPostFields(postProduction, {
        immediateStatus: POST_STATUS.PUBLISHING,
      });
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
        const insertedPrimary = await insertDraftPostWithConflictRecovery(
          withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: primaryAccountId,
            platform: primaryPlatform,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduleDate,
            status,
          }),
          { userId: user.id, generationId: selectedGeneration.id },
        );
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

        const insertedAccount = await insertDraftPostWithConflictRecovery(
          withOrgScope({
            user_id: user.id,
            generation_id: selectedGeneration.id,
            title,
            account_id: accountId,
            platform,
            caption: finalCaption,
            hashtags: normalizeHashtags(postProduction.hashtags),
            scheduled_at: scheduleDate,
            status,
          }),
          { userId: user.id, generationId: selectedGeneration.id },
        );
        targetPostIds.push(insertedAccount.id);
        publishTargets.push({ postId: insertedAccount.id, accountId });
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
  // WEEK 2 FIX 1 (+ ADDENDUM UPGRADE 1): session-scoped, RLS-authorized
  // private-channel broadcast — replaces the old subscribeToGenerations,
  // which subscribed to postgres_changes on the ENTIRE `generations` table
  // with no server-side filter (every client received every user's/org's
  // row changes, filtered only client-side by session_id). The new
  // subscription is scoped to one session's topic (`session-<id>`) and
  // authorization for that topic is enforced server-side by an RLS policy
  // on `realtime.messages` (see migration
  // 20260711000000_realtime_session_broadcast.sql) — a client cannot
  // subscribe to a session it doesn't own (personal) or have brand access
  // to (org), regardless of what filter it asks for client-side.
  //
  // Lifecycle: ownership of "tear down and re-subscribe on session switch"
  // is deliberately NOT scattered across loadSession/createNewSession/
  // clearActiveSession — those all funnel into changing `activeSession`,
  // and the caller (GeneratePageV2's effect) keys its subscription on
  // `activeSession?.id`, so React's own effect-cleanup-before-rerun
  // semantics guarantee exactly one channel is ever active and that it is
  // torn down before a new one is created, without needing every
  // session-mutating action to know about realtime at all. This function
  // additionally guards defensively: calling it again removes any
  // previously-created channel first, in case some future caller invokes it
  // without going through that effect.
  //
  // No active session (bare /app/generate before one exists) → no
  // subscription is created at all; the first call with a real sessionId
  // (once ensureSession/loadSession/createNewSession sets one) establishes
  // it lazily.
  subscribeToSession: (sessionId, callback) => {
    if (_activeRealtimeChannel) {
      supabase.removeChannel(_activeRealtimeChannel);
      _activeRealtimeChannel = null;
    }

    if (!sessionId) {
      return () => {};
    }

    const topic = `session-${sessionId}`;
    const channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, (message) => {
        // realtime.broadcast_changes() payload shape (Supabase's documented
        // broadcast-from-database contract): { operation, table, schema,
        // record, old_record }. Extraction is defensive against minor
        // field-naming variance across Realtime server versions since this
        // could not be exercised against a live project in this pass — see
        // FIXLOG "REALTIME EXPOSURE VERDICT" / Fix 1 for the exact caveat.
        const payload = message?.payload || {};
        const operation = String(
          payload.operation || payload.type || message?.event || '',
        ).toUpperCase();
        const updated = payload.record || payload.new_record || payload.new || null;
        if (!updated) return;

        const { activeSession, videoJobState } = get();

        if (operation === 'UPDATE' || operation === 'INSERT') {
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
              // This is now the ONE mechanism that works for every completion
              // path, not just the originating tab's own synchronous call
              // (which also calls ensureDraftForGeneration itself, redundantly
              // but harmlessly — findDraftForGeneration is read-only and
              // scheduleDraftMetadataGeneration is deduped server-side via
              // workflow_state.metadata_status, see shouldGenerateDraftMetadata).
              // A second tab, an admin backfill, or (Fix 3) a server-side job
              // finalizer with no client present at all all funnel through
              // this same broadcast-driven path.
              ensureDraftForGeneration({
                userId: updated.user_id,
                generationId: updated.id,
              })
                .then(() => dispatchContentSync('generation-realtime-completed'))
                .catch((err) => {
                  console.error('Failed to sync generation draft from realtime:', err);
                });
            }
          }

          // Week 3 Fix 3: video completion/failure is now a real generations
          // UPDATE written by job-webhook/process-jobs (via completeGeneration-
          // equivalent logic in _shared/videoJobFinalize.ts), which broadcasts
          // through this SAME session-scoped channel like any other media
          // type — no dead pollInterval scaffolding needed anymore (the
          // synchronous video implementation that scaffolding was inert
          // leftover from no longer exists). This only mirrors the terminal
          // state into videoJobState for whichever tab currently has this
          // job foregrounded; subscribeToBackgroundJobs is the source of
          // truth for the persistent multi-job drawer list.
          if (videoJobState.generationId && updated.id === videoJobState.generationId) {
            if (updated.status === GENERATION_STATUS.COMPLETED && updated.storage_path) {
              set((state) => ({
                videoJobState: {
                  ...state.videoJobState,
                  status: GENERATION_STATUS.COMPLETED,
                  progress: 100,
                  videoUrl: updated.storage_path,
                },
              }));
            }

            if (updated.status === GENERATION_STATUS.FAILED) {
              set((state) => ({
                videoJobState: {
                  ...state.videoJobState,
                  status: GENERATION_STATUS.FAILED,
                  progress: 100,
                },
              }));
            }
          }
        }

        if (typeof callback === 'function') {
          callback({ eventType: operation, new: updated, old: payload.old_record || payload.old || null });
        }
      })
      .subscribe();

    _activeRealtimeChannel = channel;

    return () => {
      supabase.removeChannel(channel);
      if (_activeRealtimeChannel === channel) {
        _activeRealtimeChannel = null;
      }
    };
  },

  // -- CLEANUP ----------------------------------------------------------------
  reset: () => {
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
      regeneratingIds: [],
      videoJobState: { ...DEFAULT_VIDEO_JOB_STATE },
      videoJobs: [],
      postProduction: { ...DEFAULT_POST_PRODUCTION },
      generationLineage: null,
      promptSeed: null,
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
