import { supabase } from '../../services/supabaseClient';
import {
  buildUnavailableEdgeFunctionMessage,
  clearEdgeFunctionUnavailable,
  isEdgeFunctionUnavailable,
  markEdgeFunctionUnavailable,
  normalizeEdgeFunctionError,
  shouldSkipEdgeFunction,
} from '../../services/edgeFunctionClient';

const SCHEDULE_CONTEXT_FUNCTION = 'org-get-schedule-context';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function toEdgeFunctionError(error, functionName) {
  throw await normalizeEdgeFunctionError(error, functionName);
}

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Invalid date';
  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getPlatformLabel(platform) {
  const normalized = String(platform || '').trim();
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getStatusLabel(status) {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'in_review':
      return 'In Review';
    case 'revision_requested':
      return 'Changes Requested';
    case 'approved':
      return 'Approved';
    case 'scheduled':
      return 'Scheduled';
    case 'published':
      return 'Published';
    case 'rejected':
      return 'Rejected';
    case 'withdrawn':
      return 'Withdrawn';
    case 'failed':
      return 'Failed';
    default:
      return 'Content';
  }
}

function stripHashtagsFromText(value) {
  return String(value || '')
    .replace(/#[\w_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 120) {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function getContentTypeLabel(mediaType) {
  const normalized = String(mediaType || '').trim().toLowerCase();
  if (normalized === 'video') return 'Video';
  if (normalized === 'image') return 'Image';
  if (normalized === 'edit') return 'Edit';
  return '';
}

export async function fetchOrgScheduleContext({
  pipelineItemId = null,
  postId = null,
}) {
  if (!pipelineItemId && !postId) {
    throw new Error('A schedule target is required.');
  }

  if (shouldSkipEdgeFunction(SCHEDULE_CONTEXT_FUNCTION)) {
    throw new Error(buildUnavailableEdgeFunctionMessage(SCHEDULE_CONTEXT_FUNCTION));
  }

  const { data, error } = await supabase.functions.invoke(SCHEDULE_CONTEXT_FUNCTION, {
    body: {
      pipeline_item_id: pipelineItemId || null,
      post_id: postId || null,
    },
  });

  if (error) {
    if (isEdgeFunctionUnavailable(error)) {
      markEdgeFunctionUnavailable(SCHEDULE_CONTEXT_FUNCTION);
    }
    await toEdgeFunctionError(error, SCHEDULE_CONTEXT_FUNCTION);
  }

  clearEdgeFunctionUnavailable(SCHEDULE_CONTEXT_FUNCTION);
  return safeObject(data);
}

export function buildScheduleModalRecord({
  initialRecord = null,
  context = null,
}) {
  const baseRecord = initialRecord && typeof initialRecord === 'object' ? initialRecord : {};
  const nextContext = safeObject(context);
  const post = safeObject(nextContext.post);
  const pipelineItem = safeObject(nextContext.pipeline_item);
  const generation = safeObject(nextContext.generation);
  const owner = safeObject(nextContext.owner);
  const reviewer = safeObject(nextContext.reviewer);
  const task = safeObject(nextContext.task);
  const resolved = safeObject(nextContext.resolved);
  const permissions = safeObject(nextContext.permissions);
  const attachedAssets = safeArray(nextContext.attached_assets);
  const currentAccount = safeArray(nextContext.destinations).find((account) => account.id === post.account_id) || null;
  const platform = post.platform || currentAccount?.platform || baseRecord.platform || 'unknown';
  const lifecycleStatus = resolved.lifecycle_status || baseRecord.lifecycleStatus || 'draft';
  const scheduleValue = post.scheduled_at || pipelineItem.scheduled_for || baseRecord.scheduledAt || null;
  const captionText = String(post.caption || baseRecord.captionText || '').trim();
  const promptText = String(generation.prompt || pipelineItem.submission_note || baseRecord.previewText || '').trim();
  const previewText = truncateText(stripHashtagsFromText(captionText || promptText || baseRecord.title || ''));
  const mediaPreviewUrl = attachedAssets[0]?.thumbnail_url
    || attachedAssets[0]?.file_url
    || generation.storage_path
    || baseRecord.mediaPreviewUrl
    || null;

  return {
    ...baseRecord,
    id: baseRecord.id || (pipelineItem.id ? `pipeline:${pipelineItem.id}` : (post.id ? `post:${post.id}` : 'schedule-context')),
    postId: post.id || baseRecord.postId || null,
    pipelineItemId: pipelineItem.id || baseRecord.pipelineItemId || null,
    title: baseRecord.title || captionText || promptText || pipelineItem.title || 'Untitled content',
    lifecycleStatus,
    statusLabel: getStatusLabel(lifecycleStatus),
    tone: resolved.tone || baseRecord.tone || 'draft',
    platform,
    platformLabel: getPlatformLabel(platform),
    contentTypeLabel: getContentTypeLabel(generation.media_type || attachedAssets[0]?.file_type || baseRecord.contentTypeLabel),
    ownerId: post.user_id || baseRecord.ownerId || null,
    ownerName: owner.full_name || owner.email || baseRecord.ownerName || 'Team member',
    assigneeLabel: reviewer.full_name || reviewer.email || pipelineItem.current_assignee_role || baseRecord.assigneeLabel || '',
    stageLabel: pipelineItem.current_stage_name || baseRecord.stageLabel || '',
    createdAt: post.created_at || baseRecord.createdAt || null,
    updatedAt: post.updated_at || baseRecord.updatedAt || null,
    scheduledAt: scheduleValue,
    scheduleLabel: scheduleValue ? formatDateTime(scheduleValue) : '',
    publishedAt: post.published_at || baseRecord.publishedAt || null,
    brandProjectId: post.brand_project_id || baseRecord.brandProjectId || null,
    previewText: previewText || baseRecord.previewText || '',
    captionText: captionText || baseRecord.captionText || '',
    hashtags: safeArray(post.hashtags).length > 0 ? safeArray(post.hashtags) : safeArray(baseRecord.hashtags),
    mediaPreviewUrl,
    canScheduleAction: permissions.can_schedule_action ?? baseRecord.canScheduleAction ?? false,
    canPublishAction: permissions.can_publish_action ?? baseRecord.canPublishAction ?? false,
    canReviewAction: permissions.can_review_action ?? baseRecord.canReviewAction ?? false,
    canGenerateClientReviewLink: permissions.can_generate_client_review_link ?? baseRecord.canGenerateClientReviewLink ?? false,
    stageGeneratesClientReviewLink: Boolean(pipelineItem.current_stage_generates_client_review_link || baseRecord.stageGeneratesClientReviewLink),
    clientReviewToken: pipelineItem.client_review_token || baseRecord.clientReviewToken || null,
    clientReviewTokenExpiresAt: pipelineItem.client_review_token_expires_at || baseRecord.clientReviewTokenExpiresAt || null,
    isPastLocked: resolved.is_past_locked ?? baseRecord.isPastLocked ?? false,
    attachedAssets: attachedAssets.length > 0 ? attachedAssets : safeArray(baseRecord.attachedAssets),
    taskId: task.id || post.task_id || pipelineItem.task_id || baseRecord.taskId || null,
    taskTitle: task.title || baseRecord.taskTitle || '',
    taskStatusLabel: task.status?.name || baseRecord.taskStatusLabel || '',
    taskDueLabel: task.due_at ? formatDateTime(task.due_at) : (baseRecord.taskDueLabel || ''),
    isTaskBlocked: Boolean(task.is_blocked || baseRecord.isTaskBlocked),
    rawPost: Object.keys(post).length > 0 ? {
      ...post,
      generation,
      media: generation,
    } : (baseRecord.rawPost || null),
    rawPipelineItem: Object.keys(pipelineItem).length > 0 ? pipelineItem : (baseRecord.rawPipelineItem || null),
    currentAccount,
  };
}
