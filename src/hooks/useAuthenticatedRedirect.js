// src/hooks/useAuthenticatedRedirect.js
// Sends an already-authenticated visitor from a public page (landing, login,
// register) into the app.
//
// Why this exists as shared logic rather than an effect per page: the session
// is restored ASYNCHRONOUSLY on load, so any public page can be rendered to a
// user who is in fact signed in. Whichever page forgets to handle that strands
// them — which is exactly how "/login showed a form to someone holding a valid
// session" happened.
import { useEffect, useMemo, useRef } from 'react';
import { useAuth, hasStoredAuthSession } from '../Context/AuthContext';
import { useAppNavigation } from '../Context/AppNavigationContext';
import { APP_ROOT_PATH } from '../utils/authRouting';
import { getPendingSignupIntent, SIGNUP_COMPLETION_PATH } from '../services/signupIntentService';

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

  // Checked once, on first render: localStorage is synchronous, so this is
  // known before the async restore finishes and lets the caller avoid a flash
  // of public content for someone who is about to be redirected.
  const likelySignedIn = useMemo(() => hasStoredAuthSession(), []);

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
    redirecting: enabled && (Boolean(user) || (likelySignedIn && loading)),
  };
}
