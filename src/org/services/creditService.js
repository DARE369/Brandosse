import { supabase } from '../../services/supabaseClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatProfileLabel(profile, fallback) {
  if (!profile) return fallback;
  return profile.full_name || profile.email || fallback;
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

export async function fetchCreditRequests(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('credit_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[creditService] failed to fetch credit requests:', error.message);
    }
    return [];
  }

  const requests = safeArray(data);
  const userIds = [...new Set(
    requests
      .flatMap((request) => [request.requested_by, request.reviewed_by])
      .filter(Boolean),
  )];

  let profileMap = new Map();
  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    if (profileError) {
      console.warn('[creditService] could not resolve profile names for credit requests:', profileError.message);
    } else {
      profileMap = new Map(safeArray(profileRows).map((row) => [row.id, row]));
    }
  }

  return requests.map((request) => ({
    ...request,
    requested_by_profile: profileMap.get(request.requested_by) || null,
    reviewed_by_profile: profileMap.get(request.reviewed_by) || null,
    requested_by_label: formatProfileLabel(profileMap.get(request.requested_by), request.requested_by || 'Unknown requester'),
    reviewed_by_label: request.reviewed_by
      ? formatProfileLabel(profileMap.get(request.reviewed_by), request.reviewed_by)
      : null,
  }));
}

export async function createCreditRequest(payload) {
  const { data, error } = await supabase
    .from('credit_requests')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function reviewCreditRequest(payload) {
  const { data, error } = await supabase.functions.invoke('credit-request-action', {
    body: payload,
  });

  if (error) throw error;
  return data;
}
