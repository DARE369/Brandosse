// src/hooks/usePersistentState.js
// Drop-in replacement for useState that survives reloads, namespaced per user.
//
// Use for UI preferences and form/setting values that are painful to lose on
// reload. Do NOT use for ephemeral UI state (modal open, loading flags) —
// restoring "modal was open" on reload is worse than resetting it.
//
// In-progress work that should follow the user across devices belongs in the
// DB instead (sessions.metadata.draft_*), not here.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDebouncedPrefWriter,
  readPref,
  writePref,
} from '../services/persistentPrefs';

const debouncedWrite = createDebouncedPrefWriter();

/**
 * @param {string} scope   stable key for this value, e.g. 'studio.prompt'
 * @param {*}      initial default when nothing is stored
 * @param {object} options
 * @param {string|null} options.userId  namespace owner; null = 'anon'
 * @param {boolean}     options.enabled set false to disable persistence
 *                                      (e.g. before the user id is known)
 * @param {boolean}     options.immediate write synchronously instead of
 *                                      debounced — for low-frequency values
 */
export default function usePersistentState(scope, initial, options = {}) {
  const { userId = null, enabled = true, immediate = false } = options;

  // Read synchronously on first render so there is no flash of the default
  // value before an effect restores the real one.
  const [value, setValue] = useState(() => (
    enabled ? readPref(scope, userId, initial) : initial
  ));

  // Skip the very first write-back: it would just re-persist what we only
  // just read, and would clobber stored state with `initial` when persistence
  // is still disabled (userId not resolved yet).
  const hydratedForRef = useRef(enabled ? `${userId || 'anon'}:${scope}` : null);

  // When the user id resolves (or changes — account switch on one browser),
  // re-read under the new namespace rather than leaking the previous user's
  // value into their session.
  useEffect(() => {
    if (!enabled) return;

    const identity = `${userId || 'anon'}:${scope}`;
    if (hydratedForRef.current === identity) return;

    hydratedForRef.current = identity;
    setValue(readPref(scope, userId, initial));
    // `initial` is intentionally not a dependency: callers commonly pass an
    // inline literal/object, which would re-fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, userId]);

  useEffect(() => {
    if (!enabled) return;
    if (hydratedForRef.current !== `${userId || 'anon'}:${scope}`) return;

    if (immediate) writePref(scope, userId, value);
    else debouncedWrite(scope, userId, value);
  }, [enabled, immediate, scope, userId, value]);

  const reset = useCallback(() => {
    setValue(initial);
    writePref(scope, userId, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId]);

  return [value, setValue, reset];
}

// Commit any debounced writes still in flight.
export function flushPersistentState() {
  debouncedWrite.flush();
}
