// src/services/historyLoader.js
import { supabase } from '../services/supabaseClient';

function normalizeWorkspaceScope(scope = {}) {
  if (scope?.organizationId) {
    return {
      workspaceType: 'organization',
      organizationId: scope.organizationId,
      brandProjectId: scope.brandProjectId || null,
    };
  }

  return {
    workspaceType: 'personal',
    organizationId: null,
    brandProjectId: null,
  };
}

export async function loadUserHistory(userId, limit = 10, workspaceScope = {}) {
  const scope = normalizeWorkspaceScope(workspaceScope);

  let query = supabase
    .from('generations')
    .select('prompt, media_type, metadata, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed');

  if (scope.workspaceType === 'organization') {
    query = query.eq('organization_id', scope.organizationId);
  } else {
    query = query.is('organization_id', null);
  }

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data?.length) return '';

  const items = data
    .map(g => `- ${g.media_type ?? 'image'}: "${(g.prompt ?? '').slice(0, 100)}"`)
    .join('\n');

  return `Recent generations by this user:\n${items}`;
}
