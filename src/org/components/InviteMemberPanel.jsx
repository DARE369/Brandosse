import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import OrgSelect from './OrgSelect';
import { UiDrawer } from '../../components/Shared/ui';
import { inviteOrganizationMember, resolveOrgPermissions } from '../services/orgService';
import {
  countEnabledPermissions,
  summarizePermissions,
} from '../constants/permissions';

const FALLBACK_ROLE_OPTIONS = ['contributor', 'editor', 'reviewer', 'org_admin'].map((roleKey) => ({
  value: roleKey,
  label: roleKey.replace(/_/g, ' '),
  description: 'Default org role',
}));

function normalizeRoleOptions(roleTemplates = []) {
  const eligibleTemplates = Array.isArray(roleTemplates)
    ? roleTemplates.filter((role) => role?.role_key !== 'org_owner')
    : [];

  if (eligibleTemplates.length === 0) {
    return FALLBACK_ROLE_OPTIONS;
  }

  return eligibleTemplates.map((role) => ({
    value: role.role_key,
    label: role.display_name || role.role_key.replace(/_/g, ' '),
    description: role.is_system ? 'System role template' : 'Custom role template',
  }));
}

async function copyToClipboard(value, successMessage) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Nothing to copy.');
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return successMessage;
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
  return successMessage;
}

function getInviteResultHeadline(result) {
  switch (result?.delivery_status) {
    case 'failed_provider_error':
      return 'Onboarding link created';
    default:
      return 'Onboarding link ready to share';
  }
}

function getInviteResultCopy(result) {
  switch (result?.delivery_status) {
    case 'failed_provider_error':
      return 'The invite exists and the onboarding link is valid. Email remains optional infrastructure, so share the onboarding link directly.';
    default:
      return 'Share this onboarding link directly from the Members workspace. The member will sign in or set a password from the same link.';
  }
}

export default function InviteMemberPanel({
  open,
  organizationId,
  isAgency = false,
  brandProjects = [],
  roleTemplates = [],
  onClose,
  onInvited,
}) {
  const roleOptions = useMemo(() => normalizeRoleOptions(roleTemplates), [roleTemplates]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roleOptions[0]?.value || 'contributor');
  const [selectedBrandProjects, setSelectedBrandProjects] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  useEffect(() => {
    if (!roleOptions.some((option) => option.value === role)) {
      setRole(roleOptions[0]?.value || 'contributor');
    }
  }, [role, roleOptions]);

  useEffect(() => {
    if (!open) {
      setInviteResult(null);
    }
  }, [open]);

  if (!open) return null;

  const selectedTemplate = roleTemplates.find((template) => template.role_key === role) || null;
  const permissionPreview = resolveOrgPermissions({
    role,
    templatePermissions: selectedTemplate?.permissions,
  });
  const permissionSummary = summarizePermissions(permissionPreview);
  const previewCount = countEnabledPermissions(permissionPreview);
  const allowProjectScoping = isAgency || brandProjects.length > 1;

  const toggleProject = (projectId) => {
    setSelectedBrandProjects((current) => (
      current.includes(projectId)
        ? current.filter((item) => item !== projectId)
        : [...current, projectId]
    ));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setInviteResult(null);

    try {
      const result = await inviteOrganizationMember({
        organization_id: organizationId,
        email,
        role,
        brand_project_ids: allowProjectScoping
          ? (selectedBrandProjects.length > 0 ? selectedBrandProjects : null)
          : null,
        delivery_mode: 'manual_link',
      });

      setInviteResult(result || null);
      onInvited?.(result || null);

      if (result?.delivery_status === 'failed_provider_error') {
        toast.success('Invite link created. Share the onboarding link manually.');
      } else {
        toast.success('Invite link created. Share it with the member to start onboarding.');
      }
    } catch (error) {
      toast.error(error?.message || 'Failed to create invitation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async (value, label) => {
    try {
      const message = await copyToClipboard(value, `${label} copied`);
      toast.success(message);
    } catch (error) {
      toast.error(error?.message || `Could not copy ${label.toLowerCase()}.`);
    }
  };

  return (
    <UiDrawer
      open={open}
      onClose={onClose}
      title="Create Invite Link"
      description="Assign the role template and project scope, then generate a shareable onboarding link."
      className="org-drawer-panel org-invite-drawer"
    >
        <form className="org-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>

          <label>
            <span>Role Template</span>
            <OrgSelect
              value={role}
              options={roleOptions}
              onChange={setRole}
            />
          </label>

          <div className="org-summary-grid compact">
            <article className="org-summary-card">
              <span className="org-modal-kicker">Template</span>
              <strong>{selectedTemplate?.display_name || role.replace(/_/g, ' ')}</strong>
              <p>{selectedTemplate?.is_system ? 'System role template.' : 'Reusable org role template.'}</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Enabled Access</span>
              <strong>{previewCount}</strong>
              <p>Boolean permissions currently enabled for this role.</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Project Scope</span>
              <strong>{allowProjectScoping ? (selectedBrandProjects.length || 'All') : 'All'}</strong>
              <p>{allowProjectScoping ? 'Project access can be narrowed before the invite is created.' : 'All brand projects will be available.'}</p>
            </article>
          </div>

          <div className="org-permission-summary-panel">
            <div className="org-panel-header">
              <div>
                <h3>Permission Preview</h3>
                <p>Member-specific overrides can still be applied later from the Members workspace.</p>
              </div>
            </div>
            <div className="org-permission-summary-list">
              {permissionSummary.length > 0 ? permissionSummary.map((item) => (
                <div key={item} className="org-summary-pill">
                  <span>{item}</span>
                </div>
              )) : (
                <div className="org-empty-inline">This role template currently exposes a minimal permission set.</div>
              )}
            </div>
          </div>

          {allowProjectScoping ? (
            <div className="org-field-group">
              <span>Brand Projects</span>
              <div className="org-chip-grid">
                {brandProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`org-chip ${selectedBrandProjects.includes(project.id) ? 'active' : ''}`.trim()}
                    onClick={() => toggleProject(project.id)}
                  >
                    {project.name}
                  </button>
                ))}
              </div>
              <small className="org-helper-copy">Leave all projects unselected to grant broad access for this role.</small>
            </div>
          ) : null}

          {inviteResult ? (
            <div className="org-invite-result-card" role="status" aria-live="polite">
              <div className="org-invite-result-copy">
                <strong>{getInviteResultHeadline(inviteResult)}</strong>
                <p>{getInviteResultCopy(inviteResult)}</p>
              </div>

              <div className="org-invite-result-actions">
                <button
                  type="button"
                  className="org-text-button"
                  onClick={() => handleCopyLink(inviteResult.onboarding_url, 'Onboarding link')}
                >
                  Copy Onboarding Link
                </button>
              </div>

              <div className="org-invite-result-links">
                <label>
                  <span>Onboarding Link</span>
                  <input type="text" value={inviteResult.onboarding_url || ''} readOnly />
                </label>

                <label>
                  <span>Delivery Status</span>
                  <input type="text" value={inviteResult.delivery_status || 'manual_link_only'} readOnly />
                </label>
              </div>
            </div>
          ) : null}

          <button type="submit" className="org-primary-button" disabled={submitting}>
            {submitting ? 'Creating link...' : 'Create Invite Link'}
          </button>
        </form>
    </UiDrawer>
  );
}
