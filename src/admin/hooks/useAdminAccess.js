import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import { ADMIN_ROLES, getAdminScopeLabel, getPermissionGroups, normalizeAdminRole } from "../utils/rbac";

export default function useAdminAccess() {
  const { user, profile, adminRole, isAdmin, loading: authLoading, accessLoading } = useAuth();
  const [state, setState] = useState({
    loading: false,
    error: null,
    organization: null,
    organizationId: null,
  });

  const normalizedAdminRole = normalizeAdminRole(adminRole || profile?.role);
  const organizationId = profile?.organization_id ?? null;

  useEffect(() => {
    let mounted = true;

    if (
      authLoading ||
      accessLoading ||
      !user ||
      normalizedAdminRole !== ADMIN_ROLES.ORG_ADMIN ||
      !organizationId
    ) {
      setState({
        loading: false,
        error: null,
        organization: null,
        organizationId,
      });
      return () => {
        mounted = false;
      };
    }

    const alreadyLoaded =
      state.organizationId === organizationId && state.organization;
    if (alreadyLoaded) {
      return () => {
        mounted = false;
      };
    }

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
      organizationId,
    }));

    async function loadOrganization() {
      try {
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name, slug, plan, status")
          .eq("id", organizationId)
          .maybeSingle();

        if (error) throw error;
        if (!mounted) return;

        setState({
          loading: false,
          error: null,
          organization: data ?? null,
          organizationId,
        });
      } catch (error) {
        if (!mounted) return;
        console.warn("Failed to resolve organization scope details:", error.message);
        setState({
          loading: false,
          error,
          organization: null,
          organizationId,
        });
      }
    }

    loadOrganization();

    return () => {
      mounted = false;
    };
  }, [
    accessLoading,
    authLoading,
    normalizedAdminRole,
    organizationId,
    state.organization,
    state.organizationId,
    user,
  ]);

  const access = useMemo(() => {
    if (!user) return null;

    const organization = normalizedAdminRole === ADMIN_ROLES.ORG_ADMIN
      ? state.organization
      : null;
    const scopeLabel = getAdminScopeLabel({
      adminRole: normalizedAdminRole,
      organization,
      isAdmin,
    });

    return {
      user,
      profile,
      isAdmin,
      adminRole: normalizedAdminRole,
      organizationId,
      organization,
      permissionGroups: getPermissionGroups(normalizedAdminRole),
      scopeLabel,
      isSuperAdmin: normalizedAdminRole === ADMIN_ROLES.SUPER_ADMIN,
      isOrgAdmin: normalizedAdminRole === ADMIN_ROLES.ORG_ADMIN,
    };
  }, [isAdmin, normalizedAdminRole, organizationId, profile, state.organization, user]);

  return {
    loading: authLoading || accessLoading || state.loading,
    error: state.error,
    access,
  };
}
