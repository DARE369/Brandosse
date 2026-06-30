// ============================================================================
// CALENDAR UI STORE — view mode, selected date range, filters. Local UI
// state only, no server data (CALENDAR_SPEC.md §1's stores/calendarUiStore.js).
//
// Matches the plain Zustand `create((set, get) => ({...}))` convention
// already used by every other store in this codebase (CalendarStore.js,
// BrandKitStore.js, SessionStore.js, LibraryStore.js, HelpStore.js) — no new
// state-management pattern introduced, no persist/devtools middleware (none
// of the existing stores use any), per Master Brief §0 rule 5's spirit.
//
// This store deliberately holds NOTHING that came from Supabase — posts,
// drafts, and any other server data live exclusively in
// useCalendarPosts.js/useCalendarDrafts.js's react-query cache. Mixing the
// two would reintroduce the exact "two sources of truth" problem
// CALENDAR_SPEC.md §0 warns about for Org Overview vs. the full Calendar
// page, just inside Personal instead.
// ============================================================================

import { create } from 'zustand';

const CALENDAR_FILTER_PREFS_KEY = 'socialai:calendar-filter-prefs-v1';

const DEFAULT_FILTERS = { platform: 'all', status: 'all' };

function readStoredFilterPrefs() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return JSON.parse(window.localStorage.getItem(CALENDAR_FILTER_PREFS_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeStoredFilterPrefs(remember, filters) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!remember) {
    window.localStorage.removeItem(CALENDAR_FILTER_PREFS_KEY);
    return;
  }
  window.localStorage.setItem(
    CALENDAR_FILTER_PREFS_KEY,
    JSON.stringify({ remember: true, platform: filters.platform, status: filters.status })
  );
}

const storedPrefs = readStoredFilterPrefs();
const initialRememberFilters = Boolean(storedPrefs?.remember);
const initialFilters = initialRememberFilters
  ? { platform: storedPrefs.platform || 'all', status: storedPrefs.status || 'all' }
  : { ...DEFAULT_FILTERS };

const useCalendarUiStore = create((set, get) => ({
  // ── View mode (CALENDAR_SPEC.md §3: month/week/list) ──────────────────────
  viewMode: 'month', // 'month' | 'week' | 'list'
  setViewMode: (mode) => set({ viewMode: mode }),

  // ── Selected date range (the visible week/month window) ───────────────────
  // Stored as 'YYYY-MM-DD' date-key strings (src/utils/timezone.js convention)
  // rather than Date objects, matching the existing CalendarPageV3.jsx
  // pattern of never mixing zone-aware day-bucketing with ambiguous local
  // Date math (AS_IS_AUDIT.md §3.12).
  weekStartKey: null,
  monthStartKey: null,
  setWeekStartKey: (key) => set({ weekStartKey: key }),
  setMonthStartKey: (key) => set({ monthStartKey: key }),

  // ── Filters (platform + status), with the same "remember" persistence
  //    behavior CalendarPageV3.jsx already had ──────────────────────────────
  filters: initialFilters,
  rememberFilters: initialRememberFilters,
  setFilters: (filters) => {
    set({ filters });
    if (get().rememberFilters) writeStoredFilterPrefs(true, filters);
  },
  setRememberFilters: (remember) => {
    set({ rememberFilters: remember });
    writeStoredFilterPrefs(remember, get().filters);
  },
  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    writeStoredFilterPrefs(get().rememberFilters, DEFAULT_FILTERS);
  },

  // ── Drafts/Unscheduled rail collapse state ────────────────────────────────
  draftsRailCollapsed: false,
  setDraftsRailCollapsed: (collapsed) => set({ draftsRailCollapsed: collapsed }),
  toggleDraftsRail: () => set((state) => ({ draftsRailCollapsed: !state.draftsRailCollapsed })),

  // ── Selected post (drives PostDetailDrawer open/closed + which post) ──────
  selectedPostId: null,
  setSelectedPostId: (postId) => set({ selectedPostId: postId }),

  // ── Move-mode (tap-to-select -> tap-destination reschedule, spec §5 /
  //    RESEARCH.md §2's third interaction mode) ─────────────────────────────
  moveMode: { active: false, postId: null },
  enterMoveMode: (postId) => set({ moveMode: { active: true, postId } }),
  exitMoveMode: () => set({ moveMode: { active: false, postId: null } }),

  reset: () => set({
    viewMode: 'month',
    weekStartKey: null,
    monthStartKey: null,
    filters: { ...DEFAULT_FILTERS },
    rememberFilters: false,
    draftsRailCollapsed: false,
    selectedPostId: null,
    moveMode: { active: false, postId: null },
  }),
}));

export default useCalendarUiStore;
