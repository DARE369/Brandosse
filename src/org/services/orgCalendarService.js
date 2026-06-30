import { supabase } from '../../services/supabaseClient';
import { POST_STATUS } from '../../constants/statuses';
import { fetchOrganizationMembers } from './orgService';
import { fetchPipelineConfigs, fetchPipelineItems } from './pipelineService';
import { fetchOrgAssets, fetchOrgPostAssetLinks } from './assetLibraryService';
import { fetchOrgTaskStatuses, fetchOrgTasks } from './taskService';
import { fetchOrgScheduleContext, toEdgeFunctionError } from './orgScheduleService.js';
import { buildPublishSummary, emitMockPublishComplete } from '../../services/platforms/mockPublishWorkflow';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isUnavailableOrgDestination(account) {
  return account?.scope === 'organization' && account?.can_post === false;
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

function startOfDay(date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function endOfDay(date) {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function addDays(date, value) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + value);
  return nextDate;
}

function addHours(date, value) {
  const nextDate = new Date(date);
  nextDate.setHours(nextDate.getHours() + value);
  return nextDate;
}

function startOfWeek(date) {
  const nextDate = startOfDay(date);
  const day = nextDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  nextDate.setDate(nextDate.getDate() + diff);
  return nextDate;
}

function resolveCurrentStage(config, item) {
  const stages = Array.isArray(config?.stages)
    ? [...config.stages].sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    : [];

  return stages.find((stage) => Number(stage?.order || 0) === Number(item?.current_stage_order || 0))
    || stages[0]
    || null;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    event: String(entry.event || '').trim().toLowerCase(),
    stageOrder: safeNumber(entry.stage_order, 0),
    stageName: String(entry.stage_name || '').trim(),
    timestamp: entry.timestamp || null,
  };
}

function getHistoryEntries(item) {
  return safeArray(item?.history)
    .map(normalizeHistoryEntry)
    .filter(Boolean)
    .sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime());
}

function getCurrentStageEnteredAt(item) {
  const history = getHistoryEntries(item);
  const currentOrder = safeNumber(item?.current_stage_order, 0);
  const matchingEntry = [...history]
    .reverse()
    .find((entry) => entry.stageOrder === currentOrder && entry.timestamp);

  return matchingEntry?.timestamp || item?.updated_at || item?.created_at || null;
}

function computeBottleneckLaneMetrics(items = []) {
  const activeItems = safeArray(items).filter((item) => ['pending', 'in_review', 'revision_requested'].includes(item.status));
  const now = Date.now();
  const grouped = new Map();

  activeItems.forEach((item) => {
    const laneKey = String(item.current_assignee_role || item.currentStageName || 'unassigned').trim() || 'unassigned';
    const current = grouped.get(laneKey) || {
      laneKey,
      label: laneKey.replace(/_/g, ' '),
      items: [],
      activeCount: 0,
      overdueCount: 0,
      revisionCount: 0,
      oldestItemAgeDays: 0,
      nearestSlaDeadline: null,
      averageStageAgeHours: 0,
      reworkRatio: 0,
      pressureScore: 0,
    };

    current.items.push(item);
    current.activeCount += 1;

    const history = getHistoryEntries(item);
    const stageEnteredAt = getCurrentStageEnteredAt(item);
    const stageAgeMs = stageEnteredAt ? (now - new Date(stageEnteredAt).getTime()) : 0;
    current.averageStageAgeHours += stageAgeMs > 0 ? (stageAgeMs / (1000 * 60 * 60)) : 0;
    current.oldestItemAgeDays = Math.max(
      current.oldestItemAgeDays,
      stageAgeMs > 0 ? Math.floor(stageAgeMs / (1000 * 60 * 60 * 24)) : 0,
    );

    const revisionEvents = history.filter((entry) => entry.event === 'request_revision').length;
    current.revisionCount += revisionEvents + (item.status === 'revision_requested' ? 1 : 0);

    if (item.sla_deadline) {
      const deadlineMs = new Date(item.sla_deadline).getTime();
      if (!Number.isNaN(deadlineMs)) {
        if (deadlineMs < now) {
          current.overdueCount += 1;
        }
        if (!current.nearestSlaDeadline || deadlineMs < new Date(current.nearestSlaDeadline).getTime()) {
          current.nearestSlaDeadline = item.sla_deadline;
        }
      }
    }

    grouped.set(laneKey, current);
  });

  return [...grouped.values()]
    .map((lane) => {
      const avgStageAgeHours = lane.activeCount > 0 ? lane.averageStageAgeHours / lane.activeCount : 0;
      const reworkRatio = lane.activeCount > 0 ? lane.revisionCount / lane.activeCount : 0;
      const nearestDeadlineMs = lane.nearestSlaDeadline
        ? (new Date(lane.nearestSlaDeadline).getTime() - now)
        : null;
      const nearestDeadlinePenalty = nearestDeadlineMs === null
        ? 0
        : (nearestDeadlineMs < 0 ? 18 : Math.max(0, 24 - (nearestDeadlineMs / (1000 * 60 * 60))));
      const pressureScore = (
        (lane.overdueCount * 100)
        + (lane.revisionCount * 24)
        + (lane.activeCount * 12)
        + Math.min(avgStageAgeHours, 96)
        + Math.min(lane.oldestItemAgeDays * 8, 72)
        + nearestDeadlinePenalty
      );

      return {
        ...lane,
        averageStageAgeHours: Number(avgStageAgeHours.toFixed(1)),
        reworkRatio: Number(reworkRatio.toFixed(2)),
        pressureScore: Number(pressureScore.toFixed(1)),
      };
    })
    .sort((left, right) => right.pressureScore - left.pressureScore);
}

