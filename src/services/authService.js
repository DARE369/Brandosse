// src/services/authService.js
import { supabase } from "./supabaseClient";
import { resolveRole } from "../utils/authRouting";

const PROFILE_SELECT_VARIANTS = [
  "id, role, is_admin, full_name, avatar_url, email, organization_id, credits",
  "id, role, is_admin, full_name, avatar_url, email, credits",
  "id, role, is_admin, full_name, avatar_url, email, organization_id",
  "id, role, is_admin, full_name, avatar_url, email",
  "id, role, full_name, avatar_url, email, organization_id, credits",
  "id, role, full_name, avatar_url, email, credits",
  "id, role, full_name, avatar_url, email, organization_id",
  "id, role, full_name, avatar_url, email",
];

const PROFILE_ROLE_CACHE_TTL_MS = 30000;
const AUTH_LOOKUP_COOLDOWN_MS = 12000;
const AUTH_WARNING_THROTTLE_MS = 8000;

const ORG_MEMBERSHIP_SELECT_VARIANTS = [
  "id, organization_id, role, org_role_key, status, brand_project_ids, permissions, credits_used_this_period, joined_at",
  "id, organization_id, role, status, brand_project_ids, permissions, credits_used_this_period, joined_at",
  "id, organization_id, role, status, joined_at",
];

const ORG_SELECT_VARIANTS = [
  "id, name, slug, logo_url, avatar_url, brand_color, plan_key, status",
  "id, name, slug, avatar_url, status",
];

// Single-round-trip variants: memberships + their organization via PostgREST embed.
const ORG_MEMBERSHIP_EMBED_VARIANTS = [
  "id, organization_id, role, org_role_key, status, brand_project_ids, permissions, credits_used_this_period, joined_at, organizations(id, name, slug, logo_url, avatar_url, brand_color, plan_key, status)",
  "id, organization_id, role, status, brand_project_ids, permissions, credits_used_this_period, joined_at, organizations(id, name, slug, avatar_url, status)",
  "id, organization_id, role, status, joined_at, organizations(id, name, slug, avatar_url, status)",
];

let cachedProfileRoleResult = null;
let cachedProfileRoleUserId = null;
let cachedProfileRoleAt = 0;
let inFlightProfileRolePromise = null;
let inFlightProfileRoleUserId = null;
let authLookupCooldownUntil = 0;
let lastAuthWarningAt = 0;
let lastKnownAuthUser = null;

function isMissingColumnError(error) {
  if (!error) return false;
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("pgrst")
  );
}

function isRecoverableAdminRoleError(error) {
  if (!error) return false;
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    message.includes("stack depth") ||
    message.includes("infinite recursion") ||
    message.includes("permission denied") ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("pgrst")
  );
}

function isRecoverableOrgLookupError(error) {
  return isMissingColumnError(error) || isRecoverableAdminRoleError(error);
}

function isRateLimitError(error) {
  if (!error) return false;
  const message = `${error.status || ""} ${error.code || ""} ${error.message || ""}`.toLowerCase();
  return message.includes("429") || message.includes("rate limit");
}

function isMissingAuthSessionError(error) {
  if (!error) return false;
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return message.includes("auth session missing");
}

function logAuthWarning(message, meta = null) {
  const now = Date.now();
  if (now - lastAuthWarningAt < AUTH_WARNING_THROTTLE_MS) return;
  lastAuthWarningAt = now;
  if (meta) {
    console.warn(message, meta);
    return;
  }
  console.warn(message);
}

async function resolveAuthUser(activeUser = null) {
  if (activeUser?.id) {
    lastKnownAuthUser = activeUser;
    authLookupCooldownUntil = 0;
    return activeUser;
  }

  if (Date.now() < authLookupCooldownUntil) {
    return lastKnownAuthUser;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (isRateLimitError(error)) {
      authLookupCooldownUntil = Date.now() + AUTH_LOOKUP_COOLDOWN_MS;
      logAuthWarning("[authService] Auth lookup temporarily throttled after 429.");
      return lastKnownAuthUser;
    }

    if (isMissingAuthSessionError(error)) {
      lastKnownAuthUser = null;
      return null;
    }

    logAuthWarning("[authService] auth.getUser failed:", error?.message || String(error));
    throw error;
  }

  const nextUser = data?.user ?? null;
  lastKnownAuthUser = nextUser;
  return nextUser;
}

async function fetchProfileWithFallback(userId) {
  let lastError = null;

  for (const selectClause of PROFILE_SELECT_VARIANTS) {
    const query = await supabase
      .from("profiles")
      .select(selectClause)
      .eq("id", userId)
      .maybeSingle();

    if (!query.error || query.error.code === "PGRST116") {
      return query;
    }

    lastError = query.error;
    if (!isMissingColumnError(query.error)) {
      return query;
    }
  }

  return { data: null, error: lastError };
}

