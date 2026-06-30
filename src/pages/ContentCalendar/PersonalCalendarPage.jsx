'use client';
// PersonalCalendarPage — THIN wrapper (CALENDAR_SPEC.md §1's explicit rule:
// "the page components contain no business logic"). Resolves personal scope
// (the signed-in user's own id) and renders the shared src/calendar/ engine.
// Any behavior difference between personal and org calendars is expressed as
// a prop/permission check inside the shared engine components themselves —
// nothing forked at the page level.
//
// This file replaces CalendarPageV3.jsx as the real, routed Personal
// Calendar page (app/app/calendar/page.jsx now renders this component).
//
// Below ~600px viewport width this page defaults to CalendarListView instead
// of CalendarGrid (the approved mockup's Fix 1 / MOBILE_UX_CRITIQUE.md
// finding) — live on resize, but an explicit user pick of Month persists
// through subsequent resizes (DECISIONS_LOG.md, "Phase 2 (post-critique
// fixes, round 2)").
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { Sparkles } from 'lucide-react';

import UserNavbar from '../../components/User/UserNavbar';
import UserSidebar from '../../components/User/UserSidebar';
import { supabase } from '../../services/supabaseClient';
import { fetchUserSettings } from '../../services/userSettingsService';
import useBrandKitStore from '../../stores/BrandKitStore';

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

import useCalendarUiStore from '../../calendar/stores/calendarUiStore';
import { useCalendarDrafts, useCalendarPosts } from '../../calendar/hooks/useCalendarPosts';
import { useScheduleAction } from '../../calendar/hooks/useScheduleAction';
import { createPost, createQuickPost, deletePost, updatePost } from '../../calendar/services/calendarService';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import { fetchAssetForHandoff, toQuickPostAssetShape } from '../../services/assetLibraryService';

import CalendarGrid from '../../calendar/components/CalendarGrid';
import CalendarListView from '../../calendar/components/CalendarListView';
import UnscheduledRail from '../../calendar/components/UnscheduledRail';
import PostDetailDrawer from '../../calendar/components/PostDetailDrawer';
import ScheduleModal from '../../calendar/components/ScheduleModal';
import QuickPostComposer from '../../calendar/components/QuickPostComposer';
import CalendarCommandBar from '../../calendar/components/CalendarCommandBar';
import CellCommandPalette from '../../calendar/components/CellCommandPalette';
import IntelligenceStrip from '../../calendar/components/IntelligenceStrip';
import ToastStack, { TOAST_ICONS, useToastStack } from '../../calendar/components/ToastStack';

import '../../styles/CalendarEngine.css';

const MOBILE_VIEW_BREAKPOINT = 600;

