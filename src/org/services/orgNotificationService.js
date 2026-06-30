import { supabase } from '../../services/supabaseClient';
import { fetchChannels } from './commonRoomService';
import { buildDeepLink } from '../../utils/buildDeepLink';

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

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toIsoOrNull(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const nextDate = new Date(normalized);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate.toISOString();
}

function isSnoozed(row) {
  const snoozedUntil = toIsoOrNull(row?.snoozed_until);
  if (!snoozedUntil) return false;
  return new Date(snoozedUntil).getTime() > Date.now();
}

function normalizeUserNotification(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  return {
    id: row?.id || null,
    source: 'user_notification',
    title: row?.title || row?.subject || 'Notification',
    body: String(row?.body || '').trim(),
    type: row?.type || 'system',
    requested_type: metadata?.requested_type || row?.type || 'system',
    metadata,
    created_at: row?.created_at || null,
    read_at: row?.read_at || null,
    is_read: Boolean(row?.is_read),
    action_url: normalizeText(row?.action_url),
    dismissed_at: toIsoOrNull(row?.dismissed_at),
    snoozed_until: toIsoOrNull(row?.snoozed_until),
    dedupe_key: normalizeText(row?.dedupe_key),
    unread_count: Boolean(row?.is_read) ? 0 : 1,
  };
}

function buildCommonRoomNotification(channel, organizationId) {
  const unreadCount = Number(channel?.unread_count || 0);
  if (!channel?.id || unreadCount <= 0) return null;

  return {
    id: `common-room:${channel.id}`,
    source: 'common_room',
    title: `New activity in ${channel.name || 'Common Room'}`,
    body: channel.last_message_preview || 'Unread messages are waiting in Common Room.',
    type: 'common_room',
    requested_type: 'org_common_room_activity',
    metadata: {
      channel_id: channel.id,
      unread_count: unreadCount,
      channel_type: channel.channel_type || 'group',
    },
    created_at: channel.last_message_at || channel.updated_at || channel.created_at || null,
    read_at: null,
    is_read: false,
    action_url: `/app/org/${organizationId}/common-room/${channel.id}`,
    dismissed_at: null,
    snoozed_until: null,
    dedupe_key: null,
    unread_count: unreadCount,
  };
}

function sortNotifications(left, right) {
  const leftUnread = Number(left?.unread_count || 0);
  const rightUnread = Number(right?.unread_count || 0);

  if ((rightUnread > 0) !== (leftUnread > 0)) {
    return rightUnread > 0 ? 1 : -1;
  }

  return new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime();
}

export function resolveOrgNotificationTarget(notification, organizationId) {
  const actionUrl = normalizeText(notification?.action_url);
  if (actionUrl) {
    if (/^https?:\/\//i.test(actionUrl)) {
      return { external: true, href: actionUrl };
    }

    return { external: false, path: actionUrl };
  }

  const metadata = notification?.metadata && typeof notification.metadata === 'object'
    ? notification.metadata
    : {};

  if (metadata.channel_id) {
    return {
      external: false,
      path: `/app/org/${organizationId}/common-room/${metadata.channel_id}`,
    };
  }

  if (metadata.task_id) {
    const deepLink = buildDeepLink({
      path: `/app/org/${organizationId}/calendar`,
      source: 'org_notification',
      target: 'org_task',
      params: { taskId: metadata.task_id },
    });
    return {
      external: false,
      path: deepLink.path,
      state: deepLink.state,
    };
  }

  if (metadata.pipeline_item_id) {
    const deepLink = buildDeepLink({
      path: `/app/org/${organizationId}/pipeline`,
      source: 'org_notification',
      target: 'org_pipeline_item',
      params: { pipelineItemId: metadata.pipeline_item_id },
    });
    return {
      external: false,
      path: deepLink.path,
      state: deepLink.state,
    };
  }

  if (metadata.post_id) {
    const deepLink = buildDeepLink({
      path: `/app/org/${organizationId}/calendar`,
      source: 'org_notification',
      target: 'org_post',
      params: { postId: metadata.post_id },
    });
    return {
      external: false,
      path: deepLink.path,
      state: deepLink.state,
    };
  }

  return {
    external: false,
    path: `/app/org/${organizationId}/workspace`,
  };
}

export async function fetchOrgNotifications({
  organizationId,
  brandProjectId = null,
  userId,
  limit = 40,
}) {
  if (!organizationId || !userId) return [];

  const [notificationResult, channels] = await Promise.all([
    supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit),
    fetchChannels({ organizationId, brandProjectId }).catch(() => []),
  ]);

  if (notificationResult.error) {
    if (!isMissingRelationError(notificationResult.error)) {
      throw notificationResult.error;
    }
  }

  const persisted = safeArray(notificationResult.data)
    .map(normalizeUserNotification)
    .filter((notification) => notification.id)
    .filter((notification) => !notification.dismissed_at)
    .filter((notification) => !isSnoozed(notification));

  const commonRoom = safeArray(channels)
    .map((channel) => buildCommonRoomNotification(channel, organizationId))
    .filter(Boolean);

  return [...persisted, ...commonRoom]
    .sort(sortNotifications)
    .slice(0, limit);
}

export async function markOrgNotificationsRead({
  notificationIds = [],
  userId,
}) {
  const ids = [...new Set(safeArray(notificationIds).filter((id) => !String(id || '').startsWith('common-room:')))];
  if (!userId || ids.length === 0) return 0;

  const { error } = await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .in('id', ids);

  if (error) throw error;
  return ids.length;
}

export async function markAllOrgNotificationsRead({
  organizationId,
  userId,
}) {
  if (!organizationId || !userId) return 0;

  const { error } = await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('is_read', false)
    .is('dismissed_at', null);

  if (error) throw error;
  return 0;
}

export async function snoozeOrgNotification({
  notificationId,
  userId,
  until,
}) {
  if (!notificationId || !userId || String(notificationId).startsWith('common-room:')) return false;

  const { error } = await supabase
    .from('user_notifications')
    .update({
      is_read: true,
      snoozed_until: until,
    })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }

  return true;
}

export async function dismissOrgNotification({
  notificationId,
  userId,
}) {
  if (!notificationId || !userId || String(notificationId).startsWith('common-room:')) return false;

  const { error } = await supabase
    .from('user_notifications')
    .update({
      dismissed_at: new Date().toISOString(),
      is_read: true,
    })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }

  return true;
}

export async function runOrgNotificationReminderSweep(organizationId) {
  if (!organizationId) return 0;

  const { data, error } = await supabase.rpc('enqueue_org_notification_reminders', {
    p_organization_id: organizationId,
  });

  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }

  return Number(data || 0);
}