export async function fetchOrgCalendarPosts({ organizationId, brandProjectId = null }) {
  if (!organizationId) return [];

  const selectVariants = [
    `
      id,
      user_id,
      organization_id,
      brand_project_id,
      generation_id,
      pipeline_item_id,
      task_id,
      account_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      scheduled_at,
      published_at,
      created_at,
      updated_at,
      connected_accounts (
        platform,
        account_name,
        avatar_url,
        scope,
        connection_status,
        granted_member_ids
      ),
      generations (
        id,
        prompt,
        storage_path,
        media_type
      )
    `,
    `
      id,
      user_id,
      organization_id,
      brand_project_id,
      generation_id,
      pipeline_item_id,
      account_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      scheduled_at,
      published_at,
      created_at,
      updated_at,
      connected_accounts (
        platform,
        account_name,
        avatar_url,
        scope,
        connection_status,
        granted_member_ids
      ),
      generations (
        id,
        prompt,
        storage_path,
        media_type
      )
    `,
  ];

  for (const selection of selectVariants) {
    let query = supabase
      .from('posts')
      .select(selection)
      .eq('organization_id', organizationId)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (brandProjectId) {
      query = query.eq('brand_project_id', brandProjectId);
    }

    const { data, error } = await query;
    if (!error) {
      return safeArray(data);
    }

    if (!isMissingRelationError(error)) {
      console.warn('[orgCalendarService] failed to fetch org posts:', error.message);
      return [];
    }
  }

  return [];
}

