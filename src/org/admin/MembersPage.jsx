"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Copy, PencilLine, Plus, RotateCcw, Save, Shield, Slash, RefreshCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import OrgSelect from '../components/OrgSelect';
import InviteMemberPanel from '../components/InviteMemberPanel';
import OrgEmptyState from '../components/OrgEmptyState';
import {
  ORG_PERMISSION_GROUPS,
  ORG_ROLE_LABELS,
  countEnabledPermissions,
  summarizePermissions,
} from '../constants/permissions';
import { useOrgContext } from '../hooks/useOrgContext';
import {
  deleteOrganizationInvitation,
  fetchOrganizationInvitations,
  fetchOrganizationMembers,
  fetchOrgRoleTemplates,
  inviteOrganizationMember,
  revokeOrganizationInvitation,
  resolveOrgPermissions,
  updateOrganizationMember,
} from '../services/orgService';
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOverride(permissions, key) {
  return Object.prototype.hasOwnProperty.call(permissions || {}, key);
}

function formatRoleLabel(roleKey, roleTemplates = []) {
  const matchingTemplate = roleTemplates.find((role) => role.role_key === roleKey);
  return matchingTemplate?.display_name || ORG_ROLE_LABELS[roleKey] || roleKey?.replace(/_/g, ' ') || 'Role';
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function formatLastActive(value) {
  if (!value) return 'Inactive';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Inactive';

  const diffMs = Date.now() - parsed.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return formatDate(value);
}

function getInvitationStatusMeta(status) {
  switch (status) {
    case 'accepted':
      return { label: 'Accepted', tone: 'success' };
    case 'expired':
      return { label: 'Expired', tone: 'warning' };
    case 'revoked':
      return { label: 'Revoked', tone: 'neutral' };
    default:
      return { label: 'Pending', tone: 'active' };
  }
}

async function copyInviteLink(value) {
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

function MemberPermissionOverrideRow({
  field,
  roleDefault,
  overrideState,
  disabled = false,
  onChange,
}) {
  return (
    <div className={`org-permission-row ${disabled ? 'disabled' : ''}`}>
      <div className="org-permission-copy">
        <strong>{field.label}</strong>
        <p>
          {field.description}
          <span className="org-permission-meta">Role default: {roleDefault ? 'Allowed' : 'Blocked'}</span>
        </p>
      </div>

      <div className="org-tristate">
        <button type="button" className={overrideState === 'inherit' ? 'active' : ''} onClick={() => onChange('inherit')} disabled={disabled}>
          Inherit
        </button>
        <button type="button" className={overrideState === 'allow' ? 'active' : ''} onClick={() => onChange('allow')} disabled={disabled}>
          Allow
        </button>
        <button type="button" className={overrideState === 'block' ? 'active' : ''} onClick={() => onChange('block')} disabled={disabled}>
          Block
        </button>
      </div>
    </div>
  );
}

function MemberDetailDrawer({
  memberDraft,
  member,
  roleTemplates,
  brandProjects,
  organizationOwnerId,
  isAgency,
  onClose,
  onSave,
  saving,
  onUpdate,
  onResetOverrides,
}) {
  if (!memberDraft || !member) return null;

  const ownerLocked = member.userId === organizationOwnerId || memberDraft.roleKey === 'org_owner';
  const availableRoleOptions = roleTemplates
    .filter((role) => !ownerLocked || role.role_key === memberDraft.roleKey)
    .filter((role) => ownerLocked || role.role_key !== 'org_owner')
    .map((role) => ({
      value: role.role_key,
      label: role.display_name || formatRoleLabel(role.role_key, roleTemplates),
      description: role.is_system ? 'System role' : 'Custom role',
    }));

  const selectedRoleTemplate = roleTemplates.find((role) => role.role_key === memberDraft.roleKey);
  const roleDefaults = resolveOrgPermissions({
    role: memberDraft.roleKey,
    templatePermissions: selectedRoleTemplate?.permissions,
  });
  const effectivePermissions = {
    ...roleDefaults,
    ...(memberDraft.permissions || {}),
  };
  const summary = summarizePermissions(effectivePermissions);

  return (
    <>
      <button type="button" className="org-drawer-backdrop" onClick={onClose} aria-label="Close member details" />
      <aside className="org-drawer-panel org-member-drawer">
        <div className="org-drawer-header">
          <div>
            <h3>{member.profile?.full_name || member.profile?.email || 'Member'}</h3>
            <p>Assign the role, scope project access, and override defaults when needed.</p>
          </div>
          <button type="button" className="org-text-button" onClick={onClose}>Close</button>
        </div>

        <div className="org-member-drawer-body">
          <div className="org-summary-grid compact">
            <article className="org-summary-card">
              <span className="org-modal-kicker">Assigned Role</span>
              <strong>{formatRoleLabel(memberDraft.roleKey, roleTemplates)}</strong>
              <p>{ownerLocked ? 'Locked to the organization owner record.' : 'Used as the base permission template.'}</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Overrides</span>
              <strong>{Object.keys(memberDraft.permissions || {}).length}</strong>
              <p>Member-specific exceptions to the role defaults.</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Effective Access</span>
              <strong>{countEnabledPermissions(effectivePermissions)}</strong>
              <p>Enabled boolean capabilities after overrides are applied.</p>
            </article>
          </div>

          <section className="org-member-section">
            <header className="org-member-section-header">
              <div>
                <h4>Role & Access</h4>
                <p>Start with the role, then narrow project access if this member is not global.</p>
              </div>
            </header>

            {ownerLocked ? (
              <div className="org-empty-inline">The organization owner keeps the owner role. Transfer ownership separately before changing this member.</div>
            ) : (
              <label className="org-field-group">
                <span>Assigned role</span>
                <OrgSelect
                  value={memberDraft.roleKey}
                  options={availableRoleOptions}
                  onChange={(nextValue) => onUpdate((current) => ({
                    ...current,
                    roleKey: nextValue,
                  }))}
                />
              </label>
            )}

            {(isAgency || brandProjects.length > 1) ? (
              <div className="org-field-group">
                <span>Brand project access</span>
                <label className="org-checkbox-row">
                  <input
                    type="checkbox"
                    checked={memberDraft.allBrandProjects}
                    onChange={(event) => onUpdate((current) => ({
                      ...current,
                      allBrandProjects: event.target.checked,
                      brandProjectIds: event.target.checked ? [] : current.brandProjectIds,
                    }))}
                  />
                  <span>All brand projects</span>
                </label>

                {!memberDraft.allBrandProjects ? (
                  <div className="org-project-checklist">
                    {brandProjects.map((project) => {
                      const checked = memberDraft.brandProjectIds.includes(project.id);
                      return (
                        <label key={project.id} className="org-checkbox-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onUpdate((current) => {
                              const nextIds = checked
                                ? current.brandProjectIds.filter((id) => id !== project.id)
                                : [...current.brandProjectIds, project.id];

                              return {
                                ...current,
                                brandProjectIds: nextIds,
                              };
                            })}
                          />
                          <span>{project.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="org-member-section">
            <header className="org-member-section-header">
              <div>
                <h4>Permission Overrides</h4>
                <p>Leave settings on inherit unless this member truly needs an exception.</p>
              </div>
              <button type="button" className="org-text-button" onClick={onResetOverrides}>
                <RotateCcw size={14} />
                Reset to Role Defaults
              </button>
            </header>

            <div className="org-permission-groups">
              {ORG_PERMISSION_GROUPS.map((group) => (
                <section key={group.key} className="org-permission-group">
                  <header className="org-permission-group-header">
                    <div>
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                  </header>

                  <div className="org-permission-group-body">
                    {group.fields.map((field) => {
                      if (field.type === 'number') {
                        const usingRoleDefault = !hasOverride(memberDraft.permissions, field.key);
                        return (
                          <div key={field.key} className="org-permission-row number">
                            <div className="org-permission-copy">
                              <strong>{field.label}</strong>
                              <p>
                                {field.description}
                                <span className="org-permission-meta">
                                  Role default: {roleDefaults[field.key] ?? 'No limit'}
                                </span>
                              </p>
                            </div>
                            <div className="org-number-override">
                              <label className="org-checkbox-row compact">
                                <input
                                  type="checkbox"
                                  checked={!usingRoleDefault}
                                  onChange={(event) => onUpdate((current) => {
                                    const nextPermissions = { ...(current.permissions || {}) };
                                    if (event.target.checked) {
                                      nextPermissions[field.key] = current.permissions?.[field.key]
                                        ?? roleDefaults[field.key]
                                        ?? 0;
                                    } else {
                                      delete nextPermissions[field.key];
                                    }

                                    return {
                                      ...current,
                                      permissions: nextPermissions,
                                    };
                                  })}
                                />
                                <span>Custom limit</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                className="org-permission-number"
                                value={usingRoleDefault ? '' : (memberDraft.permissions?.[field.key] ?? '')}
                                placeholder="Use role default"
                                disabled={usingRoleDefault}
                                onChange={(event) => onUpdate((current) => ({
                                  ...current,
                                  permissions: {
                                    ...current.permissions,
                                    [field.key]: event.target.value === '' ? 0 : Number(event.target.value),
                                  },
                                }))}
                              />
                            </div>
                          </div>
                        );
                      }

                      const overrideState = !hasOverride(memberDraft.permissions, field.key)
                        ? 'inherit'
                        : (memberDraft.permissions[field.key] ? 'allow' : 'block');

                      const dependsOnDisabled = Boolean(field.dependsOn && !effectivePermissions[field.dependsOn]);

                      return (
                        <MemberPermissionOverrideRow
                          key={field.key}
                          field={field}
                          roleDefault={Boolean(roleDefaults[field.key])}
                          overrideState={overrideState}
                          disabled={dependsOnDisabled}
                          onChange={(nextState) => onUpdate((current) => {
                            const nextPermissions = { ...(current.permissions || {}) };
                            if (nextState === 'inherit') {
                              delete nextPermissions[field.key];
                            } else {
                              nextPermissions[field.key] = nextState === 'allow';
                            }

                            const nextEffective = resolveOrgPermissions({
                              role: current.roleKey,
                              templatePermissions: roleTemplates.find((role) => role.role_key === current.roleKey)?.permissions,
                              overrides: nextPermissions,
                            });

                            if (!nextEffective.can_publish) {
                              delete nextPermissions.publish_requires_final_approval;
                            }

                            return {
                              ...current,
                              permissions: nextPermissions,
                            };
                          })}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <aside className="org-permission-summary-panel">
            <div className="org-panel-header">
              <div>
                <h3>Effective Summary</h3>
                <p>What this member can do after overrides are applied.</p>
              </div>
            </div>

            <div className="org-permission-summary-list">
              {summary.length > 0 ? summary.map((item) => (
                <div key={item} className="org-summary-pill">
                  <Shield size={14} />
                  <span>{item}</span>
                </div>
              )) : (
                <div className="org-empty-inline">This member is currently inheriting a minimal permission set.</div>
              )}
            </div>
          </aside>
        </div>

        <div className="org-drawer-footer">
          <button type="button" className="org-text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="org-primary-button" onClick={onSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Member Access'}
          </button>
        </div>
      </aside>
    </>
  );
}

export default function MembersPage() {
  const { organizationId, brandProjects, isAgency, organization } = useOrgContext();
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [roleTemplates, setRoleTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [memberDraft, setMemberDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [inviteActionId, setInviteActionId] = useState(null);

  const loadMembers = async (preferredMemberId = null) => {
    setLoading(true);
    try {
      const [nextMembers, nextRoleTemplates, nextInvitations] = await Promise.all([
        fetchOrganizationMembers(organizationId),
        fetchOrgRoleTemplates(organizationId),
        fetchOrganizationInvitations(organizationId),
      ]);
      setMembers(nextMembers);
      setRoleTemplates(nextRoleTemplates);
      setInvitations(nextInvitations);

      const nextSelected = nextMembers.find((member) => member.id === preferredMemberId || member.id === editingMemberId);
      if (nextSelected) {
        setEditingMemberId(nextSelected.id);
        setMemberDraft({
          id: nextSelected.id,
          roleKey: nextSelected.role,
          permissions: cloneValue(nextSelected.permissions || {}),
          allBrandProjects: !Array.isArray(nextSelected.brandProjectIds) || nextSelected.brandProjectIds.length === 0,
          brandProjectIds: Array.isArray(nextSelected.brandProjectIds) ? [...nextSelected.brandProjectIds] : [],
        });
      }
    } catch (error) {
      console.error('Failed to load organization members:', error);
      toast.error(error?.message || 'Could not load members.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [organizationId]);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === editingMemberId) || null,
    [editingMemberId, members],
  );

  const openMemberDrawer = (member) => {
    setEditingMemberId(member.id);
    setMemberDraft({
      id: member.id,
      roleKey: member.role,
      permissions: cloneValue(member.permissions || {}),
      allBrandProjects: !Array.isArray(member.brandProjectIds) || member.brandProjectIds.length === 0,
      brandProjectIds: Array.isArray(member.brandProjectIds) ? [...member.brandProjectIds] : [],
    });
  };

  const closeDrawer = () => {
    setEditingMemberId(null);
    setMemberDraft(null);
    setSaving(false);
  };

  const handleSaveMember = async () => {
    if (!selectedMember || !memberDraft) return;

    if (!memberDraft.allBrandProjects && brandProjects.length > 0 && memberDraft.brandProjectIds.length === 0) {
      toast.error('Choose at least one brand project or grant access to all projects.');
      return;
    }

    setSaving(true);
    try {
      await updateOrganizationMember(selectedMember.id, {
        org_role_key: memberDraft.roleKey,
        permissions: memberDraft.permissions,
        brand_project_ids: memberDraft.allBrandProjects ? null : memberDraft.brandProjectIds,
      });
      toast.success('Member access updated.');
      await loadMembers(selectedMember.id);
      closeDrawer();
    } catch (error) {
      console.error('Failed to update member access:', error);
      toast.error(error?.message || 'Could not update this member.');
      setSaving(false);
    }
  };

  const handleCopyInvitation = async (invitation) => {
    try {
      await copyInviteLink(invitation.onboardingUrl);
      toast.success('Onboarding link copied.');
    } catch (error) {
      toast.error(error?.message || 'Could not copy the onboarding link.');
    }
  };

  const handleRevokeInvitation = async (invitation) => {
    setInviteActionId(invitation.id);
    try {
      await revokeOrganizationInvitation(invitation.id);
      toast.success('Invite link revoked.');
      await loadMembers();
    } catch (error) {
      toast.error(error?.message || 'Could not revoke this invitation.');
    } finally {
      setInviteActionId(null);
    }
  };

  const handleRegenerateInvitation = async (invitation) => {
    setInviteActionId(invitation.id);
    try {
      const result = await inviteOrganizationMember({
        organization_id: organizationId,
        email: invitation.email,
        role: invitation.role,
        brand_project_ids: invitation.brandProjectIds ?? null,
        delivery_mode: 'manual_link',
      });

      toast.success('A fresh onboarding link has been created.');
      await copyInviteLink(result?.onboarding_url || result?.invitation_url || invitation.onboardingUrl);
      toast.success('New onboarding link copied.');
      await loadMembers();
    } catch (error) {
      toast.error(error?.message || 'Could not regenerate this invitation.');
    } finally {
      setInviteActionId(null);
    }
  };

  const handleDeleteInvitation = async (invitation) => {
    setInviteActionId(invitation.id);
    try {
      await deleteOrganizationInvitation(invitation.id);
      toast.success('Invite record deleted.');
      await loadMembers();
    } catch (error) {
      toast.error(error?.message || 'Could not delete this invitation.');
    } finally {
      setInviteActionId(null);
    }
  };

  const activeInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const invitationHistory = invitations.filter((invitation) => invitation.status !== 'pending');

  return (
    <section className="org-page org-admin-page org-admin-members-page">
      <div className="org-page-header">
        <div>
          <h1>Members</h1>
          <p>Assign roles, review effective access, and manage member-specific permission exceptions.</p>
        </div>
        <button type="button" className="org-primary-button" onClick={() => setInviteOpen(true)}>
          <Plus size={14} />
          Invite Member
        </button>
      </div>

      {loading ? (
        <div className="org-panel-loading">Loading members...</div>
      ) : (
        <>
          {members.length === 0 ? (
            <OrgEmptyState
              eyebrow="Members"
              title="No members yet"
              description="Create shareable onboarding links for contributors, editors, and reviewers."
            />
          ) : (
            <div className="org-table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Brand Access</th>
                    <th>Status</th>
                    <th>Last Active</th>
                    <th>Credits</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const brandAccess = !Array.isArray(member.brandProjectIds) || member.brandProjectIds.length === 0
                      ? 'All projects'
                      : `${member.brandProjectIds.length} projects`;

                    return (
                      <tr key={member.id}>
                        <td>{member.profile?.full_name || member.userId}</td>
                        <td>{member.profile?.email || 'Unknown'}</td>
                        <td>{formatRoleLabel(member.role, roleTemplates)}</td>
                        <td>{brandAccess}</td>
                        <td>{member.status}</td>
                        <td>{formatLastActive(member.lastActiveAt || member.joinedAt)}</td>
                        <td>{member.creditsUsedThisPeriod}</td>
                        <td>
                          <button type="button" className="org-text-button" onClick={() => openMemberDrawer(member)}>
                            <PencilLine size={14} />
                            Manage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <section className="org-member-invites">
            <div className="org-page-header subheader">
              <div>
                <h2>Active Invite Links</h2>
                <p>Share, revoke, or regenerate active onboarding links without depending on outbound email delivery.</p>
              </div>
            </div>

            {activeInvitations.length === 0 ? (
              <div className="org-empty-inline">No active invite links have been created yet.</div>
            ) : (
              <div className="org-table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeInvitations.map((invitation) => {
                      const statusMeta = getInvitationStatusMeta(invitation.status);
                      const busy = inviteActionId === invitation.id;

                      return (
                        <tr key={invitation.id}>
                          <td>{invitation.email}</td>
                          <td>{formatRoleLabel(invitation.role, roleTemplates)}</td>
                          <td>
                            <span className={`org-invite-status-badge ${statusMeta.tone}`.trim()}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td>{formatDate(invitation.createdAt)}</td>
                          <td>{formatDate(invitation.expiresAt)}</td>
                          <td>
                            <div className="org-inline-actions">
                              {invitation.status === 'pending' ? (
                                <button type="button" className="org-text-button" onClick={() => handleCopyInvitation(invitation)} disabled={busy}>
                                  <Copy size={14} />
                                  Copy
                                </button>
                              ) : null}
                              <button type="button" className="org-text-button" onClick={() => handleRegenerateInvitation(invitation)} disabled={busy}>
                                <RefreshCcw size={14} />
                                Regenerate
                              </button>
                              <button type="button" className="org-text-button danger" onClick={() => handleRevokeInvitation(invitation)} disabled={busy}>
                                <Slash size={14} />
                                Revoke
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="org-page-header subheader">
              <div>
                <h2>Invite History</h2>
                <p>Revoked and expired links can be deleted after they become terminal records.</p>
              </div>
            </div>

            {invitationHistory.length === 0 ? (
              <div className="org-empty-inline">No revoked or expired invite records yet.</div>
            ) : (
              <div className="org-table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitationHistory.map((invitation) => {
                      const statusMeta = getInvitationStatusMeta(invitation.status);
                      const busy = inviteActionId === invitation.id;

                      return (
                        <tr key={invitation.id}>
                          <td>{invitation.email}</td>
                          <td>{formatRoleLabel(invitation.role, roleTemplates)}</td>
                          <td>
                            <span className={`org-invite-status-badge ${statusMeta.tone}`.trim()}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td>{formatDate(invitation.createdAt)}</td>
                          <td>{formatDate(invitation.expiresAt)}</td>
                          <td>
                            <div className="org-inline-actions">
                              <button type="button" className="org-text-button" onClick={() => handleRegenerateInvitation(invitation)} disabled={busy}>
                                <RefreshCcw size={14} />
                                Regenerate
                              </button>
                              <button type="button" className="org-text-button danger" onClick={() => handleDeleteInvitation(invitation)} disabled={busy}>
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <InviteMemberPanel
        open={inviteOpen}
        organizationId={organizationId}
        isAgency={isAgency}
        brandProjects={brandProjects}
        roleTemplates={roleTemplates}
        onClose={() => setInviteOpen(false)}
        onInvited={() => loadMembers()}
      />

      <MemberDetailDrawer
        member={selectedMember}
        memberDraft={memberDraft}
        roleTemplates={roleTemplates}
        brandProjects={brandProjects}
        organizationOwnerId={organization?.ownerId || null}
        isAgency={isAgency}
        saving={saving}
        onClose={closeDrawer}
        onSave={handleSaveMember}
        onResetOverrides={() => setMemberDraft((current) => ({
          ...current,
          permissions: {},
        }))}
        onUpdate={(updater) => setMemberDraft((current) => {
          if (!current) return current;
          const next = typeof updater === 'function' ? updater(cloneValue(current)) : updater;
          return next;
        })}
      />
    </section>
  );
}