export default function PersonalCalendarPage() {
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
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted || !user?.id) return;
      setUserId(user.id);
      fetchUserSettings(user.id).then((settings) => {
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

  const { brandKit } = useBrandKitStore();

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

  // ── Selected group (drives PostDetailDrawer) ──────────────────────────────
  const allGroups = useMemo(() => [...groups, ...draftGroups], [groups, draftGroups]);
  const selectedGroup = useMemo(
    () => allGroups.find((g) => g.posts.some((p) => p.id === selectedPostId)) || null,
    [allGroups, selectedPostId],
  );

  // ── ⌘K / Quick Post / Schedule modal local UI state ───────────────────────
  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [cmdBarPreset, setCmdBarPreset] = useState('');
  const [quickPostOpen, setQuickPostOpen] = useState(false);
  const [scheduleModalPost, setScheduleModalPost] = useState(null);
  const [cellPalette, setCellPalette] = useState(null); // { dayKey, label }

  // ── Schedule hand-off from the Library (LIBRARY_SPEC.md §7) ───────────────
  // Additive, optional: Library's "Schedule" action navigates here with
  // ?quickPost=1&prefillAssetId=<id>. useMutableSearchParams is the existing,
  // already-proven idiom this codebase uses for exactly this kind of
  // cross-page deep-link (src/org/pages/OrgAssetLibrary.jsx's own
  // ?assetId=/?search= handling is the direct precedent). Absent params =
  // today's exact behavior (libraryAssets stays empty, no prefill). See
  // DECISIONS_LOG.md 2026-06-25T10:35:00 for why this replaced an earlier,
  // wrong-for-this-stack "location.state" draft of the same idea.
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const [prefillAsset, setPrefillAsset] = useState(null);

  useEffect(() => {
    // Phase 4 QA fix (schedule hand-off composer race — see
    // DECISIONS_LOG.md, QA_PERSONA_REVIEW_build.md Flow 3). Root cause:
    // this effect used to gate `setQuickPostOpen(true)` BEHIND the async
    // `fetchAssetForHandoff` await, inside the same IIFE whose own
    // `mounted` flag is closed over and could be raced by the synchronous
    // `setSearchParams(...)` call right below it (a real router.replace())
    // doing its own re-render pass before the async work resolved — live-
    // reproduced as a several-second delay before the composer became
    // queryable in the DOM, worst-cased by dev-mode Fast Refresh activity.
    // Fix: capture both params into local consts FIRST (so nothing later
    // depends on `searchParams` — a value tied to the *current* URL —
    // still reflecting the hand-off params once they're about to be
    // stripped), then call `setQuickPostOpen(true)` SYNCHRONOUSLY, in the
    // same tick as the effect itself, before either the async asset fetch
    // or the param-cleanup's router.replace() run. The composer now always
    // opens immediately, with no asset selected yet; `prefillAsset` is
    // then populated asynchronously into the now-already-open composer
    // the moment the fetch resolves. QuickPostComposer.jsx needed a
    // companion fix for this to actually work — see its own comment —
    // since it previously only ever read `prefillAsset` once, via a
    // `useState` initializer, and had no way to pick up a value arriving
    // after its own first render. This removes the dependency on the
    // IIFE's `mounted` flag entirely for
    // the open action — only the (optional, best-effort) asset-prefill
    // still checks `mounted`, exactly as before, since setting state on
    // an unmounted component after a slow fetch is the actual problem a
    // `mounted` guard exists for, not opening the composer itself.
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
          console.error('[PersonalCalendarPage] Could not load hand-off asset:', err);
        });
    }

    // Clear the query params once consumed so a refresh/back-nav doesn't
    // re-trigger the hand-off or re-open Quick Post unexpectedly. This now
    // runs after the composer is already guaranteed open, so even if this
    // triggers a re-render/navigation pass, there is no open-state left
    // to lose — setQuickPostOpen(true) already committed above.
    setSearchParams((params) => {
      params.delete('quickPost');
      params.delete('prefillAssetId');
      return params;
    }, { replace: true });

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Note: optimal-slot AI suggestions (getSlotSuggestions) are NOT wired into
  // this page — the approved mockup's Month/List views and cell palette don't
  // render an "AI recommended slot" callout anywhere (that's WeekGrid's
  // hour-cell-specific affordance, and Week view is explicitly Phase 2 per
  // CALENDAR_SPEC.md §11, out of this packet's scope). Calling the edge
  // function with no UI consumer would be speculative dead code.

  // ── Lookup helpers ─────────────────────────────────────────────────────────
  const findGroupByKey = useCallback((groupKey) => allGroups.find((g) => g.groupKey === groupKey) || null, [allGroups]);
  const isLockedGroup = useCallback((group) => group.posts.every((p) => isLockedForReschedule(p.status)), []);

  // ── The single commit path every reschedule mode (drag / move-mode /
  //    drawer-via-ScheduleModal) funnels through — calls useScheduleAction()
  //    for every post in the group, handling conflict/stale-write per spec §5.
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

  // ── Reschedule mode 1: drag-and-drop. CalendarGrid's day cells handle the
  //    native HTML5 drop event and call onCommitMove(groupKey, dayKey) — the
  //    same native-HTML5-drag mechanism the approved mockup demonstrates
  //    (mockup.js's dragstart/dragover/drop handlers), which is sufficient to
  //    satisfy desktop pointer drag end-to-end. Touch-drag parity is carried
  //    by HTML5 DnD's own touch support in modern mobile browsers; the
  //    REQUIRED non-drag accessibility path (RESEARCH.md §2.2, WCAG 2.2 SC
  //    2.5.7) is reschedule mode 3 (tap-to-select -> tap-destination) below,
  //    not a re-implementation of @dnd-kit's PointerSensor/TouchSensor for
  //    this grid — @dnd-kit remains a real, available dependency but this
  //    packet's Month-grid drag path matches the approved mockup's own
  //    chosen mechanism exactly, per the "build exactly what the mockup
  //    shows" instruction. (Drag-active visual state — `.is-dragging` — is
  //    tracked locally inside CalendarGrid.jsx/UnscheduledRail.jsx, not here,
  //    since this page wrapper holds no business/UI-rendering logic itself.)
  const handleCommitMove = useCallback(async (groupKeyOrDraftToken, dayKey) => {
    const hour = 9; // default time-of-day for a day-level (non-hour-aware) Month-view drop
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

  // ── Reschedule mode 3: tap-to-select -> tap-destination ───────────────────
  const handleMoveTrigger = useCallback((groupOrDraft) => {
    const groupKey = groupOrDraft.groupKey || `post:${groupOrDraft.id}`;
    if (moveMode.active && moveMode.groupKey === groupKey) {
      exitMoveMode();
      return;
    }
    enterMoveMode(groupKey);
  }, [moveMode, enterMoveMode, exitMoveMode]);

  // moveMode in the store only stores postId per its current shape; widen
  // locally to also remember the groupKey for the commit path above.
  const moveModeWithGroupKey = useMemo(() => ({ active: moveMode.active, groupKey: moveMode.postId }), [moveMode]);

  const handleMoveCommit = useCallback(async (groupKey, dayKey) => {
    exitMoveMode();
    await handleCommitMove(groupKey, dayKey);
  }, [exitMoveMode, handleCommitMove]);

  // ── Reschedule mode 2: full detail-panel edit -> opens ScheduleModal ──────
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

  // ── Drawer actions ─────────────────────────────────────────────────────────
  // PostDetailDrawer's "Save changes" edits caption/hashtags/account
  // reassignment (and, incidentally, scheduled_at if the user also touched
  // the inline date/time fields) all in one write — this is a content edit,
  // not a schedule/reschedule/unschedule *action* in the spec §5/§6 sense
  // (no conflict check or lock-on-reschedule semantics apply to a caption
  // edit), so it goes straight through calendarService.updatePost() rather
  // than through useScheduleAction()'s schedule-specific helpers.
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

  const handleDeletePost = useCallback(async (post) => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      await deletePost(scope, post.id);
      setSelectedPostId(null);
      refetch();
      refetchDrafts();
      toast.success('Post deleted');
    } catch (err) {
      toast.error(err?.message || 'Failed to delete post');
    }
  }, [scope, refetch, refetchDrafts, setSelectedPostId]);

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
        status: 'draft', scheduled_at: null,
      });
      refetchDrafts();
      toast.success('Duplicated to a new draft');
    } catch (err) {
      // QA_PERSONA_REVIEW_build.md (2026-06-25 re-test, finding #4): when
      // the source post's asset (generation_id) already has a sibling
      // draft for this account, the duplicate's insert hits the real,
      // intentional idx_posts_unique_draft_per_generation_account unique
      // index (RESEARCH.md §3.1 — one draft per (user_id, generation_id,
      // account) while status='draft' and generation_id IS NOT NULL) and
      // Postgres returns a 409 / code 23505. That used to surface here as
      // a raw, unreadable DB error via toast.error(err.message). Catch
      // that specific violation and show an accurate, calm message
      // instead — reusing the same page-level ToastStack/tone-danger
      // mechanism Quick Post's failure case already uses, rather than
      // react-hot-toast's plain `toast.error`, so this hard-failure case
      // reads consistently with the other "real save failure" surface in
      // this file. Not silently working around the constraint (e.g. not
      // auto-deduping or stripping generation_id) — the constraint is
      // real and intentional; this only changes how the failure is
      // reported.
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

  // ── Create-draft-for-day (the cal3-month-cell__add "+" button) ────────────
  const handleCreateDraftForDay = useCallback(async (dayKey) => {
    try {
      const scheduledAt = new Date(`${dayKey}T12:00:00.000Z`).toISOString();
      await createPost(scope, { scheduled_at: scheduledAt, status: 'draft', caption: '' });
      refetchDrafts();
      toast.success('Draft created — edit it in the drawer');
    } catch (err) {
      toast.error(err?.message || 'Could not create post');
    }
  }, [scope]);

  // ── Quick Post submit ──────────────────────────────────────────────────────
  // Owns the confirmation/error toast itself (pushed onto the page-level
  // ToastStack, the same shared "must outlive the triggering component"
  // mechanism commitReschedule already uses for the conflict/stale-write
  // toasts) rather than letting QuickPostComposer manage its own toast --
  // ToastStack lives outside `{quickPostOpen && (...)}` so it survives the
  // composer unmounting the instant this resolves. Returns true/false so
  // the composer knows whether to close (success) or stay open with the
  // user's typed captions intact (failure) -- see DECISIONS_LOG.md
  // 2026-06-24 "Bug 1".
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
      console.error('[PersonalCalendarPage] Quick Post submit failed:', err);
      toastStack.push({
        tone: 'danger',
        icon: TOAST_ICONS.danger,
        title: 'Could not save this post',
        desc: err?.message ? `${err.message} — nothing was saved. Your captions are still in the form.` : 'Nothing was saved. Your captions are still in the form.',
      });
      return false;
    }
  }, [scope, refetch, refetchDrafts, toastStack]);

  // ── Cell command palette actions ──────────────────────────────────────────
  const handleCellPaletteAction = useCallback((actionId) => {
    if (!cellPalette) return;
    const { dayKey, label } = cellPalette;
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

  // ── ⌘K command bar apply ───────────────────────────────────────────────────
  const handleCommandApply = useCallback(async (action) => {
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

    setCmdBarOpen(false);
  }, [posts, drafts, allGroups, scope, findGroupByKey, commitReschedule, refetch, refetchDrafts, setSelectedPostId]);

  const cmdBarContext = useMemo(() => ({
    weekStart: `${effectiveMonthStartKey}T00:00:00.000Z`,
    posts, drafts, selectedPostId,
  }), [effectiveMonthStartKey, posts, drafts, selectedPostId]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goPrev = useCallback(() => { setMonthStartKey(addMonthsToDateKey(effectiveMonthStartKey, -1)); }, [effectiveMonthStartKey, setMonthStartKey]);
  const goNext = useCallback(() => { setMonthStartKey(addMonthsToDateKey(effectiveMonthStartKey, 1)); }, [effectiveMonthStartKey, setMonthStartKey]);

  const monthLabel = formatDateKey(effectiveMonthStartKey, { month: 'long', year: 'numeric' });
  const isEmpty = !isLoading && posts.length === 0 && drafts.length === 0;

  return (
    <div className="dashboard-shell">
      <Toaster position="bottom-right" toastOptions={{ style: { fontSize: 13, background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' } }} />
      <UserNavbar />
      <UserSidebar />

        <main className="cal3-shell">
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
                <button type="button" className={`cal3-view-switcher__btn${viewMode === 'month' ? ' is-active' : ''}`} onClick={() => handleViewSwitch('month')}>Month</button>
                <button type="button" className={`cal3-view-switcher__btn${viewMode === 'list' ? ' is-active' : ''}`} onClick={() => handleViewSwitch('list')}>List</button>
              </div>
              <button type="button" className="cal3-btn-ghost" onClick={() => { setCmdBarPreset(''); setCmdBarOpen(true); }}>
                <Sparkles size={13} aria-hidden="true" /> Ask AI <span className="cal3-kbd">⌘K</span>
              </button>
              <button type="button" className="ui-button ui-button-accent ui-button-md" onClick={() => setQuickPostOpen(true)}>+ Quick Post</button>
            </div>
          </header>

          <IntelligenceStrip posts={posts} weekStart={`${effectiveMonthStartKey}T00:00:00.000Z`} />

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

              <UnscheduledRail
                workspaceType="personal"
                drafts={drafts}
                collapsed={draftsRailCollapsed}
                onToggle={toggleDraftsRail}
                onOpenDraft={(draft) => setSelectedPostId(draft.id)}
                onMoveTrigger={handleMoveTrigger}
              />
            </div>
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
              onClose={() => setSelectedPostId(null)}
              onSavePost={handleSavePost}
              onDeletePost={handleDeletePost}
              onReschedule={handleOpenScheduleModal}
              onUnschedule={handleUnschedulePost}
              onDuplicate={handleDuplicatePost}
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
      </main>
    </div>
  );
}