export async function fetchOrgCalendarSnapshot({ organizationId, brandProjectId = null }) {
  const [members, posts, pipelineItems, pipelineConfigs, assets, taskStatuses, tasks] = await Promise.all([
    fetchOrganizationMembers(organizationId),
    fetchOrgCalendarPosts({ organizationId, brandProjectId }),
    fetchPipelineItems({ organizationId, brandProjectId }),
    fetchPipelineConfigs({ organizationId, brandProjectId }),
    fetchOrgAssets({ organizationId, brandProjectId }),
    fetchOrgTaskStatuses({ organizationId }),
    fetchOrgTasks({ organizationId, brandProjectId }),
  ]);

  const postAssetLinks = await fetchOrgPostAssetLinks({
    organizationId,
    postIds: safeArray(posts).map((post) => post.id),
  });
  const postAssetMap = new Map();
  safeArray(postAssetLinks).forEach((link) => {
    const current = postAssetMap.get(link.post_id) || [];
    current.push(link);
    postAssetMap.set(link.post_id, current);
  });

  const memberMap = new Map(
    safeArray(members).map((member) => [member.userId, member]),
  );
  const postMap = new Map(
    safeArray(posts).map((post) => [post.id, post]),
  );
  const configMap = new Map(
    safeArray(pipelineConfigs).map((config) => [config.id, config]),
  );
  const taskStatusMap = new Map(
    safeArray(taskStatuses).map((status) => [status.id, status]),
  );
  const taskMap = new Map(
    safeArray(tasks).map((task) => [task.id, {
      ...task,
      status: taskStatusMap.get(task.status_id) || null,
    }]),
  );

  const normalizedPosts = safeArray(posts).map((post) => ({
    ...post,
    member: memberMap.get(post.user_id) || null,
    account: Array.isArray(post.connected_accounts) ? post.connected_accounts[0] || null : post.connected_accounts || null,
    media: Array.isArray(post.generations) ? post.generations[0] || null : post.generations || null,
    assetLinks: postAssetMap.get(post.id) || [],
    attachedAssets: (postAssetMap.get(post.id) || []).map((link) => link.asset).filter(Boolean),
    task: post.task_id ? taskMap.get(post.task_id) || null : null,
  }));

  const normalizedPipelineItems = safeArray(pipelineItems).map((item) => {
    const relatedPost = Array.isArray(item.posts) ? item.posts[0] || null : item.posts || null;
    const linkedPost = postMap.get(item.post_id) || relatedPost || null;
    const config = configMap.get(item.pipeline_config_id) || null;
    const currentStage = resolveCurrentStage(config, item);
    return {
      ...item,
      config,
      currentStage,
      currentStageName: currentStage?.name || item.current_assignee_role || item.status || 'Stage',
      requireCommentOnRevision: Boolean(currentStage?.require_comment_on_rejection),
      linkedPost,
      member: linkedPost?.user_id ? memberMap.get(linkedPost.user_id) || null : null,
      submitter: memberMap.get(item.submitted_by) || null,
      assigneeMember: item.current_assignee_user_id
        ? memberMap.get(item.current_assignee_user_id) || null
        : null,
      task: item.task_id ? taskMap.get(item.task_id) || null : null,
    };
  });

  const approvedQueue = normalizedPipelineItems.filter((item) => {
    const linkedPost = item.linkedPost;
    return item.status === 'approved' && linkedPost?.id && !linkedPost?.scheduled_at;
  });

  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekEnd = endOfDay(addDays(weekStart, 6));
  const monthStart = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthEnd = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const scheduledThisWeek = normalizedPosts.filter((post) => {
    if (!post.scheduled_at || post.status !== POST_STATUS.SCHEDULED) return false;
    const scheduledDate = new Date(post.scheduled_at);
    return scheduledDate >= weekStart && scheduledDate <= weekEnd;
  }).length;

  const publishedThisMonth = normalizedPosts.filter((post) => {
    if (!post.published_at || post.status !== POST_STATUS.PUBLISHED) return false;
    const publishedDate = new Date(post.published_at);
    return publishedDate >= monthStart && publishedDate <= monthEnd;
  }).length;

  const inReviewCount = normalizedPipelineItems.filter((item) => ['pending', 'in_review'].includes(item.status)).length;
  const overdueCount = normalizedPipelineItems.filter((item) => {
    if (!item.sla_deadline) return false;
    return new Date(item.sla_deadline) < today && ['pending', 'in_review', 'revision_requested'].includes(item.status);
  }).length;

  const pipelineByRole = normalizedPipelineItems.reduce((accumulator, item) => {
    const key = item.current_assignee_role || item.status || 'unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const bottleneckLanes = computeBottleneckLaneMetrics(normalizedPipelineItems);
  const taskOpenCount = safeArray(tasks).filter((task) => {
    const statusKey = String(taskStatusMap.get(task.status_id)?.key || '').trim();
    return statusKey !== 'completed';
  }).length;
  const taskBlockedCount = safeArray(tasks).filter((task) => Boolean(task.is_blocked)).length;
  const taskDueSoonCount = safeArray(tasks).filter((task) => {
    if (!task?.due_at) return false;
    const dueTime = new Date(task.due_at).getTime();
    if (Number.isNaN(dueTime)) return false;
    const diffHours = (dueTime - today.getTime()) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 48;
  }).length;
  const taskCompletedThisWeek = safeArray(tasks).filter((task) => {
    if (!task?.completed_at) return false;
    const completedDate = new Date(task.completed_at);
    return completedDate >= weekStart && completedDate <= weekEnd;
  }).length;

  return {
    members: safeArray(members),
    posts: normalizedPosts,
    pipelineItems: normalizedPipelineItems,
    pipelineConfigs: safeArray(pipelineConfigs),
    taskStatuses: safeArray(taskStatuses),
    tasks: safeArray(tasks).map((task) => ({
      ...task,
      status: taskStatusMap.get(task.status_id) || null,
      linked_post: task.linked_post || null,
      linked_pipeline_item: task.linked_pipeline_item || null,
    })),
    approvedQueue,
    assets: safeArray(assets),
    postAssetLinks: safeArray(postAssetLinks),
    stats: {
      scheduledThisWeek,
      publishedThisMonth,
      approvedQueueCount: approvedQueue.length,
      inReviewCount,
      overdueCount,
      activeMembers: safeArray(members).length,
      recentAssetCount: safeArray(assets).filter((asset) => {
        if (!asset?.created_at) return false;
        return new Date(asset.created_at) >= addDays(today, -7);
      }).length,
      taskOpenCount,
      taskBlockedCount,
      taskDueSoonCount,
      taskCompletedThisWeek,
      pipelineByRole,
      bottleneckLanes,
    },
  };
}

function normalizeCalendarPresetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    scope: row.scope,
    ownerUserId: row.owner_user_id || null,
    name: row.name || 'Saved view',
    viewMode: row.view_mode || 'calendar',
    filters: row.filters && typeof row.filters === 'object' ? row.filters : {},
    layout: row.layout && typeof row.layout === 'object' ? row.layout : {},
    sort: row.sort && typeof row.sort === 'object' ? row.sort : {},
    isDefault: Boolean(row.is_default),
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizePresetPayload(payload = {}) {
  return {
    organization_id: payload.organizationId,
    scope: payload.scope || 'personal',
    owner_user_id: payload.scope === 'personal' ? payload.ownerUserId || null : null,
    name: String(payload.name || 'Saved view').trim(),
    view_mode: payload.viewMode || 'calendar',
    filters: payload.filters && typeof payload.filters === 'object' ? payload.filters : {},
    layout: payload.layout && typeof payload.layout === 'object' ? payload.layout : {},
    sort: payload.sort && typeof payload.sort === 'object' ? payload.sort : {},
    is_default: Boolean(payload.isDefault),
    created_by: payload.createdBy || null,
  };
}

async function clearDefaultPresets({
  organizationId,
  scope,
  ownerUserId = null,
  excludeId = null,
}) {
  if (!organizationId || !scope) return;

  let query = supabase
    .from('org_calendar_view_presets')
    .update({ is_default: false })
    .eq('organization_id', organizationId)
    .eq('scope', scope);

  if (scope === 'personal') {
    query = query.eq('owner_user_id', ownerUserId || '');
  } else {
    query = query.is('owner_user_id', null);
  }

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { error } = await query;
  if (error && !isMissingRelationError(error)) {
    throw error;
  }
}

export async function fetchOrgCalendarViewPresets({ organizationId }) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('org_calendar_view_presets')
    .select('*')
    .eq('organization_id', organizationId)
    .order('scope', { ascending: true })
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return [];
  }

  return safeArray(data).map(normalizeCalendarPresetRow).filter(Boolean);
}

