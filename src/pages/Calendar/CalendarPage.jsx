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
import CalendarCommandBar, { CalendarCommandBarInline } from '../../calendar/components/CalendarCommandBar';
import CellCommandPalette from '../../calendar/components/CellCommandPalette';
import IntelligenceStrip from '../../calendar/components/IntelligenceStrip';
import ToastStack, { TOAST_ICONS, useToastStack } from '../../calendar/components/ToastStack';

import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, Avatar, IconButton, MobileNavDrawer,
} from '../../ui-v2';
import '../../calendar/calendar-engine-v2.css';
import styles from './CalendarPage.module.css';

const MOBILE_VIEW_BREAKPOINT = 600;

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/app/dashboard' },
  { key: 'studio', label: 'Studio', href: '/app/generate' },
  { key: 'library', label: 'Library', href: '/app/library' },
  { key: 'calendar', label: 'Calendar', href: '/app/calendar' },
  { key: 'brand-kit', label: 'Brand Kit', href: '/app/settings/brand-kit' },
];

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
      await createPost(scope, { scheduled_at: scheduledAt, status: 'draft', caption: '' });
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
            <Avatar initials={userInitials || 'U'} onClick={() => navigate('/app/profile')} />
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
