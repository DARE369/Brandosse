import { useMemo } from 'react';
import { useOrgContextValue } from '../context/OrgContextProvider';

export function useOrgContext() {
  const context = useOrgContextValue();

  return useMemo(() => (
    context || {
      organizationId: null,
      brandProjectId: null,
      organization: null,
      membership: null,
      role: null,
      permissions: {},
      brandProjects: [],
      activeBrandProject: null,
      loading: false,
      refresh: () => {},
      setActiveBrandProjectId: () => {},
      hasPermission: () => false,
      isMember: false,
      isOrgAdmin: false,
      isOrgOwner: false,
      isAgency: false,
    }
  ), [context]);
}

export default useOrgContext;
