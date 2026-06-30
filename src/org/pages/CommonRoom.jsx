"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Crown,
  Hash,
  Loader2,
  Lock,
  MessagesSquare,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Upload,
  UserMinus,
  Workflow,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import CommonRoomAssetPicker from '../components/common-room/CommonRoomAssetPicker';
import CommonRoomChannelModal from '../components/common-room/CommonRoomChannelModal';
import CommonRoomPipelinePicker from '../components/common-room/CommonRoomPipelinePicker';
import OrgEmptyState from '../components/OrgEmptyState';
import useCommonRoom from '../hooks/useCommonRoom';
import useOrgAssets from '../hooks/useOrgAssets';
import useOrgContext from '../hooks/useOrgContext';
import usePipelineItems from '../hooks/usePipelineItems';
import { buildDeepLink } from '../../utils/buildDeepLink';
function formatMessageTime(value) {
  if (!value) return 'Unknown time';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Unknown time';

  return nextDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateLabel(value) {
  if (!value) return 'Today';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Today';

  const now = new Date();
  const todayKey = now.toDateString();
  const targetKey = nextDate.toDateString();

  if (todayKey === targetKey) {
    return `Today / ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  return nextDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

function getInitials(value) {
  const source = String(value || '').trim();
  if (!source) return 'TM';

  const segments = source.split(/\s+/).filter(Boolean);
  if (segments.length === 1) {
    return segments[0].slice(0, 2).toUpperCase();
  }

  return `${segments[0][0] || ''}${segments[1][0] || ''}`.toUpperCase();
}

function formatValue(value) {
  return String(value || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeIdList(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))].sort();
}

function areIdListsEqual(left = [], right = []) {
  const normalizedLeft = normalizeIdList(left);
  const normalizedRight = normalizeIdList(right);

  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((entry, index) => entry === normalizedRight[index]);
}

function getChannelManagerId(channel) {
  return channel?.group_admin_user_id || channel?.created_by || null;
}

function normalizeMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function buildMessageRows(messages = []) {
  const rows = [];
  let currentDay = '';

  messages.forEach((message) => {
    const nextDay = new Date(message.created_at || 0).toDateString();
    if (nextDay !== currentDay) {
      rows.push({
        type: 'separator',
        key: `separator-${nextDay}`,
        label: formatDateLabel(message.created_at),
      });
      currentDay = nextDay;
    }

    rows.push({
      type: 'message',
      key: message.id,
      message,
    });
  });

  return rows;
}

export default function CommonRoom({ channelId }) {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const {
    organizationId,
    brandProjectId,
    activeBrandProject,
    brandProjects,
    hasPermission,
  } = useOrgContext();
  const {
    channels,
    messages,
    members,
    activeChannel,
    loading,
    messageLoading,
    error,
    sendMessage,
    createChannel,
    updateChannel,
    archiveChannel,
    leaveChannel,
    requestAiChannelReply,
    refreshChannels,
    refreshMessages,
  } = useCommonRoom(channelId || null);
  const { assets, loading: assetsLoading, refresh: refreshAssets } = useOrgAssets();
  const { items: allPipelineItems, loading: pipelineLoading } = usePipelineItems({
    brandProjectIdOverride: null,
  });

  const canCreateChannels = hasPermission('can_create_channels');
  const canManageLibrary = hasPermission('can_manage_library');

  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pipelinePickerOpen, setPipelinePickerOpen] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [archivingChannel, setArchivingChannel] = useState(false);
  const [leavingChannel, setLeavingChannel] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [channelDraft, setChannelDraft] = useState({
    name: '',
    description: '',
    scope: 'org',
    memberIds: [],
    groupAdminUserId: null,
    isAiEnabled: true,
    maxMembers: '',
  });

  useEffect(() => {
    if (loading || !organizationId || channels.length === 0) return;

    const channelExists = channels.some((channel) => channel.id === channelId);
    const nextChannelId = channelExists ? channelId : channels[0]?.id || null;

    if (nextChannelId && nextChannelId !== channelId) {
      navigate(`/app/org/${organizationId}/common-room/${nextChannelId}`, { replace: true });
    }
  }, [channelId, channels, loading, navigate, organizationId]);

  useEffect(() => {
    setChannelDraft({
      name: activeChannel?.name || '',
      description: activeChannel?.description || '',
      scope: activeChannel?.brand_project_id ? 'brand' : 'org',
      memberIds: normalizeIdList(activeChannel?.member_ids || []),
      groupAdminUserId: getChannelManagerId(activeChannel),
      isAiEnabled: activeChannel?.is_ai_enabled !== false,
      maxMembers: activeChannel?.max_members ? String(activeChannel.max_members) : '',
    });
  }, [
    activeChannel?.id,
    activeChannel?.name,
    activeChannel?.description,
    activeChannel?.brand_project_id,
    activeChannel?.member_ids,
    activeChannel?.group_admin_user_id,
    activeChannel?.created_by,
    activeChannel?.is_ai_enabled,
    activeChannel?.max_members,
  ]);

  const memberMap = useMemo(
    () => new Map((members || []).map((member) => [member.userId, member])),
    [members],
  );

  const activeChannelManagerId = useMemo(
    () => getChannelManagerId(activeChannel),
    [activeChannel],
  );

  const activeChannelMemberIds = useMemo(
    () => normalizeIdList(activeChannel?.member_ids || []),
    [activeChannel?.member_ids],
  );

  const selectedDraftMemberIds = useMemo(
    () => normalizeIdList([
      ...(channelDraft.memberIds || []),
      ...(channelDraft.groupAdminUserId ? [channelDraft.groupAdminUserId] : []),
    ]),
    [channelDraft.groupAdminUserId, channelDraft.memberIds],
  );

  const orgChannels = useMemo(
    () => channels.filter((channel) => !channel.brand_project_id && channel.channel_type !== 'private_group'),
    [channels],
  );

  const brandChannels = useMemo(() => {
    if (!brandProjectId) return [];
    return channels.filter(
      (channel) => channel.brand_project_id === brandProjectId && channel.channel_type !== 'private_group',
    );
  }, [brandProjectId, channels]);

  const groupChannels = useMemo(
    () => channels.filter((channel) => channel.channel_type === 'private_group'),
    [channels],
  );

  const activeChannelBrand = useMemo(() => {
    if (!activeChannel?.brand_project_id) return null;
    return brandProjects.find((project) => project.id === activeChannel.brand_project_id)
      || activeBrandProject
      || null;
  }, [activeBrandProject, activeChannel?.brand_project_id, brandProjects]);

  const visiblePipelineItems = useMemo(() => {
    if (!brandProjectId) return allPipelineItems;

    return allPipelineItems.filter((item) => (
      !item.brand_project_id || item.brand_project_id === brandProjectId
    ));
  }, [allPipelineItems, brandProjectId]);

  const eligibleMembers = useMemo(() => {
    const nextMembers = (members || []).filter((member) => {
      if (!activeChannel?.brand_project_id) return true;
      if (!Array.isArray(member.brandProjectIds)) return true;
      return member.brandProjectIds.includes(activeChannel.brand_project_id);
    });

    return nextMembers.slice().sort((left, right) => {
      const leftLabel = left?.profile?.full_name || left?.profile?.email || left?.userId || '';
      const rightLabel = right?.profile?.full_name || right?.profile?.email || right?.userId || '';
      return leftLabel.localeCompare(rightLabel);
    });
  }, [activeChannel?.brand_project_id, members]);

  const visibleMembers = useMemo(() => {
    if (activeChannel?.channel_type !== 'private_group') {
      return eligibleMembers;
    }

    return eligibleMembers.filter((member) => activeChannelMemberIds.includes(member.userId));
  }, [activeChannel?.channel_type, activeChannelMemberIds, eligibleMembers]);

  const activeChannelSubtitle = useMemo(() => {
    if (!activeChannel) return '';

    const parts = [];
    if (activeChannel.channel_type === 'private_group') {
      parts.push(`Private group / ${activeChannelMemberIds.length} member${activeChannelMemberIds.length === 1 ? '' : 's'}`);
    } else if (activeChannel.brand_project_id) {
      parts.push(`Brand-scoped / ${activeChannelBrand?.name || 'Selected brand'}`);
    } else {
      parts.push('Org-wide / all members');
    }

    if (activeChannel.channel_type === 'private_group' && activeChannel.brand_project_id) {
      parts.push(activeChannelBrand?.name || 'Selected brand');
    }

    parts.push(activeChannel.is_ai_enabled === false ? 'AI disabled' : 'AI enabled');
    return parts.join(' / ');
  }, [activeChannel, activeChannelBrand?.name, activeChannelMemberIds.length]);

  const canManageCurrentChannel = Boolean(
    activeChannel && (canCreateChannels || activeChannelManagerId === user?.id),
  );

  const canLeaveCurrentChannel = Boolean(
    activeChannel?.channel_type === 'private_group'
    && user?.id
    && activeChannelMemberIds.includes(user.id),
  );

  const draftMaxMembers = channelDraft.maxMembers ? Number(channelDraft.maxMembers) : null;
  const hasExceededMemberLimit = Boolean(
    activeChannel?.channel_type === 'private_group'
    && draftMaxMembers
    && selectedDraftMemberIds.length > draftMaxMembers,
  );

  const isChannelDirty = useMemo(() => {
    if (!activeChannel) return false;

    const isPrivateGroup = activeChannel.channel_type === 'private_group';
    return (
      channelDraft.name.trim() !== String(activeChannel?.name || '').trim()
      || channelDraft.description.trim() !== String(activeChannel?.description || '').trim()
      || channelDraft.scope !== (activeChannel?.brand_project_id ? 'brand' : 'org')
      || channelDraft.isAiEnabled !== (activeChannel?.is_ai_enabled !== false)
      || String(channelDraft.maxMembers || '') !== String(activeChannel?.max_members || '')
      || (isPrivateGroup && !areIdListsEqual(selectedDraftMemberIds, activeChannelMemberIds))
      || (isPrivateGroup && (channelDraft.groupAdminUserId || null) !== (activeChannelManagerId || null))
    );
  }, [
    activeChannel,
    activeChannelManagerId,
    activeChannelMemberIds,
    channelDraft.description,
    channelDraft.groupAdminUserId,
    channelDraft.isAiEnabled,
    channelDraft.maxMembers,
    channelDraft.name,
    channelDraft.scope,
    selectedDraftMemberIds,
  ]);

  const messageRows = useMemo(() => buildMessageRows(messages), [messages]);

  const resolveSender = (message) => {
    if (message?.sender_type === 'ai') {
      return {
        label: 'AI Assistant',
        initials: 'AI',
        role: 'Org assistant',
      };
    }

    const member = memberMap.get(message?.sender_id) || null;
    const label = member?.profile?.full_name
      || member?.profile?.email
      || 'Team Member';

    return {
      label,
      initials: getInitials(label),
      role: formatValue(member?.role) || 'Member',
    };
  };

  const sendTextMessage = async (content) => {
    await sendMessage({
      channel_id: activeChannel.id,
      organization_id: organizationId,
      sender_id: user.id,
      sender_type: 'user',
      content,
      content_type: 'text',
    });
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !activeChannel?.id || !organizationId || !user?.id) return;

    try {
      await sendTextMessage(content);
      setDraft('');
    } catch (sendError) {
      toast.error(sendError?.message || 'Failed to send message');
    }
  };

  const handleAskAi = async () => {
    const content = draft.trim();
    if (!content || !activeChannel?.id || !organizationId || !user?.id) return;
    if (activeChannel.is_ai_enabled === false) {
      toast.error('AI replies are disabled for this channel.');
      return;
    }

    setAskingAi(true);
    try {
      await sendTextMessage(content);
      setDraft('');

      await requestAiChannelReply({
        organization_id: organizationId,
        channel_id: activeChannel.id,
        brand_project_id: activeChannel.brand_project_id || brandProjectId || undefined,
        session_key: `common-room:${activeChannel.id}:${user.id}`,
        messages: [
          ...messages
            .slice(-10)
            .map((message) => ({
              role: message.sender_type === 'ai' ? 'assistant' : 'user',
              content: String(message.content || '').trim(),
            }))
            .filter((message) => message.content),
          {
            role: 'user',
            content,
          },
        ],
      });

      await refreshMessages(activeChannel.id);
      await refreshChannels();
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to get an AI reply');
    } finally {
      setAskingAi(false);
    }
  };

  const handleCreateChannel = async ({
    name,
    description,
    scope,
    channelType,
    memberIds,
    groupAdminUserId,
    isAiEnabled,
    maxMembers,
  }) => {
    if (!organizationId || !user?.id) return;

    setCreatingChannel(true);
    try {
      const created = await createChannel({
        organizationId,
        brandProjectId: scope === 'brand' ? (brandProjectId || null) : null,
        createdBy: user.id,
        name,
        description,
        scope,
        channelType,
        memberIds,
        groupAdminUserId,
        isAiEnabled,
        maxMembers,
      });

      toast.success('Channel created');
      setChannelModalOpen(false);
      if (created?.id) {
        navigate(`/app/org/${organizationId}/common-room/${created.id}`);
      }
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to create this channel');
    } finally {
      setCreatingChannel(false);
    }
  };

  const handleSaveChannel = async () => {
    if (!activeChannel?.id) return;
    if (hasExceededMemberLimit) {
      toast.error('Member limit cannot be lower than the selected group size.');
      return;
    }
    if (activeChannel.channel_type === 'private_group' && !channelDraft.groupAdminUserId) {
      toast.error('A private group must have a group admin.');
      return;
    }

    setSavingChannel(true);
    try {
      await updateChannel(activeChannel.id, {
        name: channelDraft.name,
        description: channelDraft.description,
        scope: channelDraft.scope,
        brandProjectId: channelDraft.scope === 'brand'
          ? (activeChannel?.brand_project_id || brandProjectId || null)
          : null,
        isAiEnabled: channelDraft.isAiEnabled,
        memberIds: activeChannel.channel_type === 'private_group' ? selectedDraftMemberIds : undefined,
        groupAdminUserId: activeChannel.channel_type === 'private_group'
          ? channelDraft.groupAdminUserId
          : undefined,
        maxMembers: activeChannel.channel_type === 'private_group'
          ? (channelDraft.maxMembers ? Number(channelDraft.maxMembers) : null)
          : undefined,
      });
      toast.success('Channel updated');
      await refreshChannels();
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to update this channel');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleArchiveChannel = async () => {
    if (!activeChannel?.id) return;
    if (!window.confirm(
      activeChannel.channel_type === 'private_group'
        ? `Archive private group "${activeChannel.name}"?`
        : `Archive #${activeChannel.name}?`,
    )) return;

    setArchivingChannel(true);
    try {
      await archiveChannel(activeChannel.id);
      toast.success('Channel archived');
      setSettingsOpen(false);
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to archive this channel');
    } finally {
      setArchivingChannel(false);
    }
  };

  const handleLeaveChannel = async () => {
    if (!activeChannel?.id || activeChannel.channel_type !== 'private_group') return;

    if (
      activeChannelManagerId === user?.id
      && activeChannelMemberIds.length > 1
      && !canCreateChannels
    ) {
      toast.error('Transfer group admin before leaving this private group.');
      return;
    }

    if (!window.confirm(`Leave private group "${activeChannel.name}"?`)) return;

    setLeavingChannel(true);
    try {
      await leaveChannel(activeChannel.id);
      toast.success('Private group left');
      setSettingsOpen(false);
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to leave this private group');
    } finally {
      setLeavingChannel(false);
    }
  };

  const handleAssetReference = async (asset) => {
    if (!activeChannel?.id || !organizationId || !user?.id || !asset?.id) return;

    try {
      await sendMessage({
        channel_id: activeChannel.id,
        organization_id: organizationId,
        sender_id: user.id,
        sender_type: 'user',
        content: asset.name || 'Shared asset',
        content_type: 'asset_reference',
        metadata: {
          asset_id: asset.id,
          asset_name: asset.name || 'Shared asset',
          asset_description: asset.description || '',
          asset_file_url: asset.file_url || '',
          asset_thumbnail_url: asset.thumbnail_url || '',
          asset_file_type: asset.file_type || '',
          asset_folder_path: asset.folder_path || '/',
          asset_is_brand_asset: Boolean(asset.is_brand_asset),
        },
      });
      setAssetPickerOpen(false);
      toast.success('Asset reference added');
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to attach that asset');
    }
  };

  const handlePipelineReference = async (item) => {
    if (!activeChannel?.id || !organizationId || !user?.id || !item?.id) return;

    try {
      await sendMessage({
        channel_id: activeChannel.id,
        organization_id: organizationId,
        sender_id: user.id,
        sender_type: 'user',
        content: item.title || 'Pipeline item',
        content_type: 'pipeline_reference',
        metadata: {
          pipeline_item_id: item.id,
          pipeline_title: item.title || 'Pipeline item',
          pipeline_status: item.status || 'pending',
          pipeline_stage_name: item.currentStageName || '',
          post_id: item.post_id || item.posts?.id || null,
          platform: item.platform || '',
        },
      });
      setPipelinePickerOpen(false);
      toast.success('Pipeline reference added');
    } catch (nextError) {
      toast.error(nextError?.message || 'Unable to attach that pipeline item');
    }
  };

  const handleToggleDraftMember = (memberId) => {
    if (!memberId) return;
    if (memberId === user?.id) return;
    if (memberId === channelDraft.groupAdminUserId) return;

    setChannelDraft((current) => {
      const nextIds = current.memberIds.includes(memberId)
        ? current.memberIds.filter((entry) => entry !== memberId)
        : [...current.memberIds, memberId];

      return {
        ...current,
        memberIds: normalizeIdList(nextIds),
      };
    });
  };

  const handleGroupAdminChange = (nextAdminUserId) => {
    if (!nextAdminUserId) return;

    setChannelDraft((current) => ({
      ...current,
      groupAdminUserId: nextAdminUserId,
      memberIds: normalizeIdList([...(current.memberIds || []), nextAdminUserId]),
    }));
  };

  const renderMessageBody = (message) => {
    const metadata = normalizeMetadata(message.metadata);

    if (message.content_type === 'asset_reference') {
      return (
        <button
          type="button"
          className="common-room-reference-card"
          onClick={() => navigate(`/app/org/${organizationId}/library`)}
        >
          <div className="common-room-reference-icon asset">
            <Upload size={16} />
          </div>
          <div className="common-room-reference-copy">
            <strong>{metadata.asset_name || message.content || 'Shared asset'}</strong>
            <span>{metadata.asset_file_type || 'Asset'} / {metadata.asset_folder_path || '/'}</span>
          </div>
          <ArrowUpRight size={15} />
        </button>
      );
    }

    if (message.content_type === 'pipeline_reference') {
      return (
        <button
          type="button"
          className="common-room-reference-card"
          onClick={() => {
            const target = buildDeepLink({
              path: `/app/org/${organizationId}/pipeline`,
              source: 'common_room',
              target: 'org_pipeline_item',
              params: {
                pipelineItemId: metadata.pipeline_item_id || null,
              },
            });
            navigate(target.path, { state: target.state });
          }}
        >
          <div className="common-room-reference-icon pipeline">
            <Workflow size={16} />
          </div>
          <div className="common-room-reference-copy">
            <strong>{metadata.pipeline_title || message.content || 'Pipeline item'}</strong>
            <span>{formatValue(metadata.pipeline_stage_name) || 'Review'} / {formatValue(metadata.pipeline_status) || 'Pending'}</span>
          </div>
          <ArrowUpRight size={15} />
        </button>
      );
    }

    return <p>{message.content}</p>;
  };

  const renderChannelBadges = (channel) => {
    const badges = [];

    if (channel.channel_type === 'private_group') {
      badges.push(
        <span key="private" className="common-room-channel-pill private">
          <Lock size={11} />
          Private group
        </span>,
      );
      badges.push(
        <span key="members" className="common-room-channel-pill">
          {normalizeIdList(channel.member_ids || []).length} members
        </span>,
      );
    } else if (channel.brand_project_id) {
      badges.push(
        <span key="brand" className="common-room-channel-pill">
          Brand
        </span>,
      );
    } else {
      badges.push(
        <span key="org" className="common-room-channel-pill">
          Org
        </span>,
      );
    }

    badges.push(
      <span
        key="ai"
        className={`common-room-channel-pill ${channel.is_ai_enabled === false ? 'muted' : 'accent'}`}
      >
        <Sparkles size={11} />
        {channel.is_ai_enabled === false ? 'AI off' : 'AI on'}
      </span>,
    );

    return badges;
  };

  const renderChannelCard = (channel, emptyText, icon) => (
    <button
      key={channel.id}
      type="button"
      className={`common-room-channel-card ${channel.id === activeChannel?.id ? 'active' : ''}`}
      onClick={() => navigate(`/app/org/${organizationId}/common-room/${channel.id}`)}
    >
      <div className="common-room-channel-main">
        <div className="common-room-channel-name-row">
          <span className="common-room-channel-hash">{icon}</span>
          <strong>{channel.name}</strong>
          {channel.unread_count > 0 ? (
            <span className="common-room-channel-count">{channel.unread_count}</span>
          ) : null}
        </div>
        <span>{channel.last_message_preview || channel.description || emptyText}</span>
        <div className="common-room-channel-badges">
          {renderChannelBadges(channel)}
        </div>
      </div>
    </button>
  );

  return (
    <section className="org-page common-room-page">
      <div className="common-room-page-header">
        <div>
          <span className="common-room-eyebrow">Common Room</span>
          <h1>Shared channels and day-to-day collaboration</h1>
          <p>
            Keep conversations close to the work, with org-wide discussion,
            {activeBrandProject?.name ? ` ${activeBrandProject.name} channels,` : ''}
            {' '}and linked references to assets and pipeline items.
          </p>
        </div>

        <div className="common-room-page-actions">
          <button
            type="button"
            className="common-room-button ghost"
            onClick={() => setSettingsOpen((current) => !current)}
            disabled={!activeChannel}
          >
            <Settings2 size={15} />
            Members & Settings
          </button>
          {canCreateChannels ? (
            <button
              type="button"
              className="common-room-button primary"
              onClick={() => setChannelModalOpen(true)}
            >
              <Plus size={15} />
              Create Channel
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="common-room-loading-state">
          <Loader2 size={18} className="spin" />
          <span>Loading channels...</span>
        </div>
      ) : channels.length === 0 ? (
        <OrgEmptyState
          eyebrow="Common Room"
          title="No channels yet"
          description={canCreateChannels
            ? 'Create the first org-wide or brand-scoped channel to start collaborating.'
            : 'Channels will appear here when your workspace is set up.'}
          action={canCreateChannels ? (
            <button type="button" className="common-room-button primary" onClick={() => setChannelModalOpen(true)}>
              Create Channel
            </button>
          ) : null}
        />
      ) : (
        <div className="common-room-layout">
          <aside className="common-room-rail">
            <div className="common-room-rail-header">
              <div>
                <strong>Channels</strong>
                <span>{channels.length} active</span>
              </div>
              {canCreateChannels ? (
                <button
                  type="button"
                  className="common-room-icon-button"
                  onClick={() => setChannelModalOpen(true)}
                  aria-label="Create channel"
                >
                  <Plus size={15} />
                </button>
              ) : null}
            </div>

            <div className="common-room-channel-section">
              <span className="common-room-section-label">Org-wide</span>
              {orgChannels.length === 0 ? (
                <div className="common-room-section-empty">No org-wide channels.</div>
              ) : (
                orgChannels.map((channel) => renderChannelCard(
                  channel,
                  'Org-wide discussion for the team.',
                  <Hash size={13} />,
                ))
              )}
            </div>

            {brandProjectId && brandProjects.length > 0 ? (
              <div className="common-room-channel-section">
                <span className="common-room-section-label">
                  Brand-scoped / {activeBrandProject?.name || 'Selected brand'}
                </span>
                {brandChannels.length === 0 ? (
                  <div className="common-room-section-empty">No channels for this brand yet.</div>
                ) : (
                  brandChannels.map((channel) => renderChannelCard(
                    channel,
                    'Conversation for this brand project.',
                    <Building2 size={13} />,
                  ))
                )}
              </div>
            ) : null}

            <div className="common-room-channel-section">
              <span className="common-room-section-label">Private Groups</span>
              {groupChannels.length === 0 ? (
                <div className="common-room-section-empty">No private groups yet.</div>
              ) : (
                groupChannels.map((channel) => renderChannelCard(
                  channel,
                  'Private collaboration space for selected members.',
                  <Lock size={13} />,
                ))
              )}
            </div>
          </aside>

          <main className="common-room-chat">
            {activeChannel ? (
              <>
                <header className="common-room-chat-header">
                  <div>
                    <strong>#{activeChannel.name}</strong>
                    <span>{activeChannelSubtitle}</span>
                    <div className="common-room-channel-badges">
                      {renderChannelBadges(activeChannel)}
                      {activeChannel.channel_type === 'private_group' && activeChannelManagerId ? (
                        <span className="common-room-channel-pill">
                          <Crown size={11} />
                          {memberMap.get(activeChannelManagerId)?.profile?.full_name
                            || memberMap.get(activeChannelManagerId)?.profile?.email
                            || 'Group admin'}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="common-room-button ghost compact"
                    onClick={() => setSettingsOpen((current) => !current)}
                  >
                    <Settings2 size={14} />
                    Settings
                  </button>
                </header>

                <div className="common-room-message-stream">
                  {messageLoading ? (
                    <div className="common-room-message-empty">
                      <Loader2 size={18} className="spin" />
                      <span>Loading messages...</span>
                    </div>
                  ) : messageRows.length === 0 ? (
                    <div className="common-room-message-empty">
                      <MessagesSquare size={18} />
                      <span>Start the conversation in #{activeChannel.name}.</span>
                    </div>
                  ) : (
                    messageRows.map((row) => {
                      if (row.type === 'separator') {
                        return (
                          <div key={row.key} className="common-room-date-separator">
                            <span>{row.label}</span>
                          </div>
                        );
                      }

                      const message = row.message;
                      const sender = resolveSender(message);
                      return (
                        <article
                          key={row.key}
                          className={`common-room-message-card ${message.sender_type === 'ai' ? 'ai' : ''}`}
                        >
                          <div className={`common-room-message-avatar ${message.sender_type === 'ai' ? 'ai' : ''}`}>
                            {sender.initials}
                          </div>

                          <div className="common-room-message-body">
                            <div className="common-room-message-meta">
                              <strong>{sender.label}</strong>
                              <span>{sender.role}</span>
                              <time>{formatMessageTime(message.created_at)}</time>
                            </div>
                            {renderMessageBody(message)}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>

                <div className="common-room-composer">
                  <div className="common-room-composer-box">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={`Message #${activeChannel.name}`}
                      rows={4}
                    />

                    <div className="common-room-composer-footer">
                      <div className="common-room-composer-tools">
                        <button
                          type="button"
                          className="common-room-icon-button subtle"
                          aria-label="Attach asset from library"
                          onClick={() => setAssetPickerOpen(true)}
                        >
                          <Upload size={14} />
                        </button>
                        <button
                          type="button"
                          className="common-room-icon-button subtle"
                          aria-label="Reference pipeline item"
                          onClick={() => setPipelinePickerOpen(true)}
                        >
                          <Workflow size={14} />
                        </button>
                        <button
                          type="button"
                          className="common-room-button ghost compact"
                          onClick={() => void handleAskAi()}
                          disabled={!draft.trim() || askingAi || activeChannel.is_ai_enabled === false}
                        >
                          <Sparkles size={14} />
                          {askingAi ? 'Asking AI...' : 'Ask AI'}
                        </button>
                      </div>

                      <button
                        type="button"
                        className="common-room-button primary"
                        onClick={() => void handleSend()}
                        disabled={!draft.trim()}
                      >
                        <Send size={14} />
                        Send
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="common-room-message-empty">
                <Loader2 size={18} className="spin" />
                <span>Opening the first available channel...</span>
              </div>
            )}
          </main>

          <aside className={`common-room-settings ${settingsOpen ? 'open' : ''}`}>
            <div className="common-room-settings-header">
              <div>
                <strong>#{activeChannel?.name || 'Channel'}</strong>
                <span>Channel settings and members</span>
              </div>
              <button
                type="button"
                className="common-room-icon-button subtle close"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X size={14} />
              </button>
            </div>

            {activeChannel ? (
              <>
                <div className="common-room-settings-section">
                  <span className="common-room-section-label">Overview</span>
                  <label className="common-room-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={channelDraft.name}
                      onChange={(event) => setChannelDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))}
                      disabled={!canManageCurrentChannel}
                    />
                  </label>

                  <label className="common-room-field">
                    <span>Description</span>
                    <textarea
                      rows={4}
                      value={channelDraft.description}
                      onChange={(event) => setChannelDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))}
                      disabled={!canManageCurrentChannel}
                    />
                  </label>

                  <div className="common-room-field">
                    <span>Scope</span>
                    <div className="common-room-scope-toggle">
                      <button
                        type="button"
                        className={`common-room-scope-option ${channelDraft.scope === 'org' ? 'active' : ''}`}
                        disabled={!canManageCurrentChannel}
                        onClick={() => setChannelDraft((current) => ({ ...current, scope: 'org' }))}
                      >
                        Org-wide
                      </button>
                      <button
                        type="button"
                        className={`common-room-scope-option ${channelDraft.scope === 'brand' ? 'active' : ''}`}
                        disabled={!canManageCurrentChannel || !(activeChannelBrand || activeBrandProject)}
                        onClick={() => setChannelDraft((current) => ({ ...current, scope: 'brand' }))}
                      >
                        {(activeChannelBrand || activeBrandProject)
                          ? `Brand-scoped / ${(activeChannelBrand || activeBrandProject)?.name}`
                          : 'Brand-scoped unavailable'}
                      </button>
                    </div>
                  </div>

                  <label className="common-room-toggle-row">
                    <input
                      type="checkbox"
                      checked={channelDraft.isAiEnabled}
                      disabled={!canManageCurrentChannel}
                      onChange={(event) => setChannelDraft((current) => ({
                        ...current,
                        isAiEnabled: event.target.checked,
                      }))}
                    />
                    <span>
                      <Sparkles size={14} />
                      Enable AI replies in this channel
                    </span>
                  </label>
                </div>

                {activeChannel.channel_type === 'private_group' ? (
                  <div className="common-room-settings-section">
                    <span className="common-room-section-label">
                      Private Group ({selectedDraftMemberIds.length})
                    </span>

                    <div className="common-room-settings-grid">
                      <label className="common-room-field">
                        <span>Group admin</span>
                        <select
                          value={channelDraft.groupAdminUserId || ''}
                          disabled={!canManageCurrentChannel}
                          onChange={(event) => handleGroupAdminChange(event.target.value)}
                        >
                          <option value="" disabled>Select a member</option>
                          {eligibleMembers
                            .filter((member) => selectedDraftMemberIds.includes(member.userId))
                            .map((member) => {
                              const label = member?.profile?.full_name || member?.profile?.email || member?.userId || 'Member';
                              return (
                                <option key={member.userId} value={member.userId}>
                                  {label}
                                </option>
                              );
                            })}
                        </select>
                      </label>

                      <label className="common-room-field">
                        <span>Member limit</span>
                        <input
                          type="number"
                          min="2"
                          value={channelDraft.maxMembers}
                          disabled={!canManageCurrentChannel}
                          onChange={(event) => setChannelDraft((current) => ({
                            ...current,
                            maxMembers: event.target.value,
                          }))}
                          placeholder="Optional maximum"
                        />
                      </label>
                    </div>

                    {hasExceededMemberLimit ? (
                      <div className="common-room-section-empty compact">
                        Member limit cannot be lower than the selected group size.
                      </div>
                    ) : null}

                    <div className="common-room-member-checklist">
                      {eligibleMembers.map((member) => {
                        const memberId = member.userId;
                        const label = member?.profile?.full_name || member?.profile?.email || memberId;
                        const checked = selectedDraftMemberIds.includes(memberId);
                        const isCurrentUser = memberId === user?.id;
                        const isGroupAdmin = memberId === channelDraft.groupAdminUserId;

                        return (
                          <label
                            key={memberId}
                            className={`common-room-member-choice ${checked ? 'active' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                !canManageCurrentChannel
                                || isCurrentUser
                                || isGroupAdmin
                              }
                              onChange={() => handleToggleDraftMember(memberId)}
                            />
                            <div>
                              <strong>{label}</strong>
                              <span>
                                {[
                                  isGroupAdmin ? 'Group admin' : formatValue(member.role) || 'Member',
                                  isCurrentUser ? 'You' : null,
                                ].filter(Boolean).join(' / ')}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="common-room-settings-section">
                    <span className="common-room-section-label">
                      Members ({visibleMembers.length})
                    </span>
                    <div className="common-room-member-list">
                      {visibleMembers.map((member) => {
                        const label = member?.profile?.full_name || member?.profile?.email || member?.userId || 'Member';
                        return (
                          <div key={member.id || member.userId} className="common-room-member-row">
                            <div className="common-room-member-avatar">{getInitials(label)}</div>
                            <div className="common-room-member-copy">
                              <strong>{label}</strong>
                              <span>{formatValue(member.role) || 'Member'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="common-room-settings-section">
                  <span className="common-room-section-label">Actions</span>
                  {canManageCurrentChannel ? (
                    <div className="common-room-modal-actions stacked">
                      <button
                        type="button"
                        className="common-room-button primary"
                        onClick={() => void handleSaveChannel()}
                        disabled={
                          !isChannelDirty
                          || savingChannel
                          || hasExceededMemberLimit
                          || (channelDraft.scope === 'brand' && !(activeChannel?.brand_project_id || brandProjectId))
                        }
                      >
                        {savingChannel ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        type="button"
                        className="common-room-button danger"
                        onClick={() => void handleArchiveChannel()}
                        disabled={archivingChannel}
                      >
                        {archivingChannel ? 'Archiving...' : 'Archive Channel'}
                      </button>
                      {canLeaveCurrentChannel ? (
                        <button
                          type="button"
                          className="common-room-button ghost"
                          onClick={() => void handleLeaveChannel()}
                          disabled={leavingChannel}
                        >
                          <UserMinus size={14} />
                          {leavingChannel ? 'Leaving...' : 'Leave Group'}
                        </button>
                      ) : null}
                    </div>
                  ) : canLeaveCurrentChannel ? (
                    <div className="common-room-modal-actions stacked">
                      <button
                        type="button"
                        className="common-room-button ghost"
                        onClick={() => void handleLeaveChannel()}
                        disabled={leavingChannel}
                      >
                        <UserMinus size={14} />
                        {leavingChannel ? 'Leaving...' : 'Leave Group'}
                      </button>
                    </div>
                  ) : (
                    <div className="common-room-section-empty">
                      You can view settings and members, but changes require `can_create_channels` or private-group admin access.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="common-room-section-empty">Select a channel to review its settings.</div>
            )}
          </aside>
        </div>
      )}

      {error ? <p className="common-room-error-text">{error}</p> : null}

      <CommonRoomChannelModal
        open={channelModalOpen}
        onClose={() => setChannelModalOpen(false)}
        onSubmit={handleCreateChannel}
        submitting={creatingChannel}
        brandDisabled={!activeBrandProject}
        activeBrandName={activeBrandProject?.name || ''}
        members={eligibleMembers}
        currentUserId={user?.id || null}
      />

      <CommonRoomAssetPicker
        open={assetPickerOpen}
        assets={assets}
        loading={assetsLoading}
        canUpload={canManageLibrary}
        onClose={() => setAssetPickerOpen(false)}
        onSelectAsset={(asset) => void handleAssetReference(asset)}
        onUploaded={async () => {
          await refreshAssets();
        }}
      />

      <CommonRoomPipelinePicker
        open={pipelinePickerOpen}
        items={visiblePipelineItems}
        loading={pipelineLoading}
        onClose={() => setPipelinePickerOpen(false)}
        onSelectItem={(item) => void handlePipelineReference(item)}
      />
    </section>
  );
}
