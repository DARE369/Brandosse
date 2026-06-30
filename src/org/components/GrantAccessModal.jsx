import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LockKeyhole, X } from 'lucide-react';
import {
  resolveOrgPermissions,
} from '../services/orgService';
import {
  updateOrganizationAccountAccess,
} from '../../services/platforms/connectionService';

function getMemberDisplayName(member) {
  return member?.profile?.full_name || member?.profile?.email || 'Team member';
}

function getRoleLabel(role) {
  return String(role || 'member')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function canMemberPublish(member) {
  const permissions = resolveOrgPermissions({
    role: member?.role,
    overrides: member?.permissions,
  });
  return Boolean(permissions.can_publish);
}

export default function GrantAccessModal({
  open = false,
  account = null,
  members = [],
  onSaveAccess,
  onClose,
  onSaved,
}) {
  const [mode, setMode] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const eligibleMembers = useMemo(
    () => members.filter((member) => member?.status === 'active' && canMemberPublish(member)),
    [members],
  );

  useEffect(() => {
    if (!open || !account) return;
    const grantedMemberIds = Array.isArray(account.granted_member_ids)
      ? account.granted_member_ids.filter(Boolean)
      : [];
    setMode(grantedMemberIds.length > 0 ? 'specific' : 'all');
    setSelectedIds(grantedMemberIds);
  }, [account, open]);

  if (!open || !account) return null;

  const toggleMember = (memberId) => {
    setSelectedIds((current) => (
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId]
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        grantAll: mode === 'all',
        grantedMemberIds: mode === 'specific' ? selectedIds : [],
      };

      if (typeof onSaveAccess === 'function') {
        await onSaveAccess(payload);
      } else {
        await updateOrganizationAccountAccess(account.id, payload);
      }
      await onSaved?.();
    } catch (error) {
      console.error('Failed to update org account access:', error);
      window.alert(error?.message || 'Could not update organization account access.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="org-connected-access-shell" role="dialog" aria-modal="true" aria-label="Manage posting access">
      <button
        type="button"
        className="org-connected-access-backdrop"
        aria-label="Close posting access"
        onClick={onClose}
      />

      <section className="org-connected-access-panel">
        <header className="org-connected-access-header">
          <div>
            <span className="org-section-kicker">Posting Access</span>
            <h3>Manage shared account access</h3>
            <p>{account.display_name || account.account_name || account.username || account.platform}</p>
          </div>

          <button type="button" className="org-icon-button" onClick={onClose} aria-label="Close access modal">
            <X size={16} />
          </button>
        </header>

        <div className="org-connected-access-toggle">
          <button
            type="button"
            className={mode === 'all' ? 'active' : ''}
            onClick={() => setMode('all')}
          >
            All publish-enabled members
          </button>
          <button
            type="button"
            className={mode === 'specific' ? 'active' : ''}
            onClick={() => setMode('specific')}
          >
            Specific members only
          </button>
        </div>

        <div className="org-connected-access-note">
          <LockKeyhole size={14} />
          <span>
            {mode === 'all'
              ? 'Any active member with publish permission can use this shared account.'
              : 'Only the selected members can publish through this shared account.'}
          </span>
        </div>

        {mode === 'specific' ? (
          eligibleMembers.length > 0 ? (
            <div className="org-connected-access-list">
              {eligibleMembers.map((member) => {
                const selected = selectedIds.includes(member.userId);
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={`org-connected-access-row ${selected ? 'selected' : ''}`.trim()}
                    onClick={() => toggleMember(member.userId)}
                  >
                    <div>
                      <strong>{getMemberDisplayName(member)}</strong>
                      <span>{getRoleLabel(member.role)}</span>
                    </div>
                    {selected ? <CheckCircle2 size={16} /> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="org-empty-inline">
              No members currently have publish permission in this organization.
            </div>
          )
        ) : null}

        <footer className="org-connected-access-footer">
          <button type="button" className="org-secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="org-primary-button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Access'}
          </button>
        </footer>
      </section>
    </div>
  );
}
