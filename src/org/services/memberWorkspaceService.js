import { supabase } from '../../services/supabaseClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMissingRelationError(error) {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('relation')
    || message.includes('column')
    || message.includes('pgrst')
  );
}

function normalizeState(row, organizationId, userId) {
  return {
    id: row?.id || null,
    organization_id: organizationId || row?.organization_id || null,
    user_id: userId || row?.user_id || null,
    dismissed_action_keys: safeArray(row?.dismissed_action_keys).filter(Boolean),
    team_pulse_collapsed: Boolean(row?.team_pulse_collapsed),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export async function fetchOrgMemberDashboardState({ organizationId, userId }) {
  if (!organizationId || !userId) {
    return normalizeState(null, organizationId, userId);
  }

  const { data, error } = await supabase
    .from('org_member_dashboard_state')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelationError(error)) throw error;
    return normalizeState(null, organizationId, userId);
  }
  return normalizeState(data, organizationId, userId);
}

export async function saveOrgMemberDashboardState({
  organizationId,
  userId,
  dismissedActionKeys = [],
  teamPulseCollapsed = false,
}) {
  if (!organizationId || !userId) {
    throw new Error('Organization and user are required.');
  }

  const { data, error } = await supabase
    .from('org_member_dashboard_state')
    .upsert({
      organization_id: organizationId,
      user_id: userId,
      dismissed_action_keys: [...new Set(safeArray(dismissedActionKeys).filter(Boolean))],
      team_pulse_collapsed: Boolean(teamPulseCollapsed),
    }, {
      onConflict: 'organization_id,user_id',
    })
    .select('*')
    .single();

  if (error) {
    if (!isMissingRelationError(error)) throw error;
    return normalizeState({
      organization_id: organizationId,
      user_id: userId,
      dismissed_action_keys: dismissedActionKeys,
      team_pulse_collapsed: teamPulseCollapsed,
    }, organizationId, userId);
  }
  return normalizeState(data, organizationId, userId);
}
