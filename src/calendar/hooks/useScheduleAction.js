// ============================================================================
// useScheduleAction — THE single shared implementation of schedule /
// reschedule / unschedule (CALENDAR_SPEC.md §6), used by every reschedule
// mode the approved mockup demonstrates: drag, full PostDetailDrawer edit,
// and tap-to-select -> tap-destination. Also backs Quick Post's "pick a
// date/time or save as draft" submit step (§6.3).
//
// Implements:
//   - The optimistic-concurrency guard (CALENDAR_SPEC.md §5): every write
//     includes the row's last-known `updated_at`; if the server's current
//     `updated_at` no longer matches what the caller last saw, the write is
//     treated as stale — the hook rolls the affected card back (re-fetches
//     it) instead of silently overwriting a change made elsewhere. Posts
//     are written through `posts.updated_at`, which is maintained by the
//     `enforce_post_lifecycle` trigger on every INSERT/UPDATE
//     (supabase/migrations/20260227090000_calendar_library_alignment.sql),
//     so the staleness check is read-then-conditionally-write, not a DB-level
//     constraint — see DECISIONS_LOG.md for why and the residual risk.
//   - The conflict check (CALENDAR_SPEC.md §5): same connected account +
//     same platform + same exact `scheduled_at` timestamp already occupied
//     by a different post -> the action still succeeds (never a hard
//     block), but the hook reports a `conflict` result so the UI can render
//     the non-blocking "schedule anyway" toast the mockup demonstrates.
//   - The reschedule-lock rule already encoded in postStatusMachine.js
//     (isLockedForReschedule) — published/archived/publishing posts refuse
//     the write up front with a clear reason, exactly like
//     CalendarPageV3.jsx's existing `isLockedForReschedule(drag.post.status)`
//     check (AS_IS_AUDIT.md §3.1), carried forward into the shared hook.
// ============================================================================

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabaseClient';
import { isLockedForReschedule } from '../../utils/postStatusMachine';
import { POST_STATUS } from '../../constants/statuses';
import { updatePost as updatePostService } from '../services/calendarService';
import { calendarDraftsQueryKey, calendarPostsQueryKey } from './useCalendarPosts';

/**
 * Result shapes returned by every action below:
 *   { ok: true, post, conflict: null | { conflictingPost } }
 *   { ok: false, reason: 'locked' | 'stale' | 'error', message, refreshedPost? }
 *
 * `refreshedPost` is populated on a 'stale' result so the caller can patch
 * just that one card with the server's current truth, per spec §5's "rolls
 * back and re-fetches that single card" requirement.
 */

