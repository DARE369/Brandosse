"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthLoadingOverlay from '../../components/Shared/AuthLoadingOverlay';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { supabase } from '../../services/supabaseClient';
import {
  acceptOrganizationInvitation,
  completeOrganizationInvitationSignup,
  previewOrganizationInvitation,
} from '../../org/services/orgService';
function getStateCopy(invitationState) {
  switch (invitationState) {
    case 'accepted':
      return {
        title: 'Invitation already completed',
        description: 'This workspace invitation has already been accepted.',
      };
    case 'revoked':
      return {
        title: 'Invitation has been revoked',
        description: 'Ask the platform team to send you a fresh invitation.',
      };
    case 'expired':
      return {
        title: 'Invitation has expired',
        description: 'This invite is no longer active. Ask the platform team to resend it.',
      };
    default:
      return {
        title: 'Join this workspace',
        description: 'Use this onboarding link to enter the shared workspace.',
      };
  }
}

export default function InvitationAcceptPage() {
  const { navigate } = useAppNavigation();
  const searchParams = useSearchParams();
  const {
    user,
    loading,
    accessLoading,
    refreshAccess,
    signOut,
  } = useAuth();
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [autoAcceptAttempted, setAutoAcceptAttempted] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const token = searchParams.get('token') || '';

  useEffect(() => {
    if (!token) return;
    sessionStorage.setItem('socialai-pending-org-invite-token', token);
    if (!user) {
      sessionStorage.setItem('socialai-redirect-after-login', `/join?token=${token}`);
    }
  }, [token, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!token) return;

      setPreviewLoading(true);
      setError('');
      setAutoAcceptAttempted(false);

      try {
        const data = await previewOrganizationInvitation(token);
        if (!cancelled) {
          setPreview(data);
        }
      } catch (previewError) {
        if (!cancelled) {
          setError(previewError?.message || 'Unable to verify invitation.');
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    if (!loading && !accessLoading) {
      void loadPreview();
    }

    return () => {
      cancelled = true;
    };
  }, [accessLoading, loading, token, user?.id]);

  const acceptInviteAndRedirect = async () => {
    const result = await acceptOrganizationInvitation(token);
    sessionStorage.removeItem('socialai-pending-org-invite-token');
    sessionStorage.removeItem('socialai-redirect-after-login');
    await refreshAccess();
    navigate(result?.redirect_to || `/app/org/${result.organization_id}/workspace`, { replace: true });
  };

  const completeAcceptance = async () => {
    setSubmitting(true);
    setError('');

    try {
      await acceptInviteAndRedirect();
    } catch (acceptError) {
      setError(acceptError?.message || 'Unable to accept invitation.');
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!user?.id || !preview || previewLoading || submitting || autoAcceptAttempted) return;
    if (!preview.can_accept || preview.requires_password_setup) return;

    setAutoAcceptAttempted(true);
    void completeAcceptance();
  }, [autoAcceptAttempted, preview, previewLoading, submitting, user?.id]);

  const statusCopy = useMemo(
    () => getStateCopy(preview?.invitation_state),
    [preview?.invitation_state],
  );

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    if (password.length < 10) {
      setError('Choose a password with at least 10 characters.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('The password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const signupResult = await completeOrganizationInvitationSignup(token, password, passwordConfirm);
      if (signupResult?.account_exists) {
        setSubmitting(false);
        navigate('/login', {
          replace: true,
          state: {
            message: `An account already exists for ${signupResult.email}. Sign in to continue with this invitation.`,
            prefillEmail: signupResult.email,
          },
        });
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: signupResult.email,
        password,
      });

      if (signInError) throw signInError;

      await refreshAccess();
      await acceptInviteAndRedirect();
    } catch (submitError) {
      setError(submitError?.message || 'Unable to finish onboarding.');
      setSubmitting(false);
    }
  };

  if (loading || accessLoading) {
    return (
      <AuthLoadingOverlay
        title="Checking invitation access"
        description="Verifying your session before joining the workspace."
      />
    );
  }

  if (!token) {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <h1>Invitation link is incomplete</h1>
          <p>This join link does not include a valid token.</p>
        </section>
      </main>
    );
  }

  if (previewLoading || (submitting && !preview?.requires_password_setup)) {
    return (
      <AuthLoadingOverlay
        title="Joining workspace"
        description="Preparing your organization workspace."
      />
    );
  }

  if (error) {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <span className="invitation-accept-kicker">Workspace Invitation</span>
          <h1>Could not complete invitation</h1>
          <p>{error}</p>
          {!user && preview?.email ? (
            <div className="invitation-accept-actions">
              <button
                type="button"
                className="auth-submit"
                onClick={() => navigate('/login', {
                  state: {
                    message: `Sign in with ${preview.email} to continue with this invitation.`,
                    prefillEmail: preview.email,
                  },
                })}
              >
                Sign in
              </button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <span className="invitation-accept-kicker">Workspace Invitation</span>
          <h1>Unable to load invitation</h1>
          <p>Try opening the invitation link again from the members page.</p>
        </section>
      </main>
    );
  }

  if (preview.invitation_state !== 'pending') {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <span className="invitation-accept-kicker">{preview.organization_name || 'Organization'}</span>
          <h1>{statusCopy.title}</h1>
          <p>{statusCopy.description}</p>
        </section>
      </main>
    );
  }

  if (user && preview.email_matches_session === false) {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <span className="invitation-accept-kicker">{preview.organization_name || 'Organization'}</span>
          <h1>Signed in with the wrong account</h1>
          <p>This invitation is for <strong>{preview.email}</strong>. Sign out, then continue with that account.</p>
          <div className="invitation-accept-actions">
            <button type="button" className="auth-submit" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!user && !preview.requires_password_setup) {
    return (
      <main className="invitation-accept-page">
        <section className="invitation-accept-card">
          <span className="invitation-accept-kicker">{preview.organization_name || 'Organization'}</span>
          <h1>{statusCopy.title}</h1>
          <p>Sign in with <strong>{preview.email}</strong> to accept this invitation as {String(preview.role || 'member').replace(/_/g, ' ')}.</p>

          <div className="invitation-accept-details">
            <div>
              <span>Email</span>
              <strong>{preview.email}</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>{String(preview.role || 'member').replace(/_/g, ' ')}</strong>
            </div>
          </div>

          <div className="invitation-accept-actions">
            <button
              type="button"
              className="auth-submit"
              onClick={() => navigate('/login', {
                state: {
                  message: `Sign in with ${preview.email} to continue with this invitation.`,
                  prefillEmail: preview.email,
                },
              })}
            >
              Sign in
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!preview.requires_password_setup) {
    return (
      <AuthLoadingOverlay
        title="Joining workspace"
        description={`Connecting you to ${preview.organization_name || 'your organization'} now.`}
      />
    );
  }

  return (
    <main className="invitation-accept-page">
      <section className="invitation-accept-card">
        <span className="invitation-accept-kicker">{preview.organization_name || 'Organization'}</span>
        <h1>Complete onboarding</h1>
        <p>Create your password to finish joining the workspace as {String(preview.role || 'member').replace(/_/g, ' ')}.</p>

        <div className="invitation-accept-details">
          <div>
            <span>Email</span>
            <strong>{preview.email}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>{String(preview.role || 'member').replace(/_/g, ' ')}</strong>
          </div>
        </div>

        <form className="invitation-accept-form" onSubmit={handlePasswordSubmit}>
          <label className="invitation-accept-field">
            <span>New password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={submitting}
            />
          </label>

          <label className="invitation-accept-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              autoComplete="new-password"
              required
              disabled={submitting}
            />
          </label>

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Finishing setup...' : 'Set password and continue'}
          </button>
        </form>
      </section>
    </main>
  );
}
