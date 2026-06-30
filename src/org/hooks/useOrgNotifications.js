import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../Context/AuthContext';
import useOrgContext from './useOrgContext';
import {
  dismissOrgNotification,
  fetchOrgNotifications,
  markAllOrgNotificationsRead,
  markOrgNotificationsRead,
  runOrgNotificationReminderSweep,
  snoozeOrgNotification,
} from '../services/orgNotificationService';

const REMINDER_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function countUnread(notification) {
  return Number(notification?.unread_count || 0);
}

function mapNotificationList(notifications, mapper) {
  return (Array.isArray(notifications) ? notifications : []).map((notification) => (
    mapper(notification) || notification
  ));
}

export default function useOrgNotifications() {
  const { user } = useAuth();
  const { organizationId, brandProjectId } = useOrgContext();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!organizationId || !user?.id) {
      setNotifications([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    try {
      const nextNotifications = await fetchOrgNotifications({
        organizationId,
        brandProjectId,
        userId: user.id,
      });
      setNotifications(nextNotifications);
      setError('');
      return nextNotifications;
    } catch (nextError) {
      setNotifications([]);
      setError(nextError?.message || 'Failed to load notifications.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [brandProjectId, organizationId, user?.id]);

  const runSweep = useCallback(async () => {
    if (!organizationId) return 0;

    try {
      const inserted = await runOrgNotificationReminderSweep(organizationId);
      if (inserted > 0) {
        await refresh();
      }
      return inserted;
    } catch (nextError) {
      console.warn('[useOrgNotifications] reminder sweep warning:', nextError?.message || nextError);
      return 0;
    }
  }, [organizationId, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void runSweep();

    if (!organizationId) return undefined;
    const intervalId = window.setInterval(() => {
      void runSweep();
    }, REMINDER_SWEEP_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [organizationId, runSweep]);

  useEffect(() => {
    if (!organizationId || !user?.id) return undefined;

    const channel = supabase
      .channel(`org-notifications-${organizationId}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'common_room_messages',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'common_room_channel_reads',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, refresh, user?.id]);

  const markOneRead = useCallback(async (notificationId) => {
    if (!notificationId) return;

    try {
      setNotifications((current) => mapNotificationList(current, (notification) => {
        if (notification.id !== notificationId || notification.source !== 'user_notification') {
          return notification;
        }

        return {
          ...notification,
          is_read: true,
          read_at: new Date().toISOString(),
          unread_count: 0,
        };
      }));

      await markOrgNotificationsRead({
        notificationIds: [notificationId],
        userId: user?.id,
      });
    } catch (nextError) {
      console.warn('[useOrgNotifications] markOneRead warning:', nextError?.message || nextError);
      await refresh();
    }
  }, [refresh, user?.id]);

  const markAllRead = useCallback(async () => {
    try {
      setNotifications((current) => current.map((notification) => (
        notification.source === 'user_notification'
          ? {
            ...notification,
            is_read: true,
            read_at: notification.read_at || new Date().toISOString(),
            unread_count: 0,
          }
          : notification
      )));

      await markAllOrgNotificationsRead({
        organizationId,
        userId: user?.id,
      });
    } catch (nextError) {
      console.warn('[useOrgNotifications] markAllRead warning:', nextError?.message || nextError);
      await refresh();
    }
  }, [organizationId, refresh, user?.id]);

  const snoozeOneDay = useCallback(async (notificationId) => {
    try {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const success = await snoozeOrgNotification({
        notificationId,
        userId: user?.id,
        until,
      });

      if (success) {
        setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      }
    } catch (nextError) {
      console.warn('[useOrgNotifications] snoozeOneDay warning:', nextError?.message || nextError);
      await refresh();
    }
  }, [refresh, user?.id]);

  const dismissOne = useCallback(async (notificationId) => {
    try {
      const success = await dismissOrgNotification({
        notificationId,
        userId: user?.id,
      });

      if (success) {
        setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      }
    } catch (nextError) {
      console.warn('[useOrgNotifications] dismissOne warning:', nextError?.message || nextError);
      await refresh();
    }
  }, [refresh, user?.id]);

  const acknowledgeCommonRoom = useCallback((notificationId) => {
    setNotifications((current) => mapNotificationList(current, (notification) => {
      if (notification.id !== notificationId || notification.source !== 'common_room') {
        return notification;
      }

      return {
        ...notification,
        unread_count: 0,
      };
    }).filter((notification) => countUnread(notification) > 0 || notification.source !== 'common_room'));
  }, []);

  const unreadCount = useMemo(
    () => notifications.reduce((total, notification) => total + countUnread(notification), 0),
    [notifications],
  );

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    runSweep,
    markOneRead,
    markAllRead,
    snoozeOneDay,
    dismissOne,
    acknowledgeCommonRoom,
  };
}
