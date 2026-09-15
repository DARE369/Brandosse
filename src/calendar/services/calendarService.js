// ============================================================================
// CALENDAR SERVICE — query + mutation layer for the shared Calendar engine.
// Migrated from src/stores/CalendarStore.js's posts-related methods
// (AS_IS_AUDIT.md §3.9 "Refactor" half) into a scope-aware plain service
// module, per CALENDAR_SPEC.md §1/§9: "every query filters by scope first."
//
// Personal-only is wired end-to-end in this packet (Packet 1). Org branches
// are shaped per spec §0 (`{ workspaceType, organizationId?, brandProjectId?,
// userId }`) so Packet 3 can extend this file without re-deriving the scope
// contract, but org-specific query logic is NOT implemented here — calling
// with workspaceType: 'org' throws explicitly rather than silently returning
// unscoped/incorrect data. See DECISIONS_LOG.md (2026-06-24) for why.
// ============================================================================

import { supabase } from '../../services/supabaseClient';
import { POST_STATUS } from '../../constants/statuses';
import { assertPostStatusTransition } from '../../utils/postStatusMachine';
import {
  buildUnavailableEdgeFunctionMessage,
  clearEdgeFunctionUnavailable,
  isEdgeFunctionUnavailable,
  markEdgeFunctionUnavailable,
  normalizeEdgeFunctionError,
} from '../../services/edgeFunctionClient';

const METADATA_FUNCTION = 'generate-post-metadata';

// Post rows shown on the calendar grid (drafts are fetched separately via
// fetchDrafts/fetchUnscheduled — identical to CalendarStore.js's original
// CALENDAR_POST_STATUSES split, carried forward unchanged).
const CALENDAR_POST_STATUSES = [
  POST_STATUS.SCHEDULED,
  POST_STATUS.PUBLISHED,
  POST_STATUS.PUBLISHING,
  POST_STATUS.FAILED,
];

const POST_SELECT_COLUMNS = `
  *,
  connected_accounts ( id, platform, account_name, avatar_url ),
  generations ( storage_path, media_type, prompt )
`;

/**
 * Scope descriptor shape (CALENDAR_SPEC.md §0/§1):
 *   { workspaceType: 'personal' | 'org', organizationId?, brandProjectId?, userId }
 *
 * This packet only implements the 'personal' branch end-to-end. The 'org'
 * branch is intentionally not implemented — Packet 3 owns that — and calling
 * any of these functions with workspaceType !== 'personal' throws rather than
 * falling through to an unscoped or incorrectly-scoped query, per
 * CALENDAR_SPEC.md §9's "no exceptions, no admin-can-see-everything shortcut
 * at the query layer" rule.
 */
function assertPersonalScope(scope, fnName) {
  if (!scope || typeof scope !== 'object') {
    throw new Error(`calendarService.${fnName}: a scope object is required.`);
  }
  if (scope.workspaceType !== 'personal') {
    throw new Error(
      `calendarService.${fnName}: workspaceType "${scope.workspaceType}" is not yet implemented in this packet (Packet 1, personal-only). Org scope is Packet 3's responsibility — do not call this with org scope yet.`
    );
  }
  if (!scope.userId) {
    throw new Error(`calendarService.${fnName}: scope.userId is required for personal scope.`);
  }
  return scope.userId;
}

/**
 * Fetch calendar-visible posts (scheduled/published/publishing/failed) for
 * the given scope, optionally narrowed to a date range.
 *
 * @param {object} scope - { workspaceType: 'personal', userId }
 * @param {object} [range] - { startISO, endISO } — optional scheduled_at window
 */
