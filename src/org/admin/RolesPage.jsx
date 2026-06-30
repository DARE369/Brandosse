"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, RotateCcw, Save, Shield, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import OrgEmptyState from '../components/OrgEmptyState';
import {
  ORG_PERMISSION_GROUPS,
  ORG_ROLE_LABELS,
  SYSTEM_ROLE_ORDER,
  countEnabledPermissions,
  summarizePermissions,
} from '../constants/permissions';
import { useOrgContext } from '../hooks/useOrgContext';
import {
  ORG_ROLE_DEFAULTS,
  buildUniqueOrgRoleKey,
  createOrgRoleTemplate,
  deleteOrgRoleTemplate,
  duplicateOrgRoleTemplate,
  fetchOrgRoleTemplates,
  fetchOrganizationMembers,
  updateOrgRoleTemplate,
} from '../services/orgService';
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortRoleTemplates(templates = []) {
  const order = new Map(SYSTEM_ROLE_ORDER.map((key, index) => [key, index]));

  return [...templates].sort((left, right) => {
    const leftRank = order.has(left.role_key) ? order.get(left.role_key) : 100;
    const rightRank = order.has(right.role_key) ? order.get(right.role_key) : 100;

    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.display_name || left.role_key).localeCompare(String(right.display_name || right.role_key));
  });
}

function createUnsavedRole(existingRoles = []) {
  const displayName = 'New Role';
  return {
    id: '__draft_role__',
    organization_id: null,
    role_key: buildUniqueOrgRoleKey(displayName, existingRoles),
    display_name: displayName,
    permissions: cloneValue(ORG_ROLE_DEFAULTS.contributor),
    is_system: false,
  };
}

function getRoleLabel(roleKey) {
  return ORG_ROLE_LABELS[roleKey] || roleKey?.replace(/_/g, ' ') || 'Role';
}

