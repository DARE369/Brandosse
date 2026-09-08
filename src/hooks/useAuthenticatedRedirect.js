// src/hooks/useAuthenticatedRedirect.js
// Sends an already-authenticated visitor from a public page (landing, login,
// register) into the app.
//
// Why this exists as shared logic rather than an effect per page: the session
// is restored ASYNCHRONOUSLY on load, so any public page can be rendered to a
// user who is in fact signed in. Whichever page forgets to handle that strands
// them — which is exactly how "/login showed a form to someone holding a valid
// session" happened.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth, hasStoredAuthSession } from '../Context/AuthContext';
import { useAppNavigation } from '../Context/AppNavigationContext';
import { APP_ROOT_PATH } from '../utils/authRouting';
import { getPendingSignupIntent, SIGNUP_COMPLETION_PATH } from '../services/signupIntentService';

/** No-op: hydration happens once, and the auth context owns every later change. */
const subscribeToStoredSession = () => () => {};

/** Stable primitives — useSyncExternalStore re-renders forever otherwise. */
const getHydratedClientSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

/**
 * @param {object}  options
 * @param {boolean} options.enabled     set false to suspend (e.g. while a
 *                                      login submit does its own navigation)
 * @param {string}  options.fallbackPath where to send them with no stored intent
 * @returns {{ redirecting: boolean }}  true while a redirect is expected —
 *                                      render an overlay instead of the page
 */
export default function useAuthenticatedRedirect(options = {}) {
  const { enabled = true, fallbackPath = APP_ROOT_PATH } = options;

  const { user, loading } = useAuth();
  const { navigate, location } = useAppNavigation();
  const navigatedRef = useRef(false);

  // ── Why nothing may switch trees until after hydration ────────────────────
  //
  // This hook decides whether the caller renders its page or a redirect
  // overlay. That decision must be IDENTICAL on the server and in the client's
  // hydrating render, or React throws
  // "Hydration failed because the server rendered HTML didn't match the client"
  // and discards the server tree.
  //
  // Two separate things made it differ, and fixing only the first left the bug
  // intermittent:
  //
  //   1. `likelySignedIn` was `useMemo(() => hasStoredAuthSession(), [])`,
  //      which reads localStorage DURING RENDER. The server has none, so the
  //      server said "not signed in" and the client said "signed in".
  //
  //   2. `user` arrives from an async session restore. When that resolves
  //      quickly — a warm cache — it can be set BEFORE hydration finishes, so
  //      the client renders the overlay while the server's HTML is the page.
  //      Nothing about (1) prevents this, which is why the error came back
  //      after (1) was fixed and looked random: it is a race with the network.
  //
  // So the gate is hydration itself. `hydrated` is false on the server and in
  // the hydrating render, and true immediately after — the sanctioned use of
  // useSyncExternalStore. Until it flips, this hook always reports "not
  // redirecting", which is exactly what the server rendered.
  //
  // The cost is one frame of public content for a returning user. The previous
  // code traded that away for a hydration mismatch, which forces React to
  // re-render the entire tree on the client anyway — so it paid the flash AND
  // an error AND the doubled work.
  const hydrated = useSyncExternalStore(
    subscribeToStoredSession,
    getHydratedClientSnapshot,
    getHydratedServerSnapshot,
  );

  // Safe to read storage directly now: this is only ever true on the client,
  // after hydration has committed.
  const likelySignedIn = hydrated && hasStoredAuthSession();

  useEffect(() => {
    if (!enabled || loading || !user || navigatedRef.current) return;

    navigatedRef.current = true;

    const fromState = location?.state?.from;
    const fromPath = fromState
      ? `${fromState.pathname || ''}${fromState.search || ''}${fromState.hash || ''}`
      : null;

    let storedPath = null;
    try {
      storedPath = window.sessionStorage?.getItem('socialai-redirect-after-login') || null;
    } catch {
      storedPath = null;
    }

    const pendingSignup = getPendingSignupIntent() ? SIGNUP_COMPLETION_PATH : null;
    navigate(fromPath || storedPath || pendingSignup || fallbackPath, { replace: true });
  }, [enabled, loading, user, navigate, location, fallbackPath]);

  return {
    // Cover both the resolved case (user known) and the pre-resolution case
    // (a token exists, auth still loading) so the overlay shows from the very
    // first paint rather than appearing after a flash of the public page.
    redirecting: enabled && hydrated && (Boolean(user) || (likelySignedIn && loading)),
  };
}
