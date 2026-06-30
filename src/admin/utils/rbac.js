import {
  getAdminScope,
  isAdminRole as hasAdminCapability,
  normalizeAdminCapabilityRole,
} from "../../utils/adminCapability";

export const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  ORG_ADMIN: "org_admin",
};

export function normalizeAdminRole(rawRole) {
  return normalizeAdminCapabilityRole(rawRole);
}

export function isAdminRole(rawRole) {
  const normalized = normalizeAdminRole(rawRole);
  return hasAdminCapability(normalized);
}

export function getAdminRoleLabel(role) {
  switch (normalizeAdminRole(role)) {
    case ADMIN_ROLES.SUPER_ADMIN:
      return "Super Admin";
    case ADMIN_ROLES.ORG_ADMIN:
      return "Org Admin";
    default:
      return "User";
  }
}

export function getAdminScopeLabel(access) {
  const normalizedRole = normalizeAdminRole(access?.adminRole);
  const scope = getAdminScope(normalizedRole);

  if (scope === "platform") {
    return "Platform-wide";
  }

  if (scope === "org" && access?.organization?.name) {
    return access.organization.name;
  }

  if (scope === "org" || access?.isAdmin) {
    return "Unassigned";
  }

  return "No admin scope";
}

export function getPermissionGroups(role) {
  if (normalizeAdminRole(role) === ADMIN_ROLES.SUPER_ADMIN) {
    return [
      "Organizations",
      "User Operations",
      "Moderation",
      "Complaints",
      "Analytics",
      "System Logs",
    ];
  }

  if (normalizeAdminRole(role) === ADMIN_ROLES.ORG_ADMIN) {
    return [
      "Organizations",
      "User Operations",
      "Moderation",
      "Complaints",
      "Analytics",
    ];
  }

  return [];
}

export function getAdminNavItems(role) {
  const normalizedRole = normalizeAdminRole(role);

  return [
    {
      label: "Overview",
      path: "/app/admin",
      icon: "layout-dashboard",
      description: "Live platform health",
      visible: true,
    },
    {
      label: "Users",
      path: "/app/admin/users",
      icon: "users",
      description: "Account directory",
      visible: true,
    },
    {
      label: "Accounts",
      path: "/app/admin/accounts",
      icon: "wifi",
      description: "Connected account ops",
      visible: normalizedRole === ADMIN_ROLES.SUPER_ADMIN,
    },
    {
      label: "Organizations",
      path: "/app/admin/organizations",
      icon: "building-2",
      description: "Tenant governance",
      visible: normalizedRole === ADMIN_ROLES.SUPER_ADMIN,
    },
    {
      label: "Moderation",
      path: "/app/admin/moderation",
      icon: "shield-check",
      description: "Content review",
      visible: true,
    },
    {
      label: "Complaints",
      path: "/app/admin/complaints",
      icon: "messages-square",
      description: "Support and disputes",
      visible: true,
    },
    {
      label: "Analytics",
      path: "/app/admin/analytics",
      icon: "bar-chart-3",
      description: "Operational intelligence",
      visible: true,
    },
    {
      label: "System Logs",
      path: "/app/admin/logs",
      icon: "scroll-text",
      description: "Audit trail",
      visible: normalizedRole === ADMIN_ROLES.SUPER_ADMIN,
    },
    {
      label: "Settings",
      path: "/app/admin/settings",
      icon: "settings",
      description: "Workspace preferences",
      visible: true,
    },
  ].filter((item) => item.visible);
}

