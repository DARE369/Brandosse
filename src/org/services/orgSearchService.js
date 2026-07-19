import { supabase } from '../../services/supabaseClient';
import { normalizeEdgeFunctionError } from '../../services/edgeFunctionClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function searchOrganizationWorkspace({
  organizationId,
  brandProjectId = null,
  query,
}) {
  const normalizedQuery = String(query || '').trim();
  if (!organizationId || normalizedQuery.length < 2) {
    return {
      query: normalizedQuery,
      groups: {
        pipeline_items: [],
        org_tasks: [],
        drafts: [],
        calendar_posts: [],
        assets: [],
      },
    };
  }

  const { data, error } = await supabase.functions.invoke('org-global-search', {
    body: {
      organization_id: organizationId,
      brand_project_id: brandProjectId || null,
      query: normalizedQuery,
    },
  });

  if (error) {
    throw await normalizeEdgeFunctionError(error, 'org-global-search');
  }

  const groups = safeObject(data?.groups);
  return {
    query: normalizedQuery,
    groups: {
      pipeline_items: safeArray(groups.pipeline_items),
      org_tasks: safeArray(groups.org_tasks),
      drafts: safeArray(groups.drafts),
      calendar_posts: safeArray(groups.calendar_posts),
      assets: safeArray(groups.assets),
    },
  };
}