async function fetchWithSelectVariants(tableName, selectVariants, applyQuery) {
  let lastError = null;

  for (const selectClause of selectVariants) {
    const result = await applyQuery(
      supabase.from(tableName).select(selectClause),
    );

    if (!result.error) {
      return result;
    }

    lastError = result.error;
    if (!isMissingColumnError(result.error)) {
      return result;
    }
  }

  return { data: null, error: lastError };
}

function resetUserProfileRoleCache() {
  cachedProfileRoleResult = null;
  cachedProfileRoleUserId = null;
  cachedProfileRoleAt = 0;
  inFlightProfileRolePromise = null;
  inFlightProfileRoleUserId = null;
  authLookupCooldownUntil = 0;
  lastAuthWarningAt = 0;
  lastKnownAuthUser = null;
}

export { resetUserProfileRoleCache };

/**
 * Sign in a user with email + password (throws on error)
 */
export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  resetUserProfileRoleCache();
  return data; // contains session info
};

/**
 * Sign out
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  resetUserProfileRoleCache();
  return true;
};

/**
 * Get current supabase-auth user (or null)
 */
export const getCurrentAuthUser = async () => {
  return resolveAuthUser();
};

/**
 * Return user's role and profile (reliable).
 *
 * Strategy:
 * 1) Read `app_metadata.role` (most authoritative if admin created via dashboard)
 * 2) Fall back to `user_metadata.role` (if you set role on signUp using user metadata)
 * 3) Merge with `profiles.role` and `profiles.is_admin` (if available)
 *
 * Returns: { user, role, adminRole, profile }
 */
export const getUserProfileAndRole = async (activeUser = null) => {
  try {
    // 1) Resolve auth user (prefer active context user to avoid redundant auth API calls).
    const user = await resolveAuthUser(activeUser);
    if (!user) {
      resetUserProfileRoleCache();
      return { user: null, role: null, adminRole: null, profile: null };
    }

    if (
      cachedProfileRoleUserId === user.id &&
      cachedProfileRoleResult &&
      Date.now() - cachedProfileRoleAt < PROFILE_ROLE_CACHE_TTL_MS
    ) {
      return cachedProfileRoleResult;
    }

    if (inFlightProfileRolePromise && inFlightProfileRoleUserId === user.id) {
      return inFlightProfileRolePromise;
    }

    inFlightProfileRoleUserId = user.id;
    inFlightProfileRolePromise = (async () => {
      // 2) Read role hints from auth metadata first.
      const appRole =
        user?.app_metadata?.role ??
        user?.app_metadata?.roles ??
        user?.app_metadata?.user_role ??
        null;
      const userRoleMeta =
        user?.user_metadata?.role ??
        user?.user_metadata?.roles ??
        user?.user_metadata?.user_role ??
        null;
      const appIsAdmin = user?.app_metadata?.is_admin ?? user?.app_metadata?.isAdmin ?? null;
      const userIsAdmin = user?.user_metadata?.is_admin ?? user?.user_metadata?.isAdmin ?? null;

      let role = resolveRole({
        metadataRole: [appRole, userRoleMeta],
        metadataIsAdmin: [appIsAdmin, userIsAdmin],
      });
      let profile = null;
      let adminRole = null;

      // 3) Read profile role markers and merge with metadata role hints.
      const profileQuery = await fetchProfileWithFallback(user.id);

      const profileData = profileQuery.data;
      const profileErr = profileQuery.error;

      if (profileErr && profileErr.code !== "PGRST116") {
        // Unexpected DB error (not just "no rows")
        console.warn("Failed to fetch profiles row:", profileErr.message);
      } else {
        profile = profileData ?? null;
        role = resolveRole({
          metadataRole: [appRole, userRoleMeta],
          metadataIsAdmin: [appIsAdmin, userIsAdmin],
          profileRole: profileData?.role ?? null,
          profileIsAdmin: profileData?.is_admin ?? null,
        });
      }

      const adminRoleQuery = await supabase
        .from("admin_roles")
        .select("role, organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!adminRoleQuery.error && adminRoleQuery.data) {
        adminRole = adminRoleQuery.data.role;
        role = adminRole;
        profile = {
          ...(profile ?? {}),
          organization_id: adminRoleQuery.data.organization_id ?? profile?.organization_id ?? null,
        };
      } else {
        if (adminRoleQuery.error && !isRecoverableAdminRoleError(adminRoleQuery.error)) {
          console.warn("Failed to fetch admin_roles row:", adminRoleQuery.error.message);
        } else if (adminRoleQuery.error) {
          console.warn("Recovering from admin_roles lookup failure:", adminRoleQuery.error.message);
        }

        if (
          profile?.role &&
          ["admin", "super_admin", "org_admin"].includes(String(profile.role).toLowerCase())
        ) {
          adminRole = profile.role;
          role = profile.role;
        }
      }

      const result = { user, role, adminRole, profile };
      cachedProfileRoleUserId = user.id;
      cachedProfileRoleResult = result;
      cachedProfileRoleAt = Date.now();
      return result;
    })();

    try {
      return await inFlightProfileRolePromise;
    } finally {
      inFlightProfileRolePromise = null;
      inFlightProfileRoleUserId = null;
    }
  } catch (err) {
    console.error("getUserProfileAndRole error:", err);
    resetUserProfileRoleCache();
    return { user: null, role: null, adminRole: null, profile: null };
  }
};

