import { useMemo } from 'react';
import { useOrgContext } from './useOrgContext';

export function useBrandContext() {
  const { organization, activeBrandProject } = useOrgContext();

  return useMemo(() => ({
    organizationName: organization?.name || 'Organization',
    organizationColor: organization?.brandColor || '#6366f1',
    brandProject: activeBrandProject,
    brandSettings: activeBrandProject?.brandSettings || {},
  }), [activeBrandProject, organization?.brandColor, organization?.name]);
}

export default useBrandContext;