export async function saveOrgCalendarViewPreset(payload = {}) {
  const normalized = normalizePresetPayload(payload);
  if (normalized.is_default) {
    await clearDefaultPresets({
      organizationId: normalized.organization_id,
      scope: normalized.scope,
      ownerUserId: normalized.owner_user_id,
    });
  }
  const { data, error } = await supabase
    .from('org_calendar_view_presets')
    .insert(normalized)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeCalendarPresetRow(data);
}

export async function updateOrgCalendarViewPreset(presetId, updates = {}) {
  if (!presetId) throw new Error('A preset id is required.');

  const payload = {};
  if (updates.name !== undefined) payload.name = String(updates.name || '').trim();
  if (updates.viewMode !== undefined) payload.view_mode = updates.viewMode || 'calendar';
  if (updates.filters !== undefined) payload.filters = updates.filters && typeof updates.filters === 'object' ? updates.filters : {};
  if (updates.layout !== undefined) payload.layout = updates.layout && typeof updates.layout === 'object' ? updates.layout : {};
  if (updates.sort !== undefined) payload.sort = updates.sort && typeof updates.sort === 'object' ? updates.sort : {};
  if (updates.isDefault !== undefined) payload.is_default = Boolean(updates.isDefault);

  const { data, error } = await supabase
    .from('org_calendar_view_presets')
    .update(payload)
    .eq('id', presetId)
    .select('*')
    .single();

  if (error) throw error;
  if (payload.is_default) {
    await clearDefaultPresets({
      organizationId: data.organization_id,
      scope: data.scope,
      ownerUserId: data.owner_user_id,
      excludeId: data.id,
    });
  }
  return normalizeCalendarPresetRow(data);
}