export const getUserOrgMemberships = async (userId) => {
  const activeUserId = userId || (await getCurrentAuthUser())?.id;
  if (!activeUserId) return [];

  const buildMembership = (membership, organization) => {
    const normalizedRole = String(
      membership.org_role_key || membership.role || "contributor",
    ).trim().toLowerCase();
    const role = normalizedRole === "member" ? "contributor" : normalizedRole;
    return {
      id: membership.id,
      organizationId: membership.organization_id,
      role,
      status: membership.status || "active",
      permissions: membership.permissions && typeof membership.permissions === "object"
        ? membership.permissions
        : {},
      brandProjectIds: Array.isArray(membership.brand_project_ids)
        ? membership.brand_project_ids
        : null,
      creditsUsedThisPeriod: Number(membership.credits_used_this_period || 0),
      joinedAt: membership.joined_at || null,
      organization: organization
        ? {
            id: organization.id,
            name: organization.name || "Organization",
            slug: organization.slug || null,
            logoUrl: organization.logo_url || organization.avatar_url || null,
            brandColor: organization.brand_color || "#6366f1",
            planKey: organization.plan_key || organization.plan || "organization",
            status: organization.status || "active",
          }
        : null,
    };
  };

  // Fast path: one round-trip via an embedded join (memberships + organizations).
  const embedded = await fetchWithSelectVariants(
    "organization_members",
    ORG_MEMBERSHIP_EMBED_VARIANTS,
    (query) => query
      .eq("user_id", activeUserId)
      .eq("status", "active")
      .order("joined_at", { ascending: true }),
  );

  if (!embedded.error && Array.isArray(embedded.data)) {
    const rows = embedded.data;
    const hasOrgIds = rows.some((r) => r.organization_id);
    const joinReturnedData = rows.some((r) => {
      const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
      return Boolean(org);
    });
    // Only trust the embed if the org join actually returned rows (RLS can null it out).
    if (!hasOrgIds || joinReturnedData) {
      return rows.map((r) => {
        const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
        return buildMembership(r, org || null);
      });
    }
  }

  // Fallback: two-hop (membership list, then organizations) — resilient to embed FK/RLS gaps.
  const membershipResult = await fetchWithSelectVariants(
    "organization_members",
    ORG_MEMBERSHIP_SELECT_VARIANTS,
    (query) => query
      .eq("user_id", activeUserId)
      .eq("status", "active")
      .order("joined_at", { ascending: true }),
  );

  if (membershipResult.error) {
    if (!isRecoverableOrgLookupError(membershipResult.error)) {
      console.warn("Failed to fetch organization_members rows:", membershipResult.error.message);
    }
    return [];
  }

  const memberships = Array.isArray(membershipResult.data) ? membershipResult.data : [];
  const organizationIds = [
    ...new Set(memberships.map((item) => item.organization_id).filter(Boolean)),
  ];

  let organizationMap = new Map();
  if (organizationIds.length > 0) {
    const orgResult = await fetchWithSelectVariants(
      "organizations",
      ORG_SELECT_VARIANTS,
      (query) => query.in("id", organizationIds),
    );

    if (orgResult.error) {
      if (!isRecoverableOrgLookupError(orgResult.error)) {
        console.warn("Failed to fetch organizations rows:", orgResult.error.message);
      }
    } else {
      organizationMap = new Map(
        (Array.isArray(orgResult.data) ? orgResult.data : []).map((organization) => [organization.id, organization]),
      );
    }
  }

  return memberships.map((membership) =>
    buildMembership(membership, organizationMap.get(membership.organization_id) || null),
  );
};
