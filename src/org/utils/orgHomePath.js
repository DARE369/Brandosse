export function normalizeOrgRoleKey(role) {
  return String(role || 'contributor').trim().toLowerCase();
}

export function isOrgAdminRoleKey(role) {
  return ['org_owner', 'org_admin'].includes(normalizeOrgRoleKey(role));
}

export function getOrganizationHomeSegment(role) {
  return isOrgAdminRoleKey(role) ? 'overview' : 'workspace';
}

export function getOrganizationHomePath(organizationId, role) {
  if (!organizationId) return '/select-context';
  return `/app/org/${organizationId}/${getOrganizationHomeSegment(role)}`;
}
