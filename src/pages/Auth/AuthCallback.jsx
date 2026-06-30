"use client";

// src/pages/Auth/AuthCallback.jsx
// Route: /auth/callback
// Supabase redirects here after Google OAuth completes.

import React, { useEffect, useState } from 'react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { supabase } from '../../services/supabaseClient';
import { APP_ROOT_PATH, resolveRole } from '../../utils/authRouting';
import { getPendingSignupIntent, SIGNUP_COMPLETION_PATH } from '../../services/signupIntentService';
export default function AuthCallback() {
  const { navigate } = useAppNavigation();
  const [status, setStatus] = useState('Completing sign-in...');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      try {
        // Check for OAuth errors returned in the URL hash.
        const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
        const oauthError = hashParams.get('error_description');
        if (oauthError) {
          throw new Error(decodeURIComponent(oauthError));
        }

        const callbackType = String(
          hashParams.get('type')
          || new URLSearchParams(window.location.search).get('type')
          || '',
        ).trim().toLowerCase();

        // Supabase v2 exchanges code/hash for a session; getSession triggers it.
        let {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        // If session is not ready immediately, retry once.
        if (!session) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const retry = await supabase.auth.getSession();
          if (retry.error) throw retry.error;
          session = retry.data.session;
        }

        if (!session) {
          throw new Error('Authentication timed out. Please try again.');
        }

        if (callbackType === 'recovery') {
          navigate('/reset-password', { replace: true });
          return;
        }

        if (cancelled) return;

        const user = session.user;
        setStatus('Setting up your workspace...');

        // Only check whether profile row exists. Avoid selecting optional columns
        // that may not exist in all environments.
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.error('[AuthCallback] profile check failed:', profileError.message);
          if (!cancelled) navigate(APP_ROOT_PATH, { replace: true });
          return;
        }

        // Create profile for first-time users.
        if (!profile) {
          const inferredRole =
            resolveRole({
              metadataRole: [
                user?.app_metadata?.role ?? user?.app_metadata?.roles ?? null,
                user?.user_metadata?.role ?? user?.user_metadata?.roles ?? null,
              ],
              metadataIsAdmin: [
                user?.app_metadata?.is_admin ?? user?.app_metadata?.isAdmin ?? null,
                user?.user_metadata?.is_admin ?? user?.user_metadata?.isAdmin ?? null,
              ],
            }) ?? 'user';

          const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split('@')[0] ||
            'New User';

          // Upsert keeps callback idempotent across retries/race conditions.
          const { error: upsertError } = await supabase
            .from('profiles')
            .upsert(
              {
                id: user.id,
                full_name: fullName,
                email: user.email,
                role: inferredRole,
                credits: 100,
                status: 'active',
              },
              { onConflict: 'id' },
            );

          if (upsertError) {
            console.error('[AuthCallback] profile upsert failed:', upsertError.message);
          } else {
            console.info(`[ProfileProvisioning][oauth-callback] upsert succeeded for user ${user.id}`);
          }
        }

        if (cancelled) return;

        if (getPendingSignupIntent()) {
          navigate(SIGNUP_COMPLETION_PATH, { replace: true });
          return;
        }

        navigate(APP_ROOT_PATH, { replace: true });
      } catch (err) {
        console.error('[AuthCallback]', err);
        if (!cancelled) {
          setError(err?.message || 'Sign-in failed. Please try again.');
        }
      }
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="acb-root">
      <div className="acb-glow" />
      <div className="acb-card">
        <div className="acb-logo">
          <svg width="26" height="26" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <path d="M11 2L20 7V15L11 20L2 15V7L11 2Z" fill="url(#acbg)" />
            <circle cx="11" cy="11" r="3" fill="white" opacity="0.9" />
            <defs>
              <linearGradient id="acbg" x1="2" y1="2" x2="20" y2="20">
                <stop stopColor="var(--public-accent-light)" />
                <stop offset="1" stopColor="var(--public-accent)" />
              </linearGradient>
            </defs>
          </svg>
          <span>SocialAI</span>
        </div>

        {error ? (
          <div className="acb-error">
            <div className="acb-error-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 7v6M12 16.5v.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2>Sign-in failed</h2>
            <p>{error}</p>
            <a href="/login" className="acb-retry">
              Try again
            </a>
          </div>
        ) : (
          <div className="acb-loading">
            <div className="acb-spinner">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                <circle cx="22" cy="22" r="18" stroke="var(--public-primary-glow)" strokeWidth="3" />
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  stroke="url(#sg)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="66 46"
                />
                <defs>
                  <linearGradient id="sg" x1="0" y1="0" x2="44" y2="44">
                    <stop stopColor="var(--public-accent-light)" />
                    <stop offset="1" stopColor="var(--public-accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <p className="acb-status">{status}</p>
            <p className="acb-hint">You'll be redirected automatically.</p>
          </div>
        )}
      </div>
    </div>
  );
}
