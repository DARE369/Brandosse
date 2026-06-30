const ADMIN_ROLE_VALUES = ["super_admin", "org_admin"];

export const ADMIN_ROLES = [...ADMIN_ROLE_VALUES];

export function isAdminRole(role) {
  return ADMIN_ROLE_VALUES.includes(String(role || "").trim().toLowerCase());
}

export function isSuperAdmin(role) {
  return String(role || "").trim().toLowerCase() === "super_admin";
}

export function getAdminScope(role) {
  return isSuperAdmin(role) ? "platform" : "org";
}

export function normalizeAdminCapabilityRole(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["admin", "administrator", "superadmin", "super_admin", "owner", "root", "true", "1", "yes", "y"].includes(normalized)) {
    return "super_admin";
  }
  if (["orgadmin", "org_admin"].includes(normalized)) {
    return "org_admin";
  }
  return null;
}

