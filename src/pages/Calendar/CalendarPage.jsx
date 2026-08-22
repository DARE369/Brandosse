"use client";

// src/pages/Calendar/CalendarPage.jsx
// ui-v2 rebuild of the Personal Content Calendar (see
// docs/calendar-library-rebuild/ui-v2-migration/calendar-mockup.html, the
// APPROVED mockup, and AS_IS_AUDIT.md's "Refactor, not Reuse, not Remove"
// classification for this screen). This file replaces
// src/pages/ContentCalendar/PersonalCalendarPage.jsx as the real, routed
// Personal Calendar page (app/app/calendar/page.jsx now renders this
// component) — same pattern StudioPage.jsx/PersonalDashboardPage.jsx already
// established: real AppHeader/MobileNavDrawer/UiV2ThemeProvider shell,
// CSS Modules for anything page-shell-specific.
//
// EVERY piece of business logic below is carried over verbatim from
// PersonalCalendarPage.jsx (same hooks, same handlers, same data layer —
// src/calendar/hooks/**, src/calendar/services/calendarService.js,
// src/calendar/stores/calendarUiStore.js are all untouched per the Master
// Brief's "do not touch working data layers" rule and this task's explicit
// "do not change the data-layer behavior" instruction). Only the
// presentation changed:
//   - UserNavbar/UserSidebar/.dashboard-shell -> AppHeader/MobileNavDrawer/
//     UiV2ThemeProvider (the established ui-v2 page-shell pattern).
//   - src/styles/CalendarEngine.css -> src/calendar/calendar-engine-v2.css,
//     a class-name-for-class-name reskin of the same stylesheet onto
//     src/ui-v2/tokens.css (see that file's own header comment and
//     DECISIONS_LOG.md for why the 12 files under src/calendar/components/**
//     themselves were left untouched rather than rewritten).
//
// Below ~600px viewport width this page defaults to CalendarListView instead
// of CalendarGrid (CalendarListView.jsx's own documented mobile default,
// carried over unchanged from PersonalCalendarPage.jsx) — live on resize,
// but an explicit user pick of Month persists through subsequent resizes.
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { Sparkles, LayoutGrid, ListTodo } from 'lucide-react';

import { supabase } from '../../services/supabaseClient';
import { fetchUserSettings } from '../../services/userSettingsService';
import useBrandKitStore from '../../stores/BrandKitStore';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useCreditBalance } from '../../hooks/useCreditBalance';

import {
  DEFAULT_TIMEZONE,
  addMonthsToDateKey,
  formatDateKey,
  formatInTimeZone,
  getZonedTodayKey,
  addDaysToDateKey,
  monthStartKeyFor,
} from '../../utils/timezone';
import { isLockedForReschedule } from '../../utils/postStatusMachine';
import { POST_STATUS } from '../../constants/statuses';

import useCalendarUiStore from '../../calendar/stores/calendarUiStore';
import { useCalendarDrafts, useCalendarPosts } from '../../calendar/hooks/useCalendarPosts';
import { useScheduleAction } from '../../calendar/hooks/useScheduleAction';
import { createPost, createQuickPost, deletePost, fetchPostById, updatePost } from '../../calendar/services/calendarService';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import { fetchAssetForHandoff, toQuickPostAssetShape } from '../../services/assetLibraryService';

import CalendarGrid from '../../calendar/components/CalendarGrid';
import CalendarListView from '../../calendar/components/CalendarListView';
import UnscheduledRail from '../../calendar/components/UnscheduledRail';
import PostDetailDrawer from '../../calendar/components/PostDetailDrawer';
import ScheduleModal from '../../calendar/components/ScheduleModal';
import ConfirmDialog from '../../calendar/components/ConfirmDialog';
import QuickPostComposer from '../../calendar/components/QuickPostComposer';
import CalendarCommandBar, { CalendarCommandBarInline } from '../../calendar/components/CalendarCommandBar';
import CellCommandPalette from '../../calendar/components/CellCommandPalette';
import IntelligenceStrip from '../../calendar/components/IntelligenceStrip';
import ToastStack, { TOAST_ICONS, useToastStack } from '../../calendar/components/ToastStack';

import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton, MobileNavDrawer,
  NotificationBell, AvatarMenu, NAV_ITEMS,} from '../../ui-v2';
import '../../calendar/calendar-engine-v2.css';
import styles from './CalendarPage.module.css';

const MOBILE_VIEW_BREAKPOINT = 600;

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