function PermissionToggleRow({ field, value, disabled = false, onToggle }) {
  return (
    <div className={`org-permission-row ${disabled ? 'disabled' : ''}`}>
      <div className="org-permission-copy">
        <strong>{field.label}</strong>
        <p>{field.description}</p>
      </div>
      <button
        type="button"
        className={`org-switch ${value ? 'active' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={value}
      >
        <span className="org-switch-thumb" />
      </button>
    </div>
  );
}

function PermissionNumberRow({ field, value, onChange }) {
  return (
    <div className="org-permission-row number">
      <div className="org-permission-copy">
        <strong>{field.label}</strong>
        <p>{field.description}</p>
      </div>
      <input
        type="number"
        min="0"
        className="org-permission-number"
        value={value ?? ''}
        placeholder="No limit"
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </div>
  );
}

export default function RolesPage() {
  const { organizationId } = useOrgContext();
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [draftRole, setDraftRole] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadData = async (preferredRoleId = null) => {
    setLoading(true);
    try {
      const [nextRoles, nextMembers] = await Promise.all([
        fetchOrgRoleTemplates(organizationId),
        fetchOrganizationMembers(organizationId),
      ]);

      const sortedRoles = sortRoleTemplates(nextRoles);
      setRoles(sortedRoles);
      setMembers(nextMembers);

      if (sortedRoles.length > 0) {
        const nextSelected = sortedRoles.find((role) => role.id === preferredRoleId || role.id === selectedRoleId) || sortedRoles[0];
        setSelectedRoleId(nextSelected.id);
        setDraftRole(cloneValue(nextSelected));
      } else {
        setSelectedRoleId(null);
        setDraftRole(null);
      }
    } catch (error) {
      console.error('Failed to load role templates:', error);
      toast.error(error?.message || 'Could not load roles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [organizationId]);

  const memberCounts = useMemo(() => (
    members.reduce((map, member) => {
      const roleKey = member.role;
      map[roleKey] = (map[roleKey] || 0) + 1;
      return map;
    }, {})
  ), [members]);

  const memberNamesByRole = useMemo(() => (
    members.reduce((map, member) => {
      const roleKey = member.role;
      if (!map[roleKey]) map[roleKey] = [];
      map[roleKey].push(member.profile?.full_name || member.profile?.email || member.userId);
      return map;
    }, {})
  ), [members]);

  const keyPreview = useMemo(
    () => (
      draftRole?.id === '__draft_role__'
        ? buildUniqueOrgRoleKey(draftRole.display_name, roles)
        : draftRole?.role_key
    ),
    [draftRole, roles],
  );

  const roleSummary = useMemo(() => {
    if (!draftRole) return [];
    return summarizePermissions(draftRole.permissions || {});
  }, [draftRole]);

  const selectRole = (role) => {
    setSelectedRoleId(role.id);
    setDraftRole(cloneValue(role));
  };

  const handleCreateCustomRole = () => {
    const nextDraft = createUnsavedRole(roles);
    setSelectedRoleId(nextDraft.id);
    setDraftRole(nextDraft);
  };

  const updateDraftRole = (updater) => {
    setDraftRole((current) => {
      if (!current) return current;
      const nextRole = typeof updater === 'function' ? updater(cloneValue(current)) : updater;
      if (!nextRole.permissions.can_publish) {
        nextRole.permissions.publish_requires_final_approval = false;
      }
      return nextRole;
    });
  };

  const handleSave = async () => {
    if (!draftRole?.display_name?.trim()) {
      toast.error('Give this role a name first.');
      return;
    }

    setSaving(true);
    try {
      let saved;
      if (draftRole.id === '__draft_role__') {
        saved = await createOrgRoleTemplate({
          organizationId,
          roleKey: buildUniqueOrgRoleKey(draftRole.display_name, roles),
          displayName: draftRole.display_name,
          permissions: draftRole.permissions,
          isSystem: false,
        });
        toast.success('Role created.');
      } else {
        saved = await updateOrgRoleTemplate(draftRole.id, {
          display_name: draftRole.display_name,
          permissions: draftRole.permissions,
        });
        toast.success('Role updated.');
      }

      await loadData(saved.id);
    } catch (error) {
      console.error('Failed to save role template:', error);
      toast.error(error?.message || 'Could not save this role.');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!draftRole || draftRole.id === '__draft_role__') return;

    setSaving(true);
    try {
      const duplicated = await duplicateOrgRoleTemplate({
        organizationId,
        template: draftRole,
        existingTemplates: roles,
      });
      toast.success('Role duplicated.');
      await loadData(duplicated.id);
    } catch (error) {
      toast.error(error?.message || 'Could not duplicate this role.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draftRole || draftRole.is_system) return;

    const assignedCount = memberCounts[draftRole.role_key] || 0;
    if (assignedCount > 0) {
      toast.error('Move members off this role before deleting it.');
      return;
    }

    const confirmed = window.confirm(`Delete the "${draftRole.display_name}" role?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      await deleteOrgRoleTemplate(draftRole.id);
      toast.success('Role deleted.');
      await loadData();
    } catch (error) {
      toast.error(error?.message || 'Could not delete this role.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetSystemDefaults = () => {
    const systemDefaults = ORG_ROLE_DEFAULTS[draftRole?.role_key];
    if (!systemDefaults) return;
    updateDraftRole((current) => ({
      ...current,
      permissions: cloneValue(systemDefaults),
    }));
  };

  if (loading) {
    return <div className="org-panel-loading">Loading roles...</div>;
  }

  if (roles.length === 0 && !draftRole) {
    return (
      <OrgEmptyState
        eyebrow="Roles"
        title="No role templates yet"
        description="Create a custom role to start defining default permissions for this workspace."
        action={(
          <button type="button" className="org-primary-button" onClick={handleCreateCustomRole}>
            <Plus size={14} />
            Add Custom Role
          </button>
        )}
      />
    );
  }

  return (
    <section className="org-page org-admin-page org-admin-roles-page">
      <div className="org-page-header">
        <div>
          <h1>Roles & Permissions</h1>
          <p>Define reusable permission templates, then assign them to members from the members workspace.</p>
        </div>

        <button type="button" className="org-primary-button" onClick={handleCreateCustomRole}>
          <Plus size={14} />
          Add Custom Role
        </button>
      </div>

      <div className="org-role-layout">
        <aside className="org-panel org-role-sidebar">
          <div className="org-panel-header">
            <div>
              <h3>Role Templates</h3>
              <p>System roles are editable. Custom roles can be deleted.</p>
            </div>
          </div>

          <div className="org-role-list">
            {sortRoleTemplates(roles).map((role) => (
              <button
                key={role.id}
                type="button"
                className={`org-role-card ${selectedRoleId === role.id ? 'active' : ''}`}
                onClick={() => selectRole(role)}
              >
                <div className="org-role-card-top">
                  <strong>{role.display_name || getRoleLabel(role.role_key)}</strong>
                  {role.is_system ? <span className="org-role-badge">System</span> : null}
                </div>
                <span>{memberCounts[role.role_key] || 0} members</span>
                <small>{role.role_key}</small>
              </button>
            ))}

            {draftRole?.id === '__draft_role__' ? (
              <div className="org-role-card active draft">
                <div className="org-role-card-top">
                  <strong>{draftRole.display_name}</strong>
                  <span className="org-role-badge">Unsaved</span>
                </div>
                <span>0 members</span>
                <small>{keyPreview}</small>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="org-panel org-role-editor">
          {draftRole ? (
            <>
              <div className="org-role-editor-header">
                <div className="org-role-editor-copy">
                  <input
                    type="text"
                    className="org-role-name-input"
                    value={draftRole.display_name || ''}
                    onChange={(event) => updateDraftRole((current) => ({
                      ...current,
                      display_name: event.target.value,
                    }))}
                    placeholder="Role name"
                  />
                  <div className="org-role-meta">
                    <span className="org-role-badge subtle">{draftRole.is_system ? 'System role' : 'Custom role'}</span>
                    <code>{keyPreview}</code>
                  </div>
                </div>

                <div className="org-role-editor-actions">
                  {ORG_ROLE_DEFAULTS[draftRole.role_key] ? (
                    <button type="button" className="org-text-button" onClick={handleResetSystemDefaults}>
                      <RotateCcw size={14} />
                      Reset Defaults
                    </button>
                  ) : null}
                  <button type="button" className="org-text-button" onClick={handleDuplicate} disabled={saving || draftRole.id === '__draft_role__'}>
                    <Copy size={14} />
                    Duplicate
                  </button>
                  {!draftRole.is_system && draftRole.id !== '__draft_role__' ? (
                    <button type="button" className="org-text-button danger" onClick={handleDelete} disabled={saving}>
                      <Trash2 size={14} />
                      Delete
                    </button>
                  ) : null}
                  <button type="button" className="org-primary-button" onClick={handleSave} disabled={saving}>
                    <Save size={14} />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>

              <div className="org-summary-grid">
                <article className="org-summary-card">
                  <span className="org-modal-kicker">Members</span>
                  <strong>{memberCounts[draftRole.role_key] || 0}</strong>
                  <p>Currently assigned to this role.</p>
                </article>
                <article className="org-summary-card">
                  <span className="org-modal-kicker">Capabilities</span>
                  <strong>{countEnabledPermissions(draftRole.permissions || {})}</strong>
                  <p>Enabled boolean permissions in this template.</p>
                </article>
                <article className="org-summary-card">
                  <span className="org-modal-kicker">Used By</span>
                  <strong>{memberNamesByRole[draftRole.role_key]?.[0] || 'No members yet'}</strong>
                  <p>{memberNamesByRole[draftRole.role_key]?.slice(1, 3).join(', ') || 'Assign the role from the Members page.'}</p>
                </article>
              </div>

              <div className="org-role-editor-grid">
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
                        {group.fields.map((field) => (
                          field.type === 'boolean' ? (
                            <PermissionToggleRow
                              key={field.key}
                              field={field}
                              value={Boolean(draftRole.permissions?.[field.key])}
                              disabled={Boolean(field.dependsOn && !draftRole.permissions?.[field.dependsOn])}
                              onToggle={() => updateDraftRole((current) => ({
                                ...current,
                                permissions: {
                                  ...current.permissions,
                                  [field.key]: !current.permissions?.[field.key],
                                },
                              }))}
                            />
                          ) : (
                            <PermissionNumberRow
                              key={field.key}
                              field={field}
                              value={draftRole.permissions?.[field.key] ?? null}
                              onChange={(nextValue) => updateDraftRole((current) => ({
                                ...current,
                                permissions: {
                                  ...current.permissions,
                                  monthly_credit_limit: nextValue,
                                },
                              }))}
                            />
                          )
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <aside className="org-permission-summary-panel">
                  <div className="org-panel-header">
                    <div>
                      <h3>Effective Summary</h3>
                      <p>Quickly scan what this role can do.</p>
                    </div>
                  </div>

                  <div className="org-permission-summary-list">
                    {roleSummary.length > 0 ? roleSummary.map((item) => (
                      <div key={item} className="org-summary-pill">
                        <Shield size={14} />
                        <span>{item}</span>
                      </div>
                    )) : (
                      <div className="org-empty-inline">This role has no enabled special permissions yet.</div>
                    )}
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <div className="org-empty-inline">Select a role template to configure it.</div>
          )}
        </div>
      </div>
    </section>
  );
}