export async function deleteOrgCalendarViewPreset(presetId) {
  if (!presetId) throw new Error('A preset id is required.');

  const { error } = await supabase
    .from('org_calendar_view_presets')
    .delete()
    .eq('id', presetId);

  if (error) throw error;
  return true;
}

function createRangeDays(startDate, endDate) {
  const days = [];
  let cursor = startOfDay(new Date(startDate));
  const safeEnd = endOfDay(new Date(endDate));

  while (cursor <= safeEnd) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  return days;
}

function createBatchSlots({
  mode,
  rangeStart,
  rangeEnd,
  existingRecords = [],
  records = [],
}) {
  const days = createRangeDays(rangeStart, rangeEnd);
  const usedByDay = new Map();

  safeArray(existingRecords).forEach((record) => {
    if (!record?.scheduledAt) return;
    const key = startOfDay(new Date(record.scheduledAt)).toISOString();
    usedByDay.set(key, (usedByDay.get(key) || 0) + 1);
  });

  const nextSlots = [];
  const safeMode = mode || 'fill_next_open_slots';
  const bestTimeByPlatform = {
    instagram: 10,
    facebook: 11,
    linkedin: 9,
    youtube: 14,
    tiktok: 15,
    twitter: 8,
    x: 8,
  };

  if (safeMode === 'spread_evenly' && days.length > 0) {
    const step = Math.max(1, Math.floor(days.length / Math.max(records.length, 1)));
    return safeArray(records).map((record, index) => {
      const targetDay = days[Math.min(index * step, days.length - 1)];
      const slot = new Date(targetDay);
      slot.setHours(10 + (index % 3) * 2, 0, 0, 0);
      return slot.toISOString();
    });
  }

  safeArray(records).forEach((record, index) => {
    const day = days[index % Math.max(days.length, 1)] || new Date(rangeStart);
    const dayKey = startOfDay(day).toISOString();
    const usedCount = usedByDay.get(dayKey) || 0;
    const slot = new Date(day);
    const platformHour = bestTimeByPlatform[String(record?.platform || '').toLowerCase()];

    if (safeMode === 'best_times' && Number.isFinite(platformHour)) {
      slot.setHours(platformHour, 0, 0, 0);
    } else if (safeMode === 'one_per_day') {
      slot.setHours(10, 0, 0, 0);
    } else {
      slot.setHours(10 + Math.min(usedCount, 4) * 2, 0, 0, 0);
    }

    usedByDay.set(dayKey, usedCount + 1);
    nextSlots.push(slot.toISOString());
  });

  return nextSlots;
}

export function previewOrgCalendarBatchSchedule({
  records = [],
  existingRecords = [],
  mode = 'fill_next_open_slots',
  rangeStart,
  rangeEnd,
}) {
  const schedulable = safeArray(records).filter((record) => record?.canScheduleAction);
  if (schedulable.length === 0) {
    return {
      plan: [],
      skipped: safeArray(records).map((record) => ({
        id: record?.id || crypto.randomUUID(),
        title: record?.title || 'Content',
        reason: 'Item is not schedulable.',
      })),
    };
  }

  const slots = createBatchSlots({
    mode,
    rangeStart,
    rangeEnd,
    existingRecords,
    records: schedulable,
  });

  const plan = [];
  const skipped = [];
  const today = startOfDay(new Date());

  schedulable.forEach((record, index) => {
    const scheduledAt = slots[index];
    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate < today) {
      skipped.push({
        id: record.id,
        title: record.title,
        reason: 'Past dates are locked.',
      });
      return;
    }

    plan.push({
      id: record.id,
      record,
      scheduledAt,
      caption: String(record.captionText || record.previewText || '').trim(),
      hashtags: safeArray(record.hashtags),
      mediaPreviewUrl: record.mediaPreviewUrl || null,
    });
  });

  return { plan, skipped };
}

export async function executeOrgCalendarBatchSchedule({
  plan = [],
}) {
  const results = [];

  for (const entry of safeArray(plan)) {
    try {
      if (entry.record?.postId) {
        await updateOrgScheduledPost(entry.record.postId, {
          caption: String(entry.caption || '').trim(),
          hashtags: safeArray(entry.hashtags),
        });
      }

      await scheduleOrgCalendarRecord({
        postId: entry.record?.postId,
        pipelineItemId: entry.record?.pipelineItemId || null,
        scheduledAt: entry.scheduledAt,
      });
      results.push({
        id: entry.record?.id,
        success: true,
      });
    } catch (error) {
      results.push({
        id: entry.record?.id,
        success: false,
        error: error?.message || 'Scheduling failed.',
      });
    }
  }

  return results;
}

