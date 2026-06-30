import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import {
  fetchOrganizationContext,
  recordOrgMemberActivity,
  updateLastUsedContext,
} from '../services/orgService';
import {
  clearOrgRuntimeContext,
  setOrgRuntimeContext,
} from '../stores/orgRuntimeStore';

const OrgContext = createContext(null);

export function OrgContextProvider({ children, orgId }) {
  const { location } = useAppNavigation();
  const { user, orgMemberships = [] } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [contextState, setContextState] = useState({
    organization: null,
    membership: null,
    role: null,
    permissions: {},
    brandProjects: [],
    activeBrandProject: null,
    isMember: false,
    isOrgAdmin: false,
    isOrgOwner: false,
    isAgency: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user?.id || !orgId) {
        setContextState({
          organization: null,
          membership: null,
          role: null,
          permissions: {},
          brandProjects: [],
          activeBrandProject: null,
          isMember: false,
          isOrgAdmin: false,
          isOrgOwner: false,
          isAgency: false,
        });
        clearOrgRuntimeContext('org-provider');
        setLoading(false);
        return;
      }

      setLoading(true);

      const membershipHint = orgMemberships.find((membership) => membership.organizationId === orgId) || null;
      const nextState = await fetchOrganizationContext({
        organizationId: orgId,
        userId: user.id,
        membershipHint,
      });

      if (cancelled) return;

      setContextState(nextState);

      if (nextState?.isMember) {
        setOrgRuntimeContext({
          organizationId: orgId,
          brandProjectId: nextState.activeBrandProject?.id || null,
          organization: nextState.organization,
          brandProject: nextState.activeBrandProject,
          role: nextState.role,
          permissions: nextState.permissions,
          source: 'org-provider',
        });

        updateLastUsedContext({
          userId: user.id,
          contextType: 'organization',
          organizationId: orgId,
          brandProjectId: nextState.activeBrandProject?.id || null,
        }).catch(() => {});

        recordOrgMemberActivity({
          organizationId: orgId,
          userId: user.id,
        }).catch(() => {});
      } else {
        clearOrgRuntimeContext('org-provider');
      }

      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
      clearOrgRuntimeContext('org-provider');
    };
  }, [orgId, orgMemberships, refreshKey, user?.id]);

  const setActiveBrandProjectId = async (brandProjectId) => {
    const nextBrandProject = contextState.brandProjects.find((item) => item.id === brandProjectId) || null;

    setContextState((current) => ({
      ...current,
      activeBrandProject: nextBrandProject,
    }));

    setOrgRuntimeContext({
      organizationId: orgId,
      brandProjectId: nextBrandProject?.id || null,
      organization: contextState.organization,
      brandProject: nextBrandProject,
      role: contextState.role,
      permissions: contextState.permissions,
      source: 'org-provider',
    });

    if (user?.id) {
      await updateLastUsedContext({
        userId: user.id,
        contextType: 'organization',
        organizationId: orgId,
        brandProjectId: nextBrandProject?.id || null,
      });
    }
  };

  const refresh = () => {
    setRefreshKey((value) => value + 1);
  };

  const value = useMemo(() => ({
    ...contextState,
    organizationId: orgId || null,
    brandProjectId: contextState.activeBrandProject?.id || null,
    loading,
    refresh,
    setActiveBrandProjectId,
    location,
    hasPermission: (permissionKey) => Boolean(contextState.permissions?.[permissionKey]),
  }), [contextState, loading, location, orgId]);

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrgContextValue() {
  return useContext(OrgContext);
}
