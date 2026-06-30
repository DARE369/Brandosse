import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../Context/AuthContext';
import { supabase } from '../../services/supabaseClient';
import { fetchOrganizationMembers } from '../services/orgService';
import {
  archiveChannel as archiveChannelRequest,
  createChannel as createChannelRequest,
  fetchChannels,
  fetchMessages,
  leaveChannel as leaveChannelRequest,
  markChannelRead as markChannelReadRequest,
  requestAiChannelReply,
  sendMessage as sendMessageRequest,
  updateChannel as updateChannelRequest,
} from '../services/commonRoomService';
import { useOrgContext } from './useOrgContext';

function appendUniqueMessage(current, created) {
  if (!created?.id) return current;
  if (current.some((message) => message.id === created.id)) {
    return current;
  }
  return [...current, created];
}

export function useCommonRoom(activeChannelId = null) {
  const { organizationId, brandProjectId } = useOrgContext();
  const { user } = useAuth();
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState('');
  const lastMarkedReadRef = useRef('');

  const refreshChannels = useCallback(async () => {
    if (!organizationId) {
      setChannels([]);
      return [];
    }

    const nextChannels = await fetchChannels({ organizationId, brandProjectId });
    setChannels(nextChannels);
    return nextChannels;
  }, [brandProjectId, organizationId]);

  const refreshMembers = useCallback(async () => {
    if (!organizationId) {
      setMembers([]);
      return [];
    }

    const nextMembers = await fetchOrganizationMembers(organizationId);
    setMembers(nextMembers);
    return nextMembers;
  }, [organizationId]);

  const refreshMessages = useCallback(async (channelIdOverride = activeChannelId) => {
    if (!channelIdOverride) {
      setMessages([]);
      setMessageLoading(false);
      return [];
    }

    setMessageLoading(true);
    const nextMessages = await fetchMessages(channelIdOverride);
    setMessages(nextMessages);
    setMessageLoading(false);
    return nextMessages;
  }, [activeChannelId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!organizationId) {
        setChannels([]);
        setMembers([]);
        setMessages([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [nextChannels, nextMembers] = await Promise.all([
          fetchChannels({ organizationId, brandProjectId }),
          fetchOrganizationMembers(organizationId),
        ]);

        if (!cancelled) {
          setChannels(nextChannels);
          setMembers(nextMembers);
          setError('');
        }
      } catch (nextError) {
        if (!cancelled) {
          setChannels([]);
          setMembers([]);
          setError(nextError?.message || 'Failed to load Common Room');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [brandProjectId, organizationId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      if (!activeChannelId) {
        setMessages([]);
        setMessageLoading(false);
        return;
      }

      setMessageLoading(true);
      try {
        const nextMessages = await fetchMessages(activeChannelId);
        if (!cancelled) {
          setMessages(nextMessages);
          setError('');
        }
      } catch (nextError) {
        if (!cancelled) {
          setMessages([]);
          setError(nextError?.message || 'Failed to load messages');
        }
      } finally {
        if (!cancelled) {
          setMessageLoading(false);
        }
      }
    }

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  useEffect(() => {
    if (!organizationId) return undefined;

    const realtimeChannel = supabase
      .channel(`org-common-room-${organizationId}-${user?.id || 'anon'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'common_room_channels',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refreshChannels();
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
        async (payload) => {
          const changedChannelId = payload.new?.channel_id || payload.old?.channel_id || null;
          await refreshChannels();
          if (changedChannelId && changedChannelId === activeChannelId) {
            await refreshMessages(changedChannelId);
          }
        },
      );

    if (user?.id) {
      realtimeChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'common_room_channel_reads',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await refreshChannels();
        },
      );
    }

    realtimeChannel.subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [activeChannelId, organizationId, refreshChannels, refreshMessages, user?.id]);

  useEffect(() => {
    if (!organizationId || !user?.id || !activeChannelId || messageLoading || messages.length === 0) {
      return;
    }

    const newestMessage = messages[messages.length - 1];
    if (!newestMessage?.id) return;

    const nextKey = `${activeChannelId}:${newestMessage.id}:${newestMessage.created_at || ''}`;
    if (lastMarkedReadRef.current === nextKey) {
      return;
    }

    lastMarkedReadRef.current = nextKey;

    markChannelReadRequest({
      channelId: activeChannelId,
      organizationId,
      lastReadMessageId: newestMessage.id,
      lastReadAt: newestMessage.created_at || new Date().toISOString(),
      userId: user.id,
    })
      .then(() => refreshChannels())
      .catch(() => {
        lastMarkedReadRef.current = '';
      });
  }, [activeChannelId, messageLoading, messages, organizationId, refreshChannels, user?.id]);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) || null,
    [activeChannelId, channels],
  );

  return {
    channels,
    messages,
    members,
    activeChannel,
    loading,
    messageLoading,
    error,
    refreshChannels,
    refreshMessages,
    refreshMembers,
    sendMessage: async (payload) => {
      const created = await sendMessageRequest(payload);
      if (created?.channel_id === activeChannelId) {
        setMessages((current) => appendUniqueMessage(current, created));
      }
      await refreshChannels();
      return created;
    },
    createChannel: async (payload) => {
      const created = await createChannelRequest(payload);
      await refreshChannels();
      return created;
    },
    updateChannel: async (channelId, updates) => {
      const updated = await updateChannelRequest(channelId, updates);
      await refreshChannels();
      return updated;
    },
    archiveChannel: async (channelId) => {
      const archived = await archiveChannelRequest(channelId);
      await refreshChannels();
      if (channelId === activeChannelId) {
        setMessages([]);
      }
      return archived;
    },
    leaveChannel: async (channelId) => {
      const result = await leaveChannelRequest(channelId);
      await refreshChannels();
      if (channelId === activeChannelId) {
        setMessages([]);
      }
      return result;
    },
    markChannelRead: async (payload) => {
      const updated = await markChannelReadRequest({
        ...payload,
        userId: payload?.userId || user?.id || null,
      });
      await refreshChannels();
      return updated;
    },
    requestAiChannelReply: async (payload) => requestAiChannelReply(payload),
  };
}

export default useCommonRoom;