export async function updateOrgScheduledPost(postId, updates) {
  if (!postId) throw new Error('A post id is required.');

  const { data, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .select(`
      id,
      user_id,
      organization_id,
      brand_project_id,
      generation_id,
      pipeline_item_id,
      account_id,
      caption,
      hashtags,
      status,
      platform,
      scheduled_at,
      published_at,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data;
}

export async function scheduleOrgCalendarRecord({
  postId,
  pipelineItemId = null,
  scheduledAt,
  accountId = null,
}) {
  const nextScheduledAt = new Date(scheduledAt);
  if (Number.isNaN(nextScheduledAt.getTime())) {
    throw new Error('Choose a valid date first.');
  }

  const isoDate = nextScheduledAt.toISOString();

  if (pipelineItemId) {
    const { data, error } = await supabase.functions.invoke('org-calendar-publish', {
      body: {
        pipeline_item_id: pipelineItemId,
        action: 'schedule',
        scheduled_for: isoDate,
        account_id: accountId || null,
      },
    });

    if (error) throw error;
    return data;
  }

  if (postId && accountId) {
    const context = await fetchOrgScheduleContext({ postId });
    const destination = safeArray(context?.destinations).find((account) => account.id === accountId) || null;
    if (!destination) {
      throw new Error('Selected account is not available for this post.');
    }
    if (isUnavailableOrgDestination(destination)) {
      throw new Error('You do not have posting access to this organization account.');
    }
  }

  return updateOrgScheduledPost(postId, {
    scheduled_at: isoDate,
    status: POST_STATUS.SCHEDULED,
    ...(accountId ? { account_id: accountId } : {}),
  });
}

export async function publishOrgCalendarRecord(pipelineItemId) {
  if (!pipelineItemId) {
    throw new Error('A pipeline item is required to publish content.');
  }

  const context = await fetchOrgScheduleContext({ pipelineItemId });
  const { data, error } = await supabase.functions.invoke('org-calendar-publish', {
    body: {
      pipeline_item_id: pipelineItemId,
      action: 'publish_now',
    },
  });

  if (error) {
    toEdgeFunctionError(error, 'org-calendar-publish');
  }

  const attempt = {
    postId: data?.post_id || context?.post?.id || null,
    accountId: context?.post?.account_id || null,
    userId: context?.post?.user_id || null,
    organizationId: context?.post?.organization_id || null,
    platform: context?.post?.platform || context?.destinations?.find((account) => account.id === context?.post?.account_id)?.platform || 'unknown',
    platformDisplayName: context?.post?.platform || 'Platform',
    accountDisplayName: context?.destinations?.find((account) => account.id === context?.post?.account_id)?.account_name
      || context?.destinations?.find((account) => account.id === context?.post?.account_id)?.username
      || 'Connected account',
    accountUsername: context?.destinations?.find((account) => account.id === context?.post?.account_id)?.username || '',
    profilePictureUrl: context?.destinations?.find((account) => account.id === context?.post?.account_id)?.avatar_url || '',
    caption: context?.post?.caption || context?.generation?.prompt || '',
    mediaUrl: context?.generation?.storage_path || null,
    mediaType: context?.generation?.media_type || 'image',
    mockPostId: data?.mockPostId || null,
    mockPostUrl: data?.mockPostUrl || null,
    failureReason: data?.failureReason || null,
    failureIsRetriable: Boolean(data?.failureIsRetriable),
    success: data?.success !== false,
    settingsPath: context?.organization?.id ? `/app/org/${context.organization.id}/admin/settings` : null,
  };

  emitMockPublishComplete({
    source: 'org_calendar',
    viewPath: context?.organization?.id ? `/app/org/${context.organization.id}/calendar` : null,
    viewLabel: 'View in Calendar',
    accountsPath: context?.organization?.id ? `/app/org/${context.organization.id}/admin/settings` : null,
    accountsLabel: 'Open Connected Accounts',
    attempts: [attempt],
    summary: buildPublishSummary([attempt]),
  });

  if (!attempt.success) {
    const nextError = new Error(buildPublishSummary([attempt]).message);
    nextError.publishEventDispatched = true;
    throw nextError;
  }

  return data;
}
