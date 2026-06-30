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
    || message.includes('function')
    || message.includes('pgrst')
  );
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeChannelRow(row) {
  if (!row) return null;

  return {
    ...row,
    channel_type: row.channel_type || 'group',
    member_ids: Array.isArray(row.member_ids) ? row.member_ids.filter(Boolean) : null,
    group_admin_user_id: row.group_admin_user_id || null,
    max_members: Number.isFinite(Number(row.max_members)) ? Number(row.max_members) : null,
    is_ai_enabled: row.is_ai_enabled !== false,
    unread_count: Number(row.unread_count || 0),
    last_message_at: row.last_message_at || null,
    last_message_preview: row.last_message_preview || '',
    scope: row.brand_project_id ? 'brand' : 'org',
  };
}

function normalizeMemberIds(memberIds = []) {
  return [...new Set(safeArray(memberIds).filter(Boolean))];
}

function toEdgeFunctionError(error, functionName) {
  const message = String(error?.message || '').toLowerCase();
  const status = error?.context?.status || error?.response?.status || null;

  if (error?.name === 'FunctionsFetchError' || message.includes('failed to send a request')) {
    throw new Error(
      `Could not reach the \`${functionName}\` Edge Function. This usually means the function is not deployed to the active Supabase project or failed before responding.`,
    );
  }

  if (status === 404) {
    throw new Error(`The \`${functionName}\` Edge Function is not deployed to this Supabase project.`);
  }

  if (status === 401 || status === 403) {
    throw new Error(`You do not have permission to use the \`${functionName}\` Edge Function.`);
  }

  throw error;
}

async function fetchRawChannels({ organizationId, brandProjectId = null }) {
  let query = supabase
    .from('common_room_channels')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_archived', false)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[commonRoomService] failed to fetch channels:', error.message);
    }
    return [];
  }

  return safeArray(data).map((row) => normalizeChannelRow({
    ...row,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: '',
  })).filter(Boolean);
}

export async function fetchChannels({ organizationId, brandProjectId = null }) {
  if (!organizationId) return [];

  const { data, error } = await supabase.rpc('get_common_room_channel_summaries', {
    p_organization_id: organizationId,
    p_brand_project_id: brandProjectId,
  });

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[commonRoomService] failed to fetch channel summaries:', error.message);
    }
    return fetchRawChannels({ organizationId, brandProjectId });
  }

  return safeArray(data).map(normalizeChannelRow).filter(Boolean);
}

export async function fetchMessages(channelId) {
  if (!channelId || !isUuidLike(channelId)) return [];

  const { data, error } = await supabase
    .from('common_room_messages')
    .select('*')
    .eq('channel_id', channelId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[commonRoomService] failed to fetch messages:', error.message);
    }
    return [];
  }

  return safeArray(data);
}

export async function sendMessage(payload) {
  const { data, error } = await supabase
    .from('common_room_messages')
    .insert({
      ...payload,
      metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function createChannel({
  organizationId,
  brandProjectId = null,
  createdBy = null,
  name,
  description = '',
  scope = 'org',
  channelType = 'group',
  memberIds = [],
  groupAdminUserId = null,
  isAiEnabled = true,
  maxMembers = null,
}) {
  if (!organizationId) {
    throw new Error('An organization is required.');
  }

  const normalizedMemberIds = normalizeMemberIds(memberIds);
  const payload = {
    organization_id: organizationId,
    brand_project_id: scope === 'brand' ? brandProjectId : null,
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    channel_type: channelType || 'group',
    created_by: createdBy,
    member_ids: channelType === 'private_group'
      ? normalizeMemberIds([...normalizedMemberIds, groupAdminUserId || createdBy].filter(Boolean))
      : null,
    group_admin_user_id: channelType === 'private_group' ? (groupAdminUserId || createdBy || null) : null,
    is_ai_enabled: Boolean(isAiEnabled),
    max_members: channelType === 'private_group' && maxMembers ? Number(maxMembers) : null,
  };

  if (!payload.name) {
    throw new Error('A channel name is required.');
  }

  if (
    payload.max_members
    && normalizeMemberIds(payload.member_ids).length > Number(payload.max_members)
  ) {
    throw new Error('Member limit cannot be lower than the selected group size.');
  }

  const { data, error } = await supabase
    .from('common_room_channels')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeChannelRow({
    ...data,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: '',
  });
}

export async function updateChannel(channelId, updates = {}) {
  if (!channelId) {
    throw new Error('A channel id is required.');
  }

  const payload = { ...updates };

  if (Object.prototype.hasOwnProperty.call(payload, 'scope')) {
    payload.brand_project_id = payload.scope === 'brand' ? payload.brandProjectId || null : null;
    delete payload.scope;
    delete payload.brandProjectId;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    payload.name = String(payload.name || '').trim();
    if (!payload.name) {
      throw new Error('A channel name is required.');
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    payload.description = String(payload.description || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'channelType')) {
    payload.channel_type = payload.channelType || 'group';
    delete payload.channelType;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'memberIds')) {
    payload.member_ids = normalizeMemberIds(payload.memberIds);
    delete payload.memberIds;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'groupAdminUserId')) {
    payload.group_admin_user_id = payload.groupAdminUserId || null;
    delete payload.groupAdminUserId;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'isAiEnabled')) {
    payload.is_ai_enabled = Boolean(payload.isAiEnabled);
    delete payload.isAiEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'maxMembers')) {
    payload.max_members = payload.maxMembers ? Number(payload.maxMembers) : null;
    delete payload.maxMembers;
  }

  if (
    payload.channel_type === 'private_group'
    && payload.max_members
    && normalizeMemberIds(payload.member_ids).length > Number(payload.max_members)
  ) {
    throw new Error('Member limit cannot be lower than the selected group size.');
  }

  const { data, error } = await supabase
    .from('common_room_channels')
    .update(payload)
    .eq('id', channelId)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeChannelRow({
    ...data,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: '',
  });
}

export async function archiveChannel(channelId) {
  if (!channelId) {
    throw new Error('A channel id is required.');
  }

  const { data, error } = await supabase
    .from('common_room_channels')
    .update({ is_archived: true })
    .eq('id', channelId)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeChannelRow({
    ...data,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: '',
  });
}

export async function leaveChannel(channelId) {
  if (!channelId) {
    throw new Error('A channel id is required.');
  }

  const { data, error } = await supabase.rpc('common_room_leave_channel', {
    p_channel_id: channelId,
  });

  if (error) throw error;
  return normalizeChannelRow({
    ...data,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: '',
  });
}

async function resolveCurrentUserId(explicitUserId = null) {
  if (explicitUserId) return explicitUserId;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.id || null;
}

export async function markChannelRead({
  channelId,
  organizationId,
  lastReadMessageId = null,
  lastReadAt = null,
  userId = null,
}) {
  if (!channelId || !organizationId) {
    throw new Error('Channel and organization are required to mark read state.');
  }

  const resolvedUserId = await resolveCurrentUserId(userId);
  if (!resolvedUserId) {
    throw new Error('You must be signed in to update read state.');
  }

  const payload = {
    channel_id: channelId,
    organization_id: organizationId,
    user_id: resolvedUserId,
    last_read_message_id: lastReadMessageId,
    last_read_at: lastReadAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('common_room_channel_reads')
    .upsert(payload, {
      onConflict: 'channel_id,user_id',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function requestAiChannelReply(payload) {
  const { data, error } = await supabase.functions.invoke('ai-org-chat', {
    body: payload,
  });

  if (error) {
    toEdgeFunctionError(error, 'ai-org-chat');
  }
  return data;
}
