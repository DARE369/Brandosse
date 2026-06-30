import React, { useEffect, useState } from 'react';
import { createOrganization } from '../services/orgAdminService';
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

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const INITIAL_FORM = {
  name: '',
  slug: '',
  ownerEmail: '',
  planKey: 'organization',
};

export default function CreateOrgPanel({
  isOpen,
  onClose,
  onSuccess,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setForm(INITIAL_FORM);
      setSlugTouched(false);
      setSubmitting(false);
      setError('');
      setResult(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (slugTouched) return;
    setForm((current) => ({
      ...current,
      slug: slugify(current.name),
    }));
  }, [form.name, slugTouched]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) {
        onClose?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, submitting]);

  if (!isOpen) return null;

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setError('');
    if (field === 'slug') {
      setSlugTouched(true);
      setForm((current) => ({ ...current, slug: slugify(value) }));
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const result = await createOrganization({
        name: form.name,
        slug: form.slug,
        ownerEmail: form.ownerEmail,
        planKey: form.planKey,
      });

      setResult(result);
      onSuccess?.(result);
    } catch (submitError) {
      setError(submitError?.message || 'Could not create the organization.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await copyToClipboard(result?.invitation?.onboarding_url || '');
      setError('');
    } catch (copyError) {
      setError(copyError?.message || 'Could not copy the onboarding link.');
    }
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setSlugTouched(false);
    setSubmitting(false);
    setError('');
    setResult(null);
  };

  return (
    <div className="create-org-panel-overlay" role="presentation">
      <button
        type="button"
        className="create-org-panel-backdrop"
        aria-label="Close create organization panel"
        onClick={() => !submitting && onClose?.()}
      />
      <aside className="create-org-panel" role="dialog" aria-modal="true" aria-labelledby="create-org-title">
        <header className="create-org-panel__header">
          <div>
            <span className="admin-section-kicker">Provision Workspace</span>
            <h3 id="create-org-title">Create organization</h3>
            <p>Provision the workspace, generate the owner onboarding link, and bootstrap the default org setup after acceptance.</p>
          </div>
          <button
            type="button"
            className="create-org-panel__close"
            onClick={() => !submitting && onClose?.()}
            aria-label="Close"
          >
            &times;
          </button>
        </header>

        <form className="create-org-panel__body" onSubmit={handleSubmit}>
          <label className="create-org-panel__field">
            <span>Organization name</span>
            <input
              className="admin-input admin-input-full"
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="Acme Studio"
              required
              disabled={submitting}
            />
          </label>

          <label className="create-org-panel__field">
            <span>Workspace slug</span>
            <input
              className="admin-input admin-input-full"
              type="text"
              value={form.slug}
              onChange={handleChange('slug')}
              placeholder="acme-studio"
              required
              disabled={submitting}
            />
            <small>The service will keep this unique if the slug is already taken.</small>
          </label>

          <label className="create-org-panel__field">
            <span>Owner email</span>
            <input
              className="admin-input admin-input-full"
              type="email"
              value={form.ownerEmail}
              onChange={handleChange('ownerEmail')}
              placeholder="owner@company.com"
              required
              disabled={submitting}
            />
            <small>The owner gets a unique onboarding link. Existing users sign in; new users set a password from the same link.</small>
          </label>

          <div className="create-org-panel__field">
            <span>Plan</span>
            <div className="create-org-panel__options">
              <label className={`create-org-panel__option${form.planKey === 'organization' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="planKey"
                  value="organization"
                  checked={form.planKey === 'organization'}
                  onChange={handleChange('planKey')}
                  disabled={submitting}
                />
                <strong>Organization</strong>
                <small>Single-brand team workspace with one shared pipeline and calendar.</small>
              </label>

              <label className={`create-org-panel__option${form.planKey === 'agency' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="planKey"
                  value="agency"
                  checked={form.planKey === 'agency'}
                  onChange={handleChange('planKey')}
                  disabled={submitting}
                />
                <strong>Agency</strong>
                <small>Multi-brand workspace with brand projects available after setup.</small>
              </label>
            </div>
          </div>

          <div className="create-org-panel__summary">
            <strong>What happens next</strong>
            <span>The organization row is created and the owner gets a unique onboarding link to join the workspace or set their password.</span>
          </div>

          {result?.invitation?.onboarding_url ? (
            <div className="create-org-panel__summary">
              <strong>Owner onboarding link is ready</strong>
              <span>Share this link directly with the owner. The link is unique to this invite issuance.</span>
              <input
                className="admin-input admin-input-full"
                type="text"
                readOnly
                value={result.invitation.onboarding_url}
              />
              <div className="create-org-panel__footer">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={handleCopyLink}
                >
                  Copy onboarding link
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="admin-inline-alert admin-inline-alert-warning">
              <span>{error}</span>
            </div>
          ) : null}

          <footer className="create-org-panel__footer">
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => !submitting && onClose?.()}
              disabled={submitting}
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            {result ? (
              <button type="button" className="admin-primary-button" onClick={handleReset}>
                Create another organization
              </button>
            ) : (
              <button type="submit" className="admin-primary-button" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create organization'}
              </button>
            )}
          </footer>
        </form>
      </aside>
    </div>
  );
}
