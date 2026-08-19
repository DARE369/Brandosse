// src/services/persistentPrefs.js
// Shared, namespaced localStorage persistence for UI preferences and settings.
//
// Replaces the three inconsistent patterns that grew up across the app:
//   - src/admin/hooks/useLocalPersist.js (admin only, unnamespaced)
//   - ad-hoc localStorage in calendarUiStore / LibraryPage / ThemeContext /
//     UserSidebar (each with its own key format and no versioning)
//   - nothing at all (Studio, which lost everything on reload)
//
// Three things the ad-hoc versions all lacked and this provides:
//   1. Per-user namespacing — two accounts on one browser must not inherit
//      each other's settings. Keys carry the user id.
//   2. A schema version — a stored shape that no longer matches is ignored
//      rather than crashing or silently feeding stale junk into state.
//   3. Debounced writes — persisting on every keystroke thrashes localStorage,
//      which is synchronous and blocks the main thread.
//
// This is for PREFERENCES (device-local, instant, survives reload/close).
// In-progress work that should follow the user across devices belongs in the
// DB instead — see sessions.metadata.draft_* (SessionStore.saveDraftPrompt).
//
// One deliberate exception: the Studio temporary draft (scope 'studio.draft').
// Before a generation runs there is no session row to attach a draft to, and
// creating one just to hold it is the junk-session problem we removed. So
// pre-session composing is device-local here, and is migrated onto the session
// row by SessionStore.adoptTempDraftIntoSession the moment a session is born.

const NAMESPACE = 'socialai';
const SCHEMA_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 400;

function isBrowser() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

/**
 * Namespaced key: socialai:v1:<userId|anon>:<scope>
 * The user segment is what keeps two accounts on one browser isolated.
 */
export function buildPrefKey(scope, userId) {
  return `${NAMESPACE}:v${SCHEMA_VERSION}:${userId || 'anon'}:${scope}`;
}

export function readPref(scope, userId, fallback = null) {
  if (!isBrowser()) return fallback;

  try {
    const raw = window.localStorage.getItem(buildPrefKey(scope, userId));
    if (raw === null) return fallback;

    const parsed = JSON.parse(raw);
    // Anything not written by this module (or written by an older schema) is
    // treated as absent rather than trusted — a migration can be added here
    // later if a shape change ever needs to preserve existing values.
    if (!parsed || typeof parsed !== 'object' || parsed.v !== SCHEMA_VERSION) {
      return fallback;
    }
    return parsed.value === undefined ? fallback : parsed.value;
  } catch {
    // Unparseable, or storage blocked (private mode / restricted browser).
    return fallback;
  }
}

export function writePref(scope, userId, value) {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(
      buildPrefKey(scope, userId),
      JSON.stringify({ v: SCHEMA_VERSION, value, at: Date.now() }),
    );
  } catch {
    // Quota exceeded or storage unavailable — preferences are best-effort and
    // must never break the feature they belong to.
  }
}

export function clearPref(scope, userId) {
  if (!isBrowser()) return;

  try {
    window.localStorage.removeItem(buildPrefKey(scope, userId));
  } catch {
    // best-effort
  }
}

/**
 * Debounced writer shared across scopes. Returns a function with the same
 * signature as writePref; repeated calls for the same key collapse into one
 * write after `delayMs` of quiet.
 */
export function createDebouncedPrefWriter(delayMs = DEFAULT_DEBOUNCE_MS) {
  // key -> { timerId, scope, userId, value } so a flush can COMMIT what is
  // still pending. Tracking only timer ids would make flush() silently discard
  // the very writes it exists to protect.
  const pending = new Map();

  const write = (scope, userId, value) => {
    if (!isBrowser()) return;

    const key = buildPrefKey(scope, userId);
    const existing = pending.get(key);
    if (existing) window.clearTimeout(existing.timerId);

    const timerId = window.setTimeout(() => {
      pending.delete(key);
      writePref(scope, userId, value);
    }, delayMs);

    pending.set(key, { timerId, scope, userId, value });
  };

  // Commit every pending write immediately — for when the caller knows the
  // value must not be lost (navigating away, signing out).
  write.flush = () => {
    if (!isBrowser()) return;

    pending.forEach((entry) => {
      window.clearTimeout(entry.timerId);
      writePref(entry.scope, entry.userId, entry.value);
    });
    pending.clear();
  };

  // Drop pending writes instead of committing them — the counterpart to
  // flush(). Needed whenever a value is deliberately cleared: without this a
  // debounced write still in flight lands after the clear and resurrects what
  // was just removed. Omit scope/userId to cancel every pending write.
  write.cancel = (scope, userId) => {
    if (!isBrowser()) return;

    if (scope === undefined) {
      pending.forEach((entry) => window.clearTimeout(entry.timerId));
      pending.clear();
      return;
    }

    const key = buildPrefKey(scope, userId);
    const entry = pending.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timerId);
    pending.delete(key);
  };

  return write;
}
