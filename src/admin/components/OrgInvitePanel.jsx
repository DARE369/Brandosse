import React, { useEffect, useState } from "react";

async function copyToClipboard(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Nothing to copy.');
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return;
  }

  const helper = document.createElement('textarea');
  helper.value = normalized;
  helper.setAttribute('readonly', 'readonly');
  helper.style.position = 'absolute';
  helper.style.left = '-9999px';
  document.body.appendChild(helper);
  helper.select();
  document.execCommand('copy');
  document.body.removeChild(helper);
}

export default function OrgInvitePanel({
  open,
  organization,
  busy = false,
  onClose,
  onSubmit,
}) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEmail(organization?.ownerEmail || "");
    setResult(null);
    setError('');
  }, [open, organization?.id, organization?.ownerEmail]);

  if (!open || !organization) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const nextResult = await onSubmit?.({
        organizationId: organization.id,
        ownerEmail: email.trim().toLowerCase(),
      });
      setResult(nextResult || null);
    } catch (submitError) {
      setError(submitError?.message || 'Could not create the onboarding link.');
    }
  };

  const normalizedOwnerEmail = String(organization?.ownerEmail || '').trim().toLowerCase();
  const hasEmailChanged = email.trim().toLowerCase() !== normalizedOwnerEmail;
  const currentOnboardingUrl = result?.onboarding_url || (!hasEmailChanged ? organization?.onboardingUrl : '') || '';

  const handleCopyLink = async () => {
    try {
      await copyToClipboard(currentOnboardingUrl);
      setError('');
    } catch (copyError) {
      setError(copyError?.message || 'Could not copy the onboarding link.');
    }
  };

  return (
    <div className="admin-modal-overlay" role="presentation">
      <div className="admin-modal-card" role="dialog" aria-modal="true" aria-labelledby="org-invite-panel-title">
        <div className="admin-modal-header">
          <div>
            <span className="admin-section-kicker">Owner Invitation</span>
            <h3 id="org-invite-panel-title">Owner onboarding link</h3>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            aria-label="Close invite panel"
            onClick={() => !busy && onClose?.()}
          >
            x
          </button>
        </div>

        <form className="admin-modal-body" onSubmit={handleSubmit}>
          <div className="admin-modal-summary">
            <div className="admin-modal-summary-copy">
              <strong>{organization.name}</strong>
              <span>{organization.slug}</span>
              <span>{organization.planKey} plan</span>
            </div>
          </div>

          <label className="create-org-panel__field">
            <span>Owner email</span>
            <input
              className="admin-input admin-input-full"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@company.com"
              required
              disabled={busy}
            />
            <small>You can correct the email here before creating or regenerating the owner onboarding link.</small>
          </label>

          {organization.invitationLastError ? (
            <div className="admin-inline-alert admin-inline-alert-warning">
              <span>Last error: {organization.invitationLastError}</span>
            </div>
          ) : null}

          {currentOnboardingUrl ? (
            <div className="admin-modal-summary">
              <div className="admin-modal-summary-copy">
                <strong>Owner onboarding link</strong>
                <span>Share this link directly with the owner. Each regenerated invite gets a new unique token.</span>
              </div>
              <input
                className="admin-input admin-input-full"
                type="text"
                value={currentOnboardingUrl}
                readOnly
              />
              <button type="button" className="admin-secondary-button" onClick={handleCopyLink} disabled={busy}>
                Copy onboarding link
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="admin-inline-alert admin-inline-alert-warning">
              <span>{error}</span>
            </div>
          ) : null}

          <div className="admin-modal-footer">
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => !busy && onClose?.()}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="admin-primary-button" disabled={busy}>
              {busy ? "Creating..." : (currentOnboardingUrl ? "Regenerate link" : "Create link")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
