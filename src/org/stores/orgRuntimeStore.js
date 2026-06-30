import { create } from 'zustand';

export const EMPTY_ORG_RUNTIME_CONTEXT = {
  organizationId: null,
  brandProjectId: null,
  organization: null,
  brandProject: null,
  role: null,
  permissions: {},
  source: null,
};

function normalizeContext(context = {}) {
  if (!context) return { ...EMPTY_ORG_RUNTIME_CONTEXT };

  return {
    ...EMPTY_ORG_RUNTIME_CONTEXT,
    ...context,
    organizationId: context.organizationId ?? context.organization_id ?? null,
    brandProjectId: context.brandProjectId ?? context.brand_project_id ?? null,
  };
}

const useOrgRuntimeStore = create((set) => ({
  context: { ...EMPTY_ORG_RUNTIME_CONTEXT },
  setContext: (context) => set({ context: normalizeContext(context) }),
  clearContext: () => set({ context: { ...EMPTY_ORG_RUNTIME_CONTEXT } }),
}));

export function getOrgRuntimeContext() {
  return useOrgRuntimeStore.getState().context;
}

export function setOrgRuntimeContext(context) {
  useOrgRuntimeStore.getState().setContext(context);
}

export function clearOrgRuntimeContext(source = null) {
  const current = useOrgRuntimeStore.getState().context;
  if (source && current.source && current.source !== source) {
    return;
  }
  useOrgRuntimeStore.getState().clearContext();
}

export default useOrgRuntimeStore;
