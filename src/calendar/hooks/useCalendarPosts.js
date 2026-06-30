// ============================================================================
// useCalendarPosts — scope-aware data hook over calendarService.js, built on
// @tanstack/react-query (already a project dependency — RESEARCH.md §1.1;
// no second data-fetching pattern introduced, per Master Brief §0 rule 5's
// spirit of not inventing new state-management conventions).
//
// Implements CALENDAR_SPEC.md §2.2's multi-platform grouping: posts sharing
// a `generation_id` are grouped into one "card group" (platform-icon-stack
// rendering is the next task's job — this hook only produces the grouped
// data shape). A null/missing `generation_id` is ALWAYS rendered as its own
// standalone group of one — RESEARCH.md §3.2's flagged footgun: a naive
// `groupBy(post => post.generation_id)` (or `Object.groupBy`, which coerces
// null/undefined keys to the literal strings "null"/"undefined") would
// incorrectly bucket every null-generation post into one shared group. This
// hook avoids that entirely by giving every null-generation post its own
// synthetic, never-colliding group key.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDrafts as fetchDraftsService,
  fetchPosts as fetchPostsService,
  subscribeToPostUpdates,
} from '../services/calendarService';

// Matches the Dashboard's existing realtime debounce convention
// (CALENDAR_SPEC.md §8: "debounced 800ms — identical convention to the
// Dashboard's existing realtime pattern").
const REALTIME_DEBOUNCE_MS = 800;

export function calendarPostsQueryKey(scope, range) {
  return [
    'calendar-posts',
    scope?.workspaceType || null,
    scope?.organizationId || null,
    scope?.brandProjectId || null,
    scope?.userId || null,
    range?.startISO || null,
    range?.endISO || null,
  ];
}

export function calendarDraftsQueryKey(scope) {
  return [
    'calendar-drafts',
    scope?.workspaceType || null,
    scope?.organizationId || null,
    scope?.brandProjectId || null,
    scope?.userId || null,
  ];
}

/**
 * Group a flat posts array by `generation_id`, per CALENDAR_SPEC.md §2.2.
 * Returns an array of group objects: { groupKey, generationId, posts }.
 *
 * - posts sharing a non-null generation_id are grouped together (this is
 *   the multi-platform fan-out case: one generation -> N posts rows, one
 *   per platform/account, per PERSONAL_WORKSPACE_SPEC.md §5.4).
 * - posts with a null/missing generation_id are NEVER bucketed with each
 *   other — each gets its own unique synthetic group key, so a grid/list
 *   consumer never has to special-case "is this really one card or many."
 * - Group order follows the order groups are first encountered in the input
 *   array (which itself is already sorted by scheduled_at by the service
 *   layer's query) — no re-sorting happens here, so callers that need a
 *   different sort order should sort before or after grouping deliberately.
 */
export function groupPostsByGeneration(posts) {
  const groups = [];
  const groupIndexByGenerationId = new Map();

  for (const post of posts) {
    const generationId = post?.generation_id ?? null;

    if (generationId === null) {
      // Standalone, ungroupable — own synthetic key, never shared with any
      // other null-generation post. Using the post's own id guarantees
      // uniqueness without relying on string-coercion of null/undefined.
      groups.push({
        groupKey: `post:${post.id}`,
        generationId: null,
        posts: [post],
      });
      continue;
    }

    if (groupIndexByGenerationId.has(generationId)) {
      groups[groupIndexByGenerationId.get(generationId)].posts.push(post);
    } else {
      groupIndexByGenerationId.set(generationId, groups.length);
      groups.push({
        groupKey: `generation:${generationId}`,
        generationId,
        posts: [post],
      });
    }
  }

  return groups;
}

/**
 * useCalendarPosts — fetches calendar-visible posts (scheduled/published/
 * publishing/failed) for a scope, grouped by generation_id.
 *
 * @param {object} scope - { workspaceType: 'personal', userId } (org not
 *   yet implemented in this packet — see calendarService.js's
 *   assertPersonalScope, which throws rather than silently misbehaving).
 * @param {object} [options]
 * @param {{ startISO?: string, endISO?: string }} [options.range] - optional
 *   scheduled_at window (e.g. the currently-visible month/week).
 * @param {boolean} [options.enabled] - passed straight to react-query.
 */
export function useCalendarPosts(scope, options = {}) {
  const { range = {}, enabled = true } = options;
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef(null);

  const isScopeReady = Boolean(scope?.userId) && scope?.workspaceType === 'personal';
  const queryKey = useMemo(() => calendarPostsQueryKey(scope, range), [scope, range]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPostsService(scope, range),
    enabled: enabled && isScopeReady,
  });

  // Realtime subscription, debounced 800ms per CALENDAR_SPEC.md §8. Any
  // change just invalidates the query — react-query handles the actual
  // re-fetch, so this hook never duplicates fetch logic.
  useEffect(() => {
    if (!isScopeReady) return undefined;

    const unsubscribe = subscribeToPostUpdates(scope, () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: calendarPostsQueryKey(scope, range) });
        queryClient.invalidateQueries({ queryKey: calendarDraftsQueryKey(scope) });
      }, REALTIME_DEBOUNCE_MS);
    });

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScopeReady, scope?.userId, scope?.workspaceType, scope?.organizationId, scope?.brandProjectId, range.startISO, range.endISO]);

  const posts = query.data || [];
  const groups = useMemo(() => groupPostsByGeneration(posts), [posts]);

  // Re-fetch a single post by id (CALENDAR_SPEC.md §5's stale-write recovery:
  // "the UI rolls back and re-fetches that single card rather than silently
  // overwriting"). Implemented as a full posts re-fetch + cache patch since
  // there is no single-post query key to target in isolation without
  // duplicating the list's own caching — cheap enough for one row.
  const refetchSinglePost = useCallback(async (postId) => {
    const freshList = await fetchPostsService(scope, range);
    queryClient.setQueryData(queryKey, freshList);
    return freshList.find((p) => p.id === postId) || null;
  }, [scope, range, queryClient, queryKey]);

  return {
    posts,
    groups,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    refetchSinglePost,
  };
}

/**
 * useCalendarDrafts — fetches draft posts for the Drafts rail
 * (CALENDAR_SPEC.md §3's personal "Drafts" rail). Separate query key from
 * useCalendarPosts since drafts are excluded from the main grid fetch
 * (identical split to the original CalendarStore.js fetchPosts/fetchDrafts).
 */
export function useCalendarDrafts(scope, options = {}) {
  const { enabled = true } = options;
  const isScopeReady = Boolean(scope?.userId) && scope?.workspaceType === 'personal';
  const queryKey = useMemo(() => calendarDraftsQueryKey(scope), [scope]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchDraftsService(scope),
    enabled: enabled && isScopeReady,
  });

  const drafts = query.data || [];
  const groups = useMemo(() => groupPostsByGeneration(drafts), [drafts]);

  return {
    drafts,
    groups,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
