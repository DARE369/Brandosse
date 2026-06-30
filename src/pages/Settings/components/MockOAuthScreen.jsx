import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';
import {
  connectAccount,
  initiateOAuthConnection,
  updateConnectedAccountDetails,
} from '../../../services/platforms/connectionService';
import AccountConnectionForm from './AccountConnectionForm';

const DEFAULT_PLATFORM_ACCENT = 'var(--color-primary)';

function getInitialFormState(account, platform) {
  return {
    displayName: account?.display_name || account?.account_name || '',
    username: account?.username || '',
    profileType: account?.profile_type || platform?.supported_profile_types?.[0] || 'Business',
    accountCategory: account?.account_category || '',
    profilePictureUrl: account?.profile_picture_url || account?.avatar_url || '',
    followerCount: account?.follower_count || '',
  };
}

export default function MockOAuthScreen({
  open = false,
  platform = null,
  account = null,
  mode = 'connect',
  scope = 'personal',
  organizationId = null,
  brandProjectId = null,
  userId = null,
  onError,
  onClose,
  onSaved,
}) {
  const [step, setStep] = useState(mode === 'edit' ? 'form' : 'intro');
  const [formState, setFormState] = useState(getInitialFormState(account, platform));
  const [submitting, setSubmitting] = useState(false);
  const [savedAccount, setSavedAccount] = useState(null);
  const accent = platform?.brand_color || DEFAULT_PLATFORM_ACCENT;

  useEffect(() => {
    if (!open) return;
    setStep(mode === 'edit' ? 'form' : 'intro');
    setSubmitting(false);
    setSavedAccount(null);
    setFormState(getInitialFormState(account, platform));
  }, [account, mode, open, platform]);

  useEffect(() => {
    if (!savedAccount) return undefined;
    const timeout = window.setTimeout(() => {
      onClose?.();
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [onClose, savedAccount]);

  const title = useMemo(() => {
    if (mode === 'edit') return `Edit ${platform?.display_name || 'account'}`;
    return platform?.mock_login_headline || `Sign in to ${platform?.display_name || 'this platform'}`;
  }, [mode, platform]);

  if (!open || !platform) return null;

  const handleFieldChange = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const handleContinue = async () => {
    if (mode === 'edit') {
      setStep('form');
      return;
    }

    setSubmitting(true);
    try {
      const result = await initiateOAuthConnection({
        userId,
        platform: platform.platform_key,
        scope,
        orgId: organizationId,
        fallbackToMock: false,
      });

      if (!result?.redirecting) {
        setStep('form');
      }
    } catch (error) {
      onError?.(error?.message || 'Could not start platform authorization.');
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const result = mode === 'edit'
        ? await updateConnectedAccountDetails(account.id, formState)
        : await connectAccount({
            userId,
            platform: platform.platform_key,
            scope,
            organizationId,
            brandProjectId,
            formData: formState,
          });

      setSavedAccount(result);
      setStep('success');
      await onSaved?.(result);
    } catch (error) {
      onError?.(error?.message || 'Could not connect this account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="connected-account-oauth-shell" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="connected-account-modal-backdrop" onClick={onClose} aria-label="Close connected account flow" />
      <section className="connected-account-oauth-panel" style={{ '--connected-platform-accent': accent }}>
        <button type="button" className="connected-account-icon-button oauth-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        {step === 'intro' ? (
          <div className="connected-account-oauth-intro">
            <span className="connected-account-oauth-logo">
              <PlatformIcon platform={platform.platform_key} size="lg" />
            </span>
            <h3>{title}</h3>
            <p>{platform.mock_login_description || `Connect your ${platform.display_name} account to SocialAI.`}</p>
            <button type="button" className="connected-account-primary" onClick={handleContinue} disabled={submitting}>
              {submitting ? 'Checking connection...' : `Continue with ${platform.display_name}`}
            </button>
            <small>If live OAuth is not configured, SocialAI will continue in demo mode.</small>
          </div>
        ) : null}

        {step === 'form' ? (
          <AccountConnectionForm
            platform={platform}
            value={formState}
            onChange={handleFieldChange}
            onSubmit={handleSubmit}
            onBack={mode === 'edit' ? onClose : () => setStep('intro')}
            submitting={submitting}
            submitLabel={mode === 'edit' ? 'Save Changes' : 'Connect Account'}
          />
        ) : null}

        {step === 'success' && savedAccount ? (
          <div className="connected-account-oauth-success">
            <CheckCircle2 size={48} />
            <h3>{platform.display_name} connected successfully</h3>
            <p>
              @{savedAccount.username} is now available inside SocialAI.
            </p>
            <button type="button" className="connected-account-secondary" onClick={onClose}>
              Go to Connected Accounts
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