export async function fetchPosts(scope, range = {}) {
  const userId = assertPersonalScope(scope, 'fetchPosts');

  let query = supabase
    .from('posts')
    .select(POST_SELECT_COLUMNS)
    .eq('user_id', userId)
    .in('status', CALENDAR_POST_STATUSES)
    .order('scheduled_at', { ascending: true });

  if (range.startISO) query = query.gte('scheduled_at', range.startISO);
  if (range.endISO) query = query.lte('scheduled_at', range.endISO);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Fetch unscheduled drafts for the given scope. Personal: posts.status =
 * 'draft' owned by the user (CALENDAR_SPEC.md §2.1's "Drafts" rail source).
 * Org's "approved-but-unplaced backlog" equivalent is not implemented here
 * (Packet 3).
 */
export async function fetchDrafts(scope) {
  const userId = assertPersonalScope(scope, 'fetchDrafts');

  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('status', POST_STATUS.DRAFT)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

/**
 * Create a new post row. Status transitions (if a status is supplied) are
 * validated through the same postStatusMachine guard CalendarStore.js used —
 * carried forward unmodified per AS_IS_AUDIT.md §3.11's Reuse classification.
 */
export async function createPost(scope, postData) {
  const userId = assertPersonalScope(scope, 'createPost');

  const nextStatus = postData?.status
    ? assertPostStatusTransition(null, postData.status, 'calendar-create')
    : null;

  const { data, error } = await supabase
    .from('posts')
    .insert([{
      user_id: userId,
      ...postData,
      ...(nextStatus ? { status: nextStatus } : {}),
    }])
    .select(POST_SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update an existing post. Every status change is routed through
 * assertPostStatusTransition() before being sent to Supabase — identical
 * safety behavior to CalendarStore.updatePost(), carried forward.
 *
 * `currentStatus` is the caller's last-known status (used only for the
 * transition-table check, NOT for concurrency — see updatePostWithConcurrencyGuard
 * in useScheduleAction.js for the optimistic-concurrency guard itself, which
 * is a separate, stricter check on `updated_at`).
 */
export async function updatePost(scope, postId, updates, currentStatus = null) {
  assertPersonalScope(scope, 'updatePost');

  const nextStatus = Object.prototype.hasOwnProperty.call(updates || {}, 'status')
    ? assertPostStatusTransition(currentStatus, updates.status, 'calendar-update')
    : null;

  const payload = {
    ...updates,
    ...(nextStatus ? { status: nextStatus } : {}),
  };

  const { data, error } = await supabase
    .from('posts')
    .update(payload)
    .eq('id', postId)
    .select(POST_SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetch a single post by id, regardless of status or scheduled_at — used for
 * deep links into a specific post (e.g. Library's "Used in" list) that may
 * point at a draft or a post scheduled outside the calendar's currently
 * loaded month range, neither of which fetchPosts()/fetchDrafts() would
 * necessarily have already loaded. Returns null if not found or not owned.
 */
export async function fetchPostById(scope, postId) {
  const userId = assertPersonalScope(scope, 'fetchPostById');
  if (!postId) return null;

  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT_COLUMNS)
    .eq('id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/**
 * Delete a post outright. NOTE: per CALENDAR_SPEC.md §5, "Unschedule" is a
 * different, non-destructive action (returns a post to draft) implemented
 * via updatePost(), not this function — deletePost() is reserved for actual
 * destructive deletion (e.g. bulk-delete, single delete from the detail
 * drawer), matching CalendarStore.deletePost()'s original behavior.
 */
export async function deletePost(scope, postId) {
  assertPersonalScope(scope, 'deletePost');

  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId);

  if (error) throw error;
  return true;
}

/**
 * Realtime subscription on `posts`, scoped to the given user. Debounced by
 * the caller (useCalendarPosts.js applies the 800ms debounce per
 * CALENDAR_SPEC.md §8 — this function only wires the raw channel).
 *
 * Returns an unsubscribe function. Drops any stale channel with the same
 * topic first (channel() returns the existing one if already joined, and
 * .on() throws on an already-subscribed channel) — identical defensive
 * behavior to CalendarStore.subscribeToUpdates().
 */
export function subscribeToPostUpdates(scope, onChange) {
  const userId = assertPersonalScope(scope, 'subscribeToPostUpdates');

  const topic = `realtime:calendar_posts:${userId}`;
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic.replace(/^realtime:/, '')}`);
  if (stale) supabase.removeChannel(stale);

  const channel = supabase
    .channel(`calendar_posts:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'posts',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (typeof onChange === 'function') onChange(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// QUICK POST — caption pre-fill via the shared generate-post-metadata edge
// function (CALENDAR_SPEC.md §6.3, RESEARCH.md §4). Invoked in the function's
// third mode — raw `prompt`, no `post_id`/`generation_id` — since Quick Post's
// "pick zero or one Library asset" flow has no post or generation row yet at
// caption-generation time (RESEARCH.md §4.4's explicit note: the function
// will NOT write to a posts row in this mode because none exists to write
// to; the caller must use the returned fields client-side).
//
// This is a plain service call exactly like orgDraftWorkflowService.js's own
// usage of the same function (RESEARCH.md §4.3) — no Generate Studio file is
// imported or touched, satisfying Master Brief §0 rule 2.
// ============================================================================

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeHashtags(value) {
  return safeArray(value)
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

/**
 * Request a draft title/caption/hashtags for Quick Post's per-platform
 * caption fields, from a raw prompt (no post/generation linked yet).
 *
 * @param {object} params
 * @param {string} params.prompt - the user-typed topic/prompt for this post
 * @param {string} [params.platform] - target platform, tailors tone/length
 * @param {string} [params.mediaType] - 'image' | 'video' | etc.
 * @returns {Promise<{ title: string, caption: string, hashtags: string[], summary: string }>}
 */
export async function generateQuickPostCaption({ prompt, platform, mediaType } = {}) {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) {
    throw new Error('A prompt is required to pre-fill a Quick Post caption.');
  }

  const body = {
    prompt: trimmedPrompt,
    platform: platform || null,
    media_type: mediaType || null,
    fields: ['title', 'caption', 'hashtags'],
    // Deliberately no post_id / generation_id — this is the "neither" path
    // (RESEARCH.md §4.2 path 3): brand context resolves server-side from the
    // caller's own auth identity (personal brand_kit row), independent of
    // any Generate Studio/Session state.
  };

  const { data, error } = await supabase.functions.invoke(METADATA_FUNCTION, { body });

  if (error) {
    if (isEdgeFunctionUnavailable(error)) {
      markEdgeFunctionUnavailable(METADATA_FUNCTION);
      throw new Error(buildUnavailableEdgeFunctionMessage(METADATA_FUNCTION));
    }
    throw await normalizeEdgeFunctionError(error, METADATA_FUNCTION);
  }

  clearEdgeFunctionUnavailable(METADATA_FUNCTION);

  return {
    title: String(data?.title || '').trim(),
    caption: String(data?.caption || '').trim(),
    hashtags: normalizeHashtags(data?.hashtags),
    summary: String(data?.summary || '').trim(),
  };
}

// ============================================================================
// QUICK POST — fan-out create orchestration. Added in this task (Phase 3
// frontend) per CALENDAR_SPEC.md §6.3 step 4: "On submit: creates the posts
// row(s) directly." Kept in the data layer (not in PersonalCalendarPage.jsx)
// per spec §1's "page components contain no business logic" rule — the page
// wrapper only resolves scope and renders QuickPostComposer; this function is
// what actually writes to `posts`.
// ============================================================================

/**
 * Fetch the calling user's connected accounts, optionally filtered to a set
 * of platform keys. Same query shape as PostPanel.jsx's/PostDetailDrawer's
 * account-reassignment fetch (AS_IS_AUDIT.md §3.4) — kept consistent rather
 * than introducing a second connected_accounts query shape.
 */
export async function fetchConnectedAccounts(scope, { platforms = null } = {}) {
  const userId = assertPersonalScope(scope, 'fetchConnectedAccounts');

  let query = supabase
    .from('connected_accounts')
    .select('id, platform, account_name, avatar_url, connection_status')
    .eq('user_id', userId)
    .in('connection_status', ['active', 'mock', 'expired'])
    .order('platform');

  if (Array.isArray(platforms) && platforms.length) {
    query = query.in('platform', platforms);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Quick Post submit (CALENDAR_SPEC.md §6.3 step 4). Builds one `posts` row
 * per active platform toggle, resolving each platform's connected account
 * server-side (Quick Post's own UI only offers a platform toggle, never an
 * account picker — RESEARCH.md found no spec requirement for one, and the
 * approved mockup's Quick Post markup never shows one either). If a Library
 * asset was attached, every fanned-out row shares that asset's
 * `generation_id` so CalendarGrid's groupPostsByGeneration() renders them as
 * one platform-icon-stack card (spec §2.2); if no asset was attached, each
 * row's `generation_id` stays null and each renders as its own standalone
 * card (RESEARCH.md §3.2 — never bucket nulls together, which this function
 * satisfies trivially by inserting independent rows with no shared key at
 * all, not even a null one being mis-grouped client-side).
 *
 * @param {object} scope - { workspaceType: 'personal', userId }
 * @param {object} params
 * @param {'draft'|'schedule'|'publish'} params.mode - 'publish' is 'schedule'
 *        with scheduled_at already past; see the status derivation below.
 * @param {string[]} params.platforms - active platform keys (e.g. 'instagram')
 * @param {Record<string,string>} params.captions - platform key -> caption text
 * @param {Record<string,object>} params.platformOptions - platform key -> the
 *        per-post settings that platform's adapter requires, already in the
 *        adapter's own key vocabulary. Written to workflow_state.<platform>.
 * @param {Record<string,string>} params.titles - platform key -> a real title,
 *        for platforms where the title is separate from the caption.
 * @param {boolean} params.aiDisclosure - does this asset contain AI-generated media
 * @param {{ id?: string, generation_id?: string, thumbnail_url?: string, media_type?: string } | null} params.asset
 * @param {string|null} params.scheduledAtISO - already timezone-resolved UTC ISO, or null for draft
 * @returns {Promise<Array>} the created post rows
 */
export async function createQuickPost(scope, {
  mode,
  platforms,
  captions,
  asset,
  scheduledAtISO,
  platformOptions = {},
  titles = {},
  aiDisclosure = true,
}) {
  const userId = assertPersonalScope(scope, 'createQuickPost');

  const activePlatforms = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
  if (activePlatforms.length === 0) {
    throw new Error('Quick Post requires at least one platform selected.');
  }

  const accounts = await fetchConnectedAccounts(scope, { platforms: activePlatforms });
  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));

  // ── 'publish' is 'scheduled', at a time already past ──────────────────────
  //
  // There is no on-demand publish path in this product and Phase 2 deliberately
  // did not build one. publish-post has exactly ONE caller: the database cron
  // worker process-scheduled-posts, registered '* * * * *', which selects
  // status='scheduled' AND scheduled_at <= now(), marks each row publishing to
  // prevent duplicate dispatch, and caps at 50 per run
  // (20260710140000_create_process_scheduled_posts.sql). Nothing client-side can
  // invoke the publisher.
  //
  // So "publish now" writes a scheduled row whose time has passed, and the
  // proven dispatcher picks it up within the minute — no second endpoint, no
  // second auth surface, no re-solved idempotency. The caller supplies
  // scheduledAtISO = now(); this function only has to agree that 'publish' is a
  // sending mode. Any UI claiming the post IS published at this moment would be
  // asserting something nothing here knows.
  const isSending = mode === 'schedule' || mode === 'publish';
  const status = isSending ? POST_STATUS.SCHEDULED : POST_STATUS.DRAFT;
  const generationId = asset?.generation_id || null;

  if (isSending && !scheduledAtISO) {
    // Fail loudly rather than inserting a scheduled row with a null time. Such a
    // row can never satisfy `scheduled_at <= now()`, so it would sit in
    // 'scheduled' forever — visible in the calendar, counted as pending, never
    // sent, and never reported as failed. That is the silent non-terminal state
    // the reaper exists to catch; better not to create one.
    throw new Error('A post cannot be scheduled without a time.');
  }

  // `posts` has no `media_type`/`thumbnail_url`/`media_url` columns — those
  // live on `generations` only (confirmed live against the real Supabase
  // schema, 2026-06-24; see DECISIONS_LOG.md). Media metadata for a row with
  // an attached Library asset is recovered via the `generation_id` FK and the
  // `generations ( storage_path, media_type, prompt )` join already present
  // in POST_SELECT_COLUMNS — never written onto `posts` directly. Confirmed
  // real `posts` columns via a live schema probe: id, user_id, platform,
  // account_id, caption, hashtags, status, scheduled_at, generation_id,
  // title, plus org/lifecycle/moderation columns not relevant here.
  const capturedAt = new Date().toISOString();

  const rows = activePlatforms.map((platformKey) => {
    const account = accountByPlatform.get(platformKey) || null;

    // ── Per-post platform settings ────────────────────────────────────────
    //
    // Written for EVERY platform that supplied them, not only YouTube.
    //
    // This used to be `platformKey === 'youtube' && youtubeOptions`, and the
    // consequence was not cosmetic: the composer offers every platform with a
    // live credential, TikTok included, so a TikTok post was inserted with no
    // workflow_state at all. optionsFor("tiktok") then returned null
    // (publish-post/index.ts:256-259) and the adapter refused every one of them
    // — "No TikTok privacy level was chosen for this post"
    // (tiktok.service.ts:195-200), which is correct behaviour on its part,
    // because privacy_level is deliberately undefaulted there. The post was lost
    // between two components that were each behaving properly.
    //
    // The keys inside `settings` are the ADAPTER's vocabulary, produced by the
    // same options panels the Studio uses, and are passed through untouched. A
    // translation layer here would be a second place for them to drift;
    // scripts/check-composer-field-contract.cjs asserts the two ends still agree.
    const settings = platformOptions?.[platformKey]
      ? { ...platformOptions[platformKey] }
      : null;

    // AI disclosure is a fact about the ASSET, answered once in the composer and
    // carried to every destination that has somewhere to put it. YouTube's home
    // for it is status.containsSyntheticMedia, which the adapter reads from
    // contains_synthetic_media (youtube.service.ts:181-182). Instagram's
    // is_ai_generated has no adapter yet, so there is nothing to carry it to
    // there — when that adapter is built, this is where it joins.
    if (settings && platformKey === 'youtube') {
      settings.contains_synthetic_media = aiDisclosure === true;
    }

    // A real, user-supplied title wins over the asset's file name. YouTube shows
    // this above the player and falls back to post.title, so with no field for
    // it a clip published as "clip-3.mp4" (youtube.service.ts:263-266).
    const title = String(titles?.[platformKey] || '').trim() || asset?.name || null;

    return {
      user_id: userId,
      platform: platformKey,
      account_id: account?.id || null,
      caption: captions?.[platformKey] || '',
      hashtags: [],
      status,
      scheduled_at: isSending ? scheduledAtISO : null,
      generation_id: generationId,
      title,
      // Written as a whole object because this row is new: there is no prior
      // workflow_state to merge with. Every LATER writer must read-modify-write
      // instead, since approval routing and publish accounting share the column.
      ...(settings
        ? { workflow_state: { [platformKey]: { ...settings, capturedAt } } }
        : {}),
    };
  });

  const { data, error } = await supabase
    .from('posts')
    .insert(rows)
    .select(POST_SELECT_COLUMNS);

  if (error) throw error;
  return data || [];
}
