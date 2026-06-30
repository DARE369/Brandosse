import { getOrganizationHomePath } from '../org/utils/orgHomePath';

const WORKSPACE_LABELS = {
  admin: 'Admin Workspace',
  personal: 'Personal Workspace',
  organization: 'Organization Workspace',
};

function parseOrgIdFromPath(pathname = '') {
  const match = String(pathname || '').match(/^\/app\/org\/([^/]+)/i);
  return match?.[1] || null;
}

function formatOrgRoleLabel(role) {
  const normalized = String(role || 'member')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function buildWorkspaceCatalog({ isAdmin = false, orgMemberships = [] } = {}) {
  const workspaces = [];

  if (isAdmin) {
    workspaces.push({
      id: 'admin',
      type: 'admin',
      label: WORKSPACE_LABELS.admin,
      description: 'Platform operations',
      path: '/app/admin',
      organizationId: null,
    });
  }

  workspaces.push({
    id: 'personal',
    type: 'personal',
    label: WORKSPACE_LABELS.personal,
    description: 'Your creator workspace',
    path: '/app/dashboard',
    organizationId: null,
  });

  orgMemberships
    .filter((membership) => membership?.organizationId && membership?.status === 'active')
    .forEach((membership) => {
      workspaces.push({
        id: `organization:${membership.organizationId}`,
        type: 'organization',
        label: membership.organization?.name || WORKSPACE_LABELS.organization,
        description: formatOrgRoleLabel(membership.role),
        path: getOrganizationHomePath(membership.organizationId, membership.role),
        organizationId: membership.organizationId,
        organization: membership.organization || null,
      });
    });

  return workspaces;
}

export function findWorkspaceTarget(workspaces = [], target) {
  if (!target) return null;

  if (typeof target === 'string') {
    return (
      workspaces.find((workspace) => workspace.id === target)
      || workspaces.find((workspace) => workspace.type === target)
      || null
    );
  }

  if (target.type === 'organization' && target.organizationId) {
    return (
      workspaces.find(
        (workspace) =>
          workspace.type === 'organization' && workspace.organizationId === target.organizationId,
      )
      || null
    );
  }

  return findWorkspaceTarget(workspaces, target.type || target.id || null);
}

export function deriveWorkspaceFromPath(pathname, workspaces = []) {
  const path = String(pathname || '');

  if (path === '/app/admin' || path.startsWith('/app/admin/')) {
    return findWorkspaceTarget(workspaces, 'admin') || {
      id: 'admin',
      type: 'admin',
      label: WORKSPACE_LABELS.admin,
      description: 'Platform operations',
      path: '/app/admin',
      organizationId: null,
    };
  }

  const organizationId = parseOrgIdFromPath(path);
  if (organizationId) {
    return (
      findWorkspaceTarget(workspaces, { type: 'organization', organizationId })
      || {
        id: `organization:${organizationId}`,
        type: 'organization',
        label: WORKSPACE_LABELS.organization,
        description: 'Organization workspace',
        path: `/app/org/${organizationId}/workspace`,
        organizationId,
      }
    );
  }

  if (path === '/app' || path.startsWith('/app/')) {
    return findWorkspaceTarget(workspaces, 'personal') || {
      id: 'personal',
      type: 'personal',
      label: WORKSPACE_LABELS.personal,
      description: 'Your creator workspace',
      path: '/app/dashboard',
      organizationId: null,
    };
  }

  return null;
}

export function formatWorkspaceTarget(target) {
  if (!target) return null;

  if (typeof target === 'string') {
    return { type: target };
  }

  return {
    type: target.type || target.id || null,
    organizationId: target.organizationId || null,
  };
}