function CalendarBody({ brandKit }) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const credits = useCreditBalance(user?.id ?? null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [userId, setUserId] = useState(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  const scope = useMemo(() => (userId ? { workspaceType: 'personal', userId } : null), [userId]);

  const {
    viewMode, setViewMode,
    monthStartKey, setMonthStartKey,
    draftsRailCollapsed, toggleDraftsRail,
    selectedPostId, setSelectedPostId,
    moveMode, enterMoveMode, exitMoveMode,
  } = useCalendarUiStore();

  // ── Resolve personal scope + timezone on mount ────────────────────────────
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (!mounted || !authUser?.id) return;
      setUserId(authUser.id);
      fetchUserSettings(authUser.id).then((settings) => {
        if (!mounted) return;
        setTimezone(settings.timezone || DEFAULT_TIMEZONE);
      }).catch(() => {});
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!monthStartKey) setMonthStartKey(monthStartKeyFor(getZonedTodayKey(timezone)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  const todayKey = useMemo(() => getZonedTodayKey(timezone), [timezone]);
  const tomorrowKey = useMemo(() => addDaysToDateKey(todayKey, 1), [todayKey]);
  const effectiveMonthStartKey = monthStartKey || monthStartKeyFor(todayKey);

  // ── Mobile-default view switching (live on resize, pick-respecting) ──────
  const [hasUserPickedView, setHasUserPickedView] = useState(false);
  useEffect(() => {
    function applyDefault() {
      if (hasUserPickedView) return;
      setViewMode(window.innerWidth < MOBILE_VIEW_BREAKPOINT ? 'list' : 'month');
    }
    applyDefault();
    let raf = null;
    function onResize() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = null; applyDefault(); });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUserPickedView]);

  const handleViewSwitch = useCallback((mode) => {
    setHasUserPickedView(true);
    setViewMode(mode);
  }, [setViewMode]);

  // ── Data layer ─────────────────────────────────────────────────────────────
  const monthRange = useMemo(() => {
    if (!effectiveMonthStartKey) return {};
    const start = `${effectiveMonthStartKey}T00:00:00.000Z`;
    const endKey = addMonthsToDateKey(effectiveMonthStartKey, 1);
    return { startISO: start, endISO: `${endKey}T00:00:00.000Z` };
  }, [effectiveMonthStartKey]);

  const {
    posts, groups, isLoading, isError, refetch, refetchSinglePost,
  } = useCalendarPosts(scope, { range: monthRange, enabled: Boolean(scope) });

  const { drafts, groups: draftGroups, refetch: refetchDrafts } = useCalendarDrafts(scope, { enabled: Boolean(scope) });

  const { schedulePost, reschedulePost, unschedulePost, scheduleAnyway, isSubmitting } = useScheduleAction(scope);
  const toastStack = useToastStack();

  // Holds a single fetched-on-demand post + synthetic one-post group for the
  // postId deep link (see the effect below) — not part of the normal
  // month-range/drafts data set.
  const [deepLinkedGroup, setDeepLinkedGroup] = useState(null);

  // ── Selected group (drives PostDetailDrawer) ──────────────────────────────
  const allGroups = useMemo(() => [...groups, ...draftGroups], [groups, draftGroups]);
  // deepLinkedGroup (below) covers a post that fetchPosts()/fetchDrafts()
  // haven't loaded — e.g. scheduled outside the current month range, or
  // arrived via Library's "Used in" deep link — and is only consulted as a
  // fallback so a normally-loaded post (which stays live-synced via
  // useCalendarPosts' realtime subscription) always wins once available.
  const selectedGroup = useMemo(() => {
    const loaded = allGroups.find((g) => g.posts.some((p) => p.id === selectedPostId));
    if (loaded) return loaded;
    if (deepLinkedGroup?.posts?.some((p) => p.id === selectedPostId)) return deepLinkedGroup;
    return null;
  }, [allGroups, selectedPostId, deepLinkedGroup]);

  // ── ⌘K / Quick Post / Schedule modal local UI state ───────────────────────
  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [cmdBarPreset, setCmdBarPreset] = useState('');
  const [quickPostOpen, setQuickPostOpen] = useState(false);
  const [scheduleModalPost, setScheduleModalPost] = useState(null);
  const [cellPalette, setCellPalette] = useState(null); // { dayKey, label }
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const [postNowTarget, setPostNowTarget] = useState(null);
  const [postNowBusy, setPostNowBusy] = useState(false);

  // ── Schedule hand-off from the Library (LIBRARY_SPEC.md §7) ───────────────
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const [prefillAsset, setPrefillAsset] = useState(null);

  useEffect(() => {
    const prefillAssetId = searchParams.get('prefillAssetId');
    const shouldOpenQuickPost = searchParams.get('quickPost') === '1';
    if (!shouldOpenQuickPost) return;

    let mounted = true;

    setQuickPostOpen(true);

    if (prefillAssetId) {
      fetchAssetForHandoff(prefillAssetId)
        .then((asset) => {
          if (mounted && asset) setPrefillAsset(toQuickPostAssetShape(asset));
        })
        .catch((err) => {
          console.error('[CalendarPage] Could not load hand-off asset:', err);
        });
    }

    setSearchParams((params) => {
      params.delete('quickPost');
      params.delete('prefillAssetId');
      return params;
    }, { replace: true });

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep link to a specific post (Library's AssetDetailDrawer "Used in"
  // list) ─────────────────────────────────────────────────────────────────
  // Fetches the post directly rather than waiting for it to appear in the
  // month-range/drafts queries, since it may be scheduled outside the
  // currently-visible month or be a draft beyond the drafts rail's fetch
  // limit. Waits on `scope` (resolves once auth/userId is ready) rather than
  // running unconditionally on mount, since fetchPostById requires a scope.
  useEffect(() => {
    const deepLinkPostId = searchParams.get('postId');
    if (!deepLinkPostId || !scope) return undefined;

    let mounted = true;
    fetchPostById(scope, deepLinkPostId)
      .then((post) => {
        if (!mounted) return;
        if (!post) {
          toast.error('Could not find that post — it may have been deleted.');
          return;
        }
        setDeepLinkedGroup({ groupKey: `post:${post.id}`, generationId: post.generation_id || null, posts: [post] });
        setSelectedPostId(post.id);
      })
      .catch((err) => {
        console.error('[CalendarPage] Could not load deep-linked post:', err);
        toast.error(err?.message || 'Could not open that post.');
      });

    setSearchParams((params) => {
      params.delete('postId');
      return params;
    }, { replace: true });

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // ── ⌘K shortcut ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdBarPreset('');
        setCmdBarOpen(true);
      }
      if (e.key === 'Escape') exitMoveMode();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [exitMoveMode]);

  // ── Lookup helpers ─────────────────────────────────────────────────────────
  const findGroupByKey = useCallback((groupKey) => allGroups.find((g) => g.groupKey === groupKey) || null, [allGroups]);
  const isLockedGroup = useCallback((group) => group.posts.every((p) => isLockedForReschedule(p.status)), []);

  const commitReschedule = useCallback(async (group, scheduledAtISO) => {
    const results = await Promise.all(group.posts.map((post) => {
      const action = post.status === 'draft' ? schedulePost : reschedulePost;
      return action(post, scheduledAtISO);
    }));

    const stale = results.find((r) => !r.ok && r.reason === 'stale');
    if (stale) {
      toastStack.push({
        tone: 'info', icon: TOAST_ICONS.info,
        title: 'This post changed elsewhere',
        desc: 'It was updated from another tab or device since you opened it. We refreshed this card to the latest version — your move was not applied.',
      });
      if (stale.refreshedPost) refetchSinglePost(stale.refreshedPost.id);
      return false;
    }

    const locked = results.find((r) => !r.ok && r.reason === 'locked');
    if (locked) {
      toast.error(locked.message);
      return false;
    }

    const conflictResult = results.find((r) => r.ok && r.conflict);
    if (conflictResult) {
      toastStack.push({
        tone: 'warning', icon: TOAST_ICONS.warning,
        title: 'Time slot already taken',
        desc: 'Another post is scheduled to this account at the exact same time. Nothing was overwritten.',
        scheduleAnyway: true,
        retryGroup: group,
        retryISO: scheduledAtISO,
      });
    } else {
      toast.success('Post rescheduled');
    }

    refetch();
    refetchDrafts();
    return true;
  }, [schedulePost, reschedulePost, refetch, refetchDrafts, refetchSinglePost, toastStack]);

  const handleScheduleAnyway = useCallback(async (toastEntry) => {
    if (!toastEntry?.retryGroup || !toastEntry?.retryISO) return;
    await Promise.all(toastEntry.retryGroup.posts.map((post) => scheduleAnyway(post, toastEntry.retryISO)));
    toast.success('Scheduled anyway');
    refetch();
    refetchDrafts();
  }, [scheduleAnyway, refetch, refetchDrafts]);

  const handleCommitMove = useCallback(async (groupKeyOrDraftToken, dayKey) => {
    const hour = 9;
    const scheduledAtISO = new Date(`${dayKey}T${String(hour).padStart(2, '0')}:00:00.000Z`).toISOString();

    if (groupKeyOrDraftToken?.startsWith?.('draft:')) {
      const draftId = groupKeyOrDraftToken.slice('draft:'.length);
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) return;
      const group = draftGroups.find((g) => g.posts.some((p) => p.id === draftId)) || { groupKey: `post:${draftId}`, posts: [draft] };
      await commitReschedule(group, scheduledAtISO);
      return;
    }

    const group = findGroupByKey(groupKeyOrDraftToken);
    if (!group) return;
    await commitReschedule(group, scheduledAtISO);
  }, [drafts, draftGroups, findGroupByKey, commitReschedule]);

  const handleMoveTrigger = useCallback((groupOrDraft) => {
    const groupKey = groupOrDraft.groupKey || `post:${groupOrDraft.id}`;
    if (moveMode.active && moveMode.groupKey === groupKey) {
      exitMoveMode();
      return;
    }
    enterMoveMode(groupKey);
  }, [moveMode, enterMoveMode, exitMoveMode]);

  const moveModeWithGroupKey = useMemo(() => ({ active: moveMode.active, groupKey: moveMode.postId }), [moveMode]);

  const handleMoveCommit = useCallback(async (groupKey, dayKey) => {
    exitMoveMode();
    await handleCommitMove(groupKey, dayKey);
  }, [exitMoveMode, handleCommitMove]);

  const handleOpenScheduleModal = useCallback((post) => setScheduleModalPost(post), []);

  const handleConfirmScheduleModal = useCallback(async (dateKey, timeStr) => {
    if (!scheduleModalPost) return;
    const { zonedDateTimeToUTC } = await import('../../utils/timezone');
    const scheduledAtISO = zonedDateTimeToUTC(dateKey, timeStr, timezone);
    const group = findGroupByKey(`post:${scheduleModalPost.id}`)
      || allGroups.find((g) => g.posts.some((p) => p.id === scheduleModalPost.id))
      || { groupKey: `post:${scheduleModalPost.id}`, posts: [scheduleModalPost] };
    const ok = await commitReschedule(group, scheduledAtISO);
    if (ok) setScheduleModalPost(null);
  }, [scheduleModalPost, timezone, findGroupByKey, allGroups, commitReschedule]);

  const handleSavePost = useCallback(async (post, updates) => {
    try {
      await updatePost(scope, post.id, updates, post.status);
    } catch (err) {
      toast.error(err?.message || 'Failed to save');
      return;
    }
    refetch();
    refetchDrafts();
    toast.success('Saved');
  }, [scope, refetch, refetchDrafts]);

  const handleDeletePost = useCallback((post) => {
    setDeleteConfirmTarget(post);
  }, []);

  const confirmDeletePost = useCallback(async () => {
    const post = deleteConfirmTarget;
    if (!post) return;
    try {
      await deletePost(scope, post.id);
      setDeleteConfirmTarget(null);
      setSelectedPostId(null);
      refetch();
      refetchDrafts();
      toast.success('Post deleted');
    } catch (err) {
      toast.error(err?.message || 'Failed to delete post');
    }
  }, [deleteConfirmTarget, scope, refetch, refetchDrafts, setSelectedPostId]);

  // "Post now" — publishes immediately instead of waiting for scheduled_at,
  // via the SAME simulated mock-publish edge function Studio's own publish
  // flow already uses (executeMockPublishAttempts -> mock-publish edge fn),
  // so behavior/status transitions (draft/scheduled -> publishing ->
  // published|failed) are identical, not a second publish implementation.
  const handlePostNow = useCallback((post) => {
    setPostNowTarget(post);
  }, []);

  const confirmPostNow = useCallback(async () => {
    const post = postNowTarget;
    if (!post?.account_id) {
      toast.error('This post has no target account to publish to.');
      setPostNowTarget(null);
      return;
    }
    setPostNowBusy(true);
    try {
      const { executeMockPublishAttempts } = await import('../../services/platforms/mockPublishWorkflow');
      const { summary } = await executeMockPublishAttempts({
        attempts: [{ postId: post.id, accountId: post.account_id, userId: user?.id }],
        source: 'calendar-post-now',
      });
      setPostNowTarget(null);
      refetch();
      refetchDrafts();
      if (summary.anyFailed) toast.error(summary.message);
      else toast.success(summary.message);
    } catch (err) {
      toast.error(err?.message || 'Could not publish this post.');
    } finally {
      setPostNowBusy(false);
    }
  }, [postNowTarget, user?.id, refetch, refetchDrafts]);

  const handleUnschedulePost = useCallback(async (post) => {
    const result = await unschedulePost(post);
    if (result.ok) {
      toast.success('Moved back to drafts');
      refetch();
      refetchDrafts();
    } else {
      toast.error(result.message || 'Could not unschedule');
    }
  }, [unschedulePost, refetch, refetchDrafts]);

  const handleDuplicatePost = useCallback(async (post) => {
    try {
      await createPost(scope, {
        title: post.title, caption: post.caption, hashtags: post.hashtags,
        platform: post.platform, account_id: post.account_id,
        generation_id: post.generation_id || null,
        status: POST_STATUS.DRAFT, scheduled_at: null,
      });
      refetchDrafts();
      toast.success('Duplicated to a new draft');
    } catch (err) {
      const isDuplicateDraftConflict = err?.code === '23505'
        || /idx_posts_unique_draft_per_generation_account/.test(err?.message || err?.details || '');
      if (isDuplicateDraftConflict) {
        toastStack.push({
          tone: 'danger',
          icon: TOAST_ICONS.danger,
          title: 'A draft for this asset already exists',
          desc: 'This account already has a draft using the same asset — open that draft instead of creating another copy.',
        });
      } else {
        toast.error(err?.message || 'Could not duplicate');
      }
    }
  }, [scope, toastStack]);

  const handleCreateDraftForDay = useCallback(async (dayKey) => {
    try {
      const scheduledAt = new Date(`${dayKey}T12:00:00.000Z`).toISOString();
      await createPost(scope, { scheduled_at: scheduledAt, status: POST_STATUS.DRAFT, caption: '' });
      refetchDrafts();
      toast.success('Draft created — edit it in the drawer');
    } catch (err) {
      toast.error(err?.message || 'Could not create post');
    }
  }, [scope]);

  const handleQuickPostSubmit = useCallback(async (payload) => {
    try {
      await createQuickPost(scope, {
        mode: payload.mode,
        platforms: payload.platforms,
        captions: payload.captions,
        asset: payload.asset,
        scheduledAtISO: payload.scheduledAtISO,
      });
      refetch();
      refetchDrafts();
      toastStack.push({
        tone: 'success',
        icon: TOAST_ICONS.success,
        title: payload.mode === 'draft' ? 'Saved as draft' : 'Post scheduled',
        desc: 'Find it in the Drafts rail, the calendar, or the Library anytime.',
      });
      return true;
    } catch (err) {
      console.error('[CalendarPage] Quick Post submit failed:', err);
      toastStack.push({
        tone: 'danger',
        icon: TOAST_ICONS.danger,
        title: 'Could not save this post',
        desc: err?.message ? `${err.message} — nothing was saved. Your captions are still in the form.` : 'Nothing was saved. Your captions are still in the form.',
      });
      return false;
    }
  }, [scope, refetch, refetchDrafts, toastStack]);

  const handleCellPaletteAction = useCallback((actionId) => {
    if (!cellPalette) return;
    const { label } = cellPalette;
    setCellPalette(null);

    if (actionId === 'new_post') {
      setQuickPostOpen(true);
      return;
    }
    if (actionId === 'schedule_draft') {
      setCmdBarPreset(`Schedule a draft for ${label}`);
      setCmdBarOpen(true);
      return;
    }
    if (actionId === 'ai_suggest' || actionId === 'week_plan') {
      setCmdBarPreset(actionId === 'week_plan' ? 'Generate a week plan for my drafts' : `What should I post on ${label}?`);
      setCmdBarOpen(true);
    }
  }, [cellPalette]);

  const handleCommandApply = useCallback(async (action, result) => {
    if (!action) { setCmdBarOpen(false); return; }

    if (action.type === 'reschedule' && action.payload?.postId) {
      const target = posts.find((p) => p.id === action.payload.postId);
      if (!target) { setCmdBarOpen(false); return; }
      const group = findGroupByKey(`post:${target.id}`) || allGroups.find((g) => g.posts.some((p) => p.id === target.id)) || { groupKey: `post:${target.id}`, posts: [target] };
      await commitReschedule(group, action.payload.newScheduledAt);
      setCmdBarOpen(false);
      return;
    }

    if (action.type === 'update_caption' && action.payload?.postId) {
      const target = posts.find((p) => p.id === action.payload.postId) || drafts.find((d) => d.id === action.payload.postId);
      if (target) {
        try {
          await updatePost(scope, target.id, {
            caption: action.payload.caption,
            hashtags: action.payload.hashtags,
          }, target.status);
          refetch();
          refetchDrafts();
          toast.success('Caption updated');
        } catch (err) {
          toast.error(err?.message || 'Caption update failed');
        }
      }
      setCmdBarOpen(false);
      return;
    }

    if (action.type === 'audit' && action.payload?.postId) {
      setSelectedPostId(action.payload.postId);
      setCmdBarOpen(false);
      return;
    }

    // ── LOCK L2.4 — the four actions that used to silently do nothing ────────
    //
    // Everything below this point previously fell through to a bare
    // `setCmdBarOpen(false)`: the dialog closed, nothing was written, and no
    // toast or error was shown. "Ask AI" is the FIRST suggested command in the
    // bar, it really does generate a Groq-backed weekly plan, and clicking
    // "Apply week plan" discarded it. The user was left believing their week
    // had been planned.
    //
    // The plumbing was already complete on the other side —
    // CalendarCommandBar:200 passes `(action, result)` with a comment saying
    // the parent can read `result.plan`. This handler simply never accepted
    // the second argument.

    // Apply a generated week plan — create a draft post per planned item.
    // Drafts rather than scheduled posts: the plan is a proposal, and silently
    // committing a week of live scheduled posts from one click would be a
    // worse failure than the one being fixed.
    if (action.type === 'week_plan') {
      const plan = Array.isArray(result?.plan) ? result.plan : [];
      if (plan.length === 0) {
        toast.error('That plan came back empty — nothing to apply.');
        setCmdBarOpen(false);
        return;
      }

      const toastId = toast.loading(`Creating ${plan.length} draft posts…`);
      let created = 0;
      const failures = [];

      for (const item of plan) {
        try {
          // `day` is YYYY-MM-DD and `time` is HH:MM, per the calendar-ai
          // contract (calendar-ai/index.ts:103).
          const when = item?.day && item?.time
            ? new Date(`${item.day}T${item.time}:00`)
            : null;
          const scheduledAt = when && !Number.isNaN(when.getTime())
            ? when.toISOString()
            : null;

          await createPost(scope, {
            title: item?.hook || null,
            caption: item?.caption || '',
            hashtags: Array.isArray(item?.hashtags) ? item.hashtags : [],
            platform: item?.platform || null,
            scheduled_at: scheduledAt,
            status: POST_STATUS.DRAFT,
            generation_id: item?.draftId || null,
          });
          created += 1;
        } catch (err) {
          failures.push(err?.message || 'unknown error');
        }
      }

      refetch();
      refetchDrafts();
      toast.dismiss(toastId);

      // Report the real outcome, including partial success — never a blanket
      // "done" that hides failures.
      if (created === 0) {
        toast.error(`Could not create any posts. ${failures[0] ?? ''}`.trim());
      } else if (failures.length > 0) {
        toast.success(`Created ${created} of ${plan.length} drafts — ${failures.length} failed.`);
      } else {
        toast.success(`Created ${created} draft post${created === 1 ? '' : 's'}.`);
      }
      setCmdBarOpen(false);
      return;
    }

    // Schedule an existing draft at the AI-proposed time.
    if (action.type === 'add_draft_post' && action.payload?.draftId) {
      const { draftId, scheduledAt, platform } = action.payload;
      const target = drafts.find((d) => d.id === draftId) || posts.find((p) => p.id === draftId);
      if (!target) {
        toast.error('That draft no longer exists.');
        setCmdBarOpen(false);
        return;
      }
      try {
        await updatePost(scope, target.id, {
          scheduled_at: scheduledAt || target.scheduled_at,
          ...(platform ? { platform } : {}),
          status: POST_STATUS.SCHEDULED,
        }, target.status);
        refetch();
        refetchDrafts();
        toast.success('Draft scheduled.');
      } catch (err) {
        toast.error(err?.message || 'Could not schedule that draft.');
      }
      setCmdBarOpen(false);
      return;
    }

    if (action.type === 'delete_post' && action.payload?.postId) {
      const target = posts.find((p) => p.id === action.payload.postId)
        || drafts.find((d) => d.id === action.payload.postId);
      if (!target) {
        toast.error('That post no longer exists.');
        setCmdBarOpen(false);
        return;
      }
      try {
        await deletePost(scope, target.id);
        refetch();
        refetchDrafts();
        toast.success('Post deleted.');
      } catch (err) {
        toast.error(err?.message || 'Could not delete that post.');
      }
      setCmdBarOpen(false);
      return;
    }

    // "Show optimal slots" is a read-only action — the suggestions are already
    // rendered in the result panel. Confirm that rather than closing silently,
    // and deliberately do NOT create posts: the label promises to show, not to
    // schedule, and inventing writes the user did not ask for is its own bug.
    if (action.type === 'suggest_slots') {
      const count = Array.isArray(result?.suggestions) ? result.suggestions.length : 0;
      toast.success(
        count > 0
          ? `${count} suggested slot${count === 1 ? '' : 's'} listed above.`
          : 'No slot suggestions came back for that week.',
      );
      return; // keep the bar open so the suggestions stay visible
    }

    // Any action type we do not handle must say so out loud. Silence here is
    // what this lock exists to eliminate.
    console.warn('[calendar] unhandled AI action type:', action.type, action);
    toast.error(`"${action.type}" is not supported yet.`);
    setCmdBarOpen(false);
  }, [posts, drafts, allGroups, scope, findGroupByKey, commitReschedule, refetch, refetchDrafts, setSelectedPostId]);

  const cmdBarContext = useMemo(() => ({
    weekStart: `${effectiveMonthStartKey}T00:00:00.000Z`,
    posts, drafts, selectedPostId,
  }), [effectiveMonthStartKey, posts, drafts, selectedPostId]);

  const goPrev = useCallback(() => { setMonthStartKey(addMonthsToDateKey(effectiveMonthStartKey, -1)); }, [effectiveMonthStartKey, setMonthStartKey]);
  const goNext = useCallback(() => { setMonthStartKey(addMonthsToDateKey(effectiveMonthStartKey, 1)); }, [effectiveMonthStartKey, setMonthStartKey]);

  const monthLabel = formatDateKey(effectiveMonthStartKey, { month: 'long', year: 'numeric' });
  const isEmpty = !isLoading && posts.length === 0 && drafts.length === 0;

  const userInitials = ((profile?.full_name ? profile.full_name[0] : 'U') + (profile?.full_name?.split(' ')[1]?.[0] ?? '')).toUpperCase();
  const creditPct = credits.lifetimePurchased > 0 ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100))) : 100;

  return (
    <>
      <Toaster position="bottom-right" toastOptions={{ style: { fontSize: 13, background: 'var(--uiv2-bg-elevated)', color: 'var(--uiv2-text-primary)', border: '1px solid var(--uiv2-border)' } }} />

      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="calendar"
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={
          <>
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : null}
            <ThemeToggleButton />
            <NotificationBell userId={user?.id} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || 'U'} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        }
      />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey="calendar"
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className="cal3-shell">
            <header className="cal3-header">
              <div className="cal3-header__nav">
                <button type="button" className="cal3-icon-btn" onClick={goPrev} aria-label="Previous month">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button type="button" className="cal3-icon-btn" onClick={goNext} aria-label="Next month">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
              <div className="cal3-header__title">
                <span className="cal3-header__month-label">{monthLabel}</span>
                <span className="cal3-header__today-badge">Today: {formatDateKey(todayKey, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="cal3-header__actions">
                <div className="cal3-view-switcher">
                  <button type="button" className={`cal3-view-switcher__btn${viewMode === 'month' ? ' is-active' : ''}`} onClick={() => handleViewSwitch('month')}>
                    <LayoutGrid size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />Month
                  </button>
                  <button type="button" className={`cal3-view-switcher__btn${viewMode === 'list' ? ' is-active' : ''}`} onClick={() => handleViewSwitch('list')}>
                    <ListTodo size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />List
                  </button>
                </div>
                <button type="button" className="cal3-btn-ghost" onClick={() => { setCmdBarPreset(''); setCmdBarOpen(true); }}>
                  <Sparkles size={13} aria-hidden="true" /> Ask AI <span className="cal3-kbd">⌘K</span>
                </button>
                <button type="button" className="ui-button ui-button-accent ui-button-md" onClick={() => setQuickPostOpen(true)}>+ Quick Post</button>
              </div>
            </header>

            <IntelligenceStrip posts={posts} weekStart={`${effectiveMonthStartKey}T00:00:00.000Z`} />

            <CalendarCommandBarInline
              onOpen={() => { setCmdBarPreset(''); setCmdBarOpen(true); }}
              onOpenWithPreset={(text) => { setCmdBarPreset(text); setCmdBarOpen(true); }}
            />

            <div className="cal3-body">
              {moveMode.active && (
                <div className="move-mode-banner">
                  <span className="move-mode-banner__icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l3 3 3-3" /><path d="M19 9l3 3-3 3" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
                  </span>
                  <span className="move-mode-banner__text">
                    Moving <strong>{(findGroupByKey(moveMode.postId)?.posts[0]?.title) || 'this post'}</strong> — tap a highlighted day to schedule it there.
                  </span>
                  <button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={exitMoveMode}>Cancel</button>
                </div>
              )}

              <div className="cal3-main-col">
                {viewMode === 'list' ? (
                  <CalendarListView
                    groups={allGroups}
                    isLoading={isLoading}
                    timezone={timezone}
                    todayKey={todayKey}
                    tomorrowKey={tomorrowKey}
                    formatDateKey={formatDateKey}
                    formatInTimeZone={formatInTimeZone}
                    onOpenGroup={(group) => setSelectedPostId(group.posts[0].id)}
                  />
                ) : (
                  <CalendarGrid
                    monthStartKey={effectiveMonthStartKey}
                    groups={groups}
                    isLoading={isLoading}
                    isEmpty={isEmpty}
                    timezone={timezone}
                    todayKey={todayKey}
                    formatDateKey={formatDateKey}
                    formatInTimeZone={formatInTimeZone}
                    moveMode={moveModeWithGroupKey}
                    isLockedGroup={isLockedGroup}
                    onOpenGroup={(group) => setSelectedPostId(group.posts[0].id)}
                    onMoveTrigger={handleMoveTrigger}
                    onCommitMove={handleMoveCommit}
                    onCreateDraftForDay={handleCreateDraftForDay}
                    onCellClick={({ dayKey, label }) => setCellPalette({ dayKey, label })}
                    onQuickPost={() => setQuickPostOpen(true)}
                  />
                )}

                {isError && !isLoading && (
                  <div className="day-error-state" role="alert">
                    <span className="day-error-state__icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    </span>
                    <p>Couldn&apos;t load posts. Check your connection and try again.</p>
                    <button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={() => refetch()}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                      Retry
                    </button>
                  </div>
                )}
              </div>

              <UnscheduledRail
                workspaceType="personal"
                drafts={drafts}
                collapsed={draftsRailCollapsed}
                onToggle={toggleDraftsRail}
                onOpenDraft={(draft) => setSelectedPostId(draft.id)}
                onMoveTrigger={handleMoveTrigger}
              />
            </div>

            {cellPalette && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setCellPalette(null)}>
                <CellCommandPalette
                  day={cellPalette.dayKey}
                  style={{ position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%, -50%)' }}
                  onAction={handleCellPaletteAction}
                  onClose={() => setCellPalette(null)}
                />
              </div>
            )}

            {cmdBarOpen && (
              <CalendarCommandBar
                context={cmdBarContext}
                preset={cmdBarPreset}
                onClose={() => setCmdBarOpen(false)}
                onApplyAction={handleCommandApply}
              />
            )}

            {selectedGroup && (
              <PostDetailDrawer
                group={selectedGroup}
                timezone={timezone}
                brandKit={brandKit}
                onClose={() => { setSelectedPostId(null); setDeepLinkedGroup(null); }}
                onSavePost={handleSavePost}
                onDeletePost={handleDeletePost}
                onReschedule={handleOpenScheduleModal}
                onUnschedule={handleUnschedulePost}
                onDuplicate={handleDuplicatePost}
                onPostNow={handlePostNow}
              />
            )}

            {scheduleModalPost && (
              <ScheduleModal
                open
                post={scheduleModalPost}
                timezone={timezone}
                isSubmitting={isSubmitting}
                onClose={() => setScheduleModalPost(null)}
                onConfirm={handleConfirmScheduleModal}
              />
            )}

            <ConfirmDialog
              open={Boolean(deleteConfirmTarget)}
              title="Delete this post?"
              description="This can't be undone. The scheduled slot will be freed up."
              confirmLabel="Delete post"
              confirmTone="danger"
              onConfirm={confirmDeletePost}
              onClose={() => setDeleteConfirmTarget(null)}
            />

            <ConfirmDialog
              open={Boolean(postNowTarget)}
              title="Publish now?"
              description="This posts immediately (simulated) instead of waiting for its scheduled time. Unlike a draft, this can't be undone from here."
              confirmLabel="Post now"
              confirmTone="primary"
              busy={postNowBusy}
              onConfirm={confirmPostNow}
              onClose={() => setPostNowTarget(null)}
            />

            {quickPostOpen && (
              <QuickPostComposer
                open
                timezone={timezone}
                libraryAssets={prefillAsset ? [prefillAsset] : []}
                prefillAsset={prefillAsset}
                onClose={() => { setQuickPostOpen(false); setPrefillAsset(null); }}
                onSubmit={handleQuickPostSubmit}
              />
            )}

            <ToastStack toasts={toastStack.toasts} onDismiss={toastStack.dismiss} onScheduleAnyway={handleScheduleAnyway} />
          </div>
        </div>
      </main>
    </>
  );
}

export default function CalendarPage() {
  const brandKit = useBrandKitStore((s) => s.brandKit);
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <CalendarBody brandKit={brandKit} />
    </UiV2ThemeProvider>
  );
}
