import { isAdminRole as hasAdminCapability } from "./adminCapability";

export const APP_ROOT_PATH = "/app";
export const USER_HOME_PATH = "/app/dashboard";
export const ADMIN_HOME_PATH = "/app/admin";
export const SIGNUP_COMPLETION_PATH = "/complete-signup";

export const USER_WORKSPACE_PATHS = [
  "/app/dashboard",
  "/app/generate",
  "/app/calendar",
  "/app/library",
  "/app/help",
  "/app/settings",
];

const SUPER_ADMIN_ROLE_TOKENS = new Set([
  "admin",
  "administrator",
  "superadmin",
  "super_admin",
  "owner",
  "root",
  "true",
  "1",
  "yes",
  "y",
]);

const ORG_ADMIN_ROLE_TOKENS = new Set([
  "orgadmin",
  "org_admin",
]);

const USER_ROLE_TOKENS = new Set([
  "user",
  "creator",
  "member",
  "client",
  "false",
  "0",
  "no",
  "n",
]);

function toNormalizedToken(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase();
}

export function normalizeRole(rawValue) {
  if (Array.isArray(rawValue)) {
    for (const value of rawValue) {
      const normalized = normalizeRole(value);
      if (normalized === "super_admin") return "super_admin";
      if (normalized === "org_admin") return "org_admin";
      if (normalized === "user") return "user";
    }
    return null;
  }

  if (typeof rawValue === "boolean") {
    return rawValue ? "super_admin" : "user";
  }

  const token = toNormalizedToken(rawValue);
  if (!token) return null;
  if (SUPER_ADMIN_ROLE_TOKENS.has(token)) return "super_admin";
  if (ORG_ADMIN_ROLE_TOKENS.has(token)) return "org_admin";
  if (USER_ROLE_TOKENS.has(token)) return "user";
  return null;
}

export function resolveRole({
  metadataRole = null,
  metadataIsAdmin = null,
  profileRole = null,
  profileIsAdmin = null,
} = {}) {
  const candidates = [metadataRole, metadataIsAdmin, profileRole, profileIsAdmin];

  if (candidates.some((value) => normalizeRole(value) === "super_admin")) {
    return "super_admin";
  }

  if (candidates.some((value) => normalizeRole(value) === "org_admin")) {
    return "org_admin";
  }

  if (candidates.some((value) => normalizeRole(value) === "user")) {
    return "user";
  }

  return null;
}

const POST_AUTH_SAFE_NON_APP_PATHS = new Set([
  "/select-context",
  SIGNUP_COMPLETION_PATH,
]);

function isSafePostAuthPath(path) {
  return typeof path === "string" && (
    path.startsWith("/app") ||
    POST_AUTH_SAFE_NON_APP_PATHS.has(path)
  );
}

export function isAdminPath(path) {
  if (typeof path !== "string") return false;
  return path === ADMIN_HOME_PATH || path.startsWith(`${ADMIN_HOME_PATH}/`);
}

export function isAdminRole(role) {
  const normalizedRole = normalizeRole(role);
  return hasAdminCapability(normalizedRole);
}

export function isUserWorkspacePath(path) {
  if (typeof path !== "string") return false;
  return USER_WORKSPACE_PATHS.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

function sanitizeIntendedPath(path) {
  if (!isSafePostAuthPath(path)) return null;
  if (path === APP_ROOT_PATH) return null;
  return path;
}

export function getDefaultPathForRole(role) {
  return isAdminRole(role) ? ADMIN_HOME_PATH : USER_HOME_PATH;
}

export function resolvePostAuthPath({ role, intendedPath = null } = {}) {
  const normalizedRole = normalizeRole(role);
  const safeIntendedPath = sanitizeIntendedPath(intendedPath);

  if (safeIntendedPath) {
    if (isAdminPath(safeIntendedPath) && !isAdminRole(normalizedRole)) {
      return USER_HOME_PATH;
    }
    return safeIntendedPath;
  }

  return getDefaultPathForRole(normalizedRole);
}