async function fetchPostUpdatedAt(postId) {
  const { data, error } = await supabase
    .from('posts')
    .select('id, updated_at, status')
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchFullPost(scope, postId) {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      connected_accounts ( id, platform, account_name, avatar_url ),
      generations ( storage_path, media_type, prompt )
    `)
    .eq('id', postId)
    .eq('user_id', scope.userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Conflict check: another post owned by the same user, same connected
 * account + same platform + the exact same scheduled_at timestamp,
 * excluding the post being written itself. Non-blocking by design (spec §5)
 * — this is informational, never a reason to refuse the write.
 */
async function findSchedulingConflict(scope, { postId, accountId, platform, scheduledAtISO }) {
  if (!scheduledAtISO || !platform) return null;

  let query = supabase
    .from('posts')
    .select('id, title, caption, platform, account_id, scheduled_at')
    .eq('user_id', scope.userId)
    .eq('platform', platform)
    .eq('scheduled_at', scheduledAtISO)
    .neq('id', postId);

  query = accountId ? query.eq('account_id', accountId) : query.is('account_id', null);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    // Conflict-checking is informational only — never let a failed conflict
    // lookup block the actual schedule write.
    console.error('[useScheduleAction] conflict check failed:', error);
    return null;
  }
  return data || null;
}

export function useScheduleAction(scope) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['calendar-posts'] });
    queryClient.invalidateQueries({ queryKey: ['calendar-drafts'] });
  }, [queryClient]);

  /**
   * Core write path shared by schedule/reschedule/unschedule. Performs the
   * optimistic-concurrency check, the (non-blocking) conflict check, then
   * the actual write through calendarService.updatePost (which itself routes
   * every status change through assertPostStatusTransition()).
   *
   * @param {object} post - the post object as last known to the caller
   *   (must include at least { id, status, updated_at }).
   * @param {object} updates - fields to write, e.g. { scheduled_at, status }.
   */
  const writePost = useCallback(async (post, updates) => {
    if (!post?.id) {
      return { ok: false, reason: 'error', message: 'No post id provided.' };
    }

    if (isLockedForReschedule(post.status) && !Object.prototype.hasOwnProperty.call(updates, '__forceLockedWrite')) {
      return {
        ok: false,
        reason: 'locked',
        message: "Published posts can't be rescheduled — open the post to see options.",
      };
    }

    setIsSubmitting(true);
    try {
      // ---- Optimistic-concurrency guard (spec §5) ----
      const serverRow = await fetchPostUpdatedAt(post.id);
      if (!serverRow) {
        return { ok: false, reason: 'error', message: 'Post no longer exists.' };
      }
      if (post.updated_at && serverRow.updated_at && serverRow.updated_at !== post.updated_at) {
        const refreshedPost = await fetchFullPost(scope, post.id);
        return {
          ok: false,
          reason: 'stale',
          message: 'Someone else updated this post. Refreshed with the latest version.',
          refreshedPost,
        };
      }

      // ---- Conflict check (spec §5) — informational, non-blocking ----
      let conflict = null;
      if (updates.scheduled_at) {
        const conflictingPost = await findSchedulingConflict(scope, {
          postId: post.id,
          accountId: updates.account_id ?? post.account_id ?? null,
          platform: updates.platform ?? post.platform ?? null,
          scheduledAtISO: updates.scheduled_at,
        });
        if (conflictingPost) conflict = { conflictingPost };
      }

      // ---- The actual write ----
      const { __forceLockedWrite, ...cleanUpdates } = updates;
      const saved = await updatePostService(scope, post.id, cleanUpdates, post.status);

      invalidate();
      return { ok: true, post: saved, conflict };
    } catch (error) {
      return { ok: false, reason: 'error', message: error?.message || 'Failed to save the post.' };
    } finally {
      setIsSubmitting(false);
    }
  }, [scope, invalidate]);

  /**
   * Schedule a draft (or reschedule an already-scheduled post) to a new
   * date/time. `scheduledAtISO` must already be resolved to UTC by the
   * caller's account-timezone-aware picker (src/utils/timezone.js) — this
   * hook never re-derives or re-interprets timezone itself, per
   * CALENDAR_SPEC.md §6's "account timezone, not browser timezone" rule
   * living entirely in the picker UI, not the action layer.
   */
  const schedulePost = useCallback((post, scheduledAtISO, extraUpdates = {}) => {
    return writePost(post, {
      scheduled_at: scheduledAtISO,
      status: POST_STATUS.SCHEDULED,
      ...extraUpdates,
    });
  }, [writePost]);

  /**
   * Reschedule an already-scheduled post to a different date/time, without
   * changing its status. This is the drag / tap-to-select / detail-drawer
   * date-field path for a post that's already on the grid.
   */
  const reschedulePost = useCallback((post, scheduledAtISO) => {
    return writePost(post, { scheduled_at: scheduledAtISO });
  }, [writePost]);

  /**
   * Unschedule: returns a post to draft (personal scope) without deleting
   * the underlying content — CALENDAR_SPEC.md §5: "it never deletes the
   * underlying content." Org's "approved-but-unplaced backlog" equivalent
   * is not implemented here (Packet 3).
   */
  const unschedulePost = useCallback((post) => {
    return writePost(post, { scheduled_at: null, status: POST_STATUS.DRAFT });
  }, [writePost]);

  /**
   * Explicit "schedule anyway" follow-up after a conflict toast — re-issues
   * the same write, this time accepting the known conflict (the conflict
   * itself was never blocking; this just lets the UI re-confirm intent
   * without re-running the concurrency/conflict checks a second time, since
   * the first call already told the truth about both).
   */
  const scheduleAnyway = useCallback(async (post, scheduledAtISO, extraUpdates = {}) => {
    return writePost(post, {
      scheduled_at: scheduledAtISO,
      status: POST_STATUS.SCHEDULED,
      ...extraUpdates,
    });
  }, [writePost]);

  return {
    schedulePost,
    reschedulePost,
    unschedulePost,
    scheduleAnyway,
    isSubmitting,
  };
}

// Re-exported so a caller that already has react-query's queryClient handy
// can invalidate calendar data after an action performed outside this hook
// (e.g. Quick Post's createPost call, which goes through calendarService
// directly rather than useScheduleAction since it's a create, not a
// schedule/reschedule/unschedule of an existing row).
export function invalidateCalendarQueries(queryClient, scope) {
  queryClient.invalidateQueries({ queryKey: calendarPostsQueryKey(scope, {}) });
  queryClient.invalidateQueries({ queryKey: calendarDraftsQueryKey(scope) });
  queryClient.invalidateQueries({ queryKey: ['calendar-posts'] });
  queryClient.invalidateQueries({ queryKey: ['calendar-drafts'] });
}
