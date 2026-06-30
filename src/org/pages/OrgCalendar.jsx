"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutGrid,
  Plus,
  Rows3,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import OrgEmptyState from '../components/OrgEmptyState';
import OrgGenerateComposer from '../components/OrgGenerateComposer';
import OrgSelect from '../components/OrgSelect';
import { UiTabs } from '../../components/Shared/ui';
import CalendarApprovalTracker from '../components/calendar/CalendarApprovalTracker';
import CalendarBatchScheduleModal from '../components/calendar/CalendarBatchScheduleModal';
import CalendarContentCard from '../components/calendar/CalendarContentCard';
import CalendarLibraryPicker from '../components/calendar/CalendarLibraryPicker';
import OrgScheduleModal from '../components/calendar/OrgScheduleModal';
import CalendarSavedViewsMenu from '../components/calendar/CalendarSavedViewsMenu';
import CalendarStatusBoard from '../components/calendar/CalendarStatusBoard';
import CalendarTimelineView from '../components/calendar/CalendarTimelineView';
import TaskBoardView from '../components/tasks/TaskBoardView';
import TaskCreateModal from '../components/tasks/TaskCreateModal';
import TaskDetailDrawer from '../components/tasks/TaskDetailDrawer';
import TaskTableView from '../components/tasks/TaskTableView';
import useOrgCalendar from '../hooks/useOrgCalendar';
import useOrgContext from '../hooks/useOrgContext';
import {
  formatTaskDateTime,
  safeTaskArray,
} from '../utils/tasks';
import { buildDeepLink } from '../../utils/buildDeepLink';
const VIEW_MODES = [
  { id: 'calendar', label: 'Master Calendar', icon: LayoutGrid },
  { id: 'week', label: 'Week', icon: Rows3 },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
  { id: 'board', label: 'Status Board', icon: LayoutGrid },
  { id: 'queue', label: 'Queue', icon: Inbox },
  { id: 'approval', label: 'Approval Tracker', icon: Shield },
  { id: 'workload', label: 'Workload', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: Rows3 },
];

const BOARD_COLUMN_CONFIG = [
  { id: 'draft', label: 'Draft / Idea', description: 'Content still being shaped.' },
  { id: 'in_review', label: 'In Review', description: 'Awaiting reviewer action.' },
  { id: 'revision_requested', label: 'Changes Requested', description: 'Needs revision before approval.' },
  { id: 'approved', label: 'Approved', description: 'Ready to place on the calendar.' },
  { id: 'scheduled', label: 'Scheduled', description: 'Placed and ready for execution.' },
  { id: 'published', label: 'Published', description: 'Live content and recent completions.' },
];

const ARCHIVE_STATUSES = new Set(['rejected', 'withdrawn', 'failed']);
const SHARED_VIEW_ROLES = new Set(['org_owner', 'org_admin']);
const ACTIVE_APPROVAL_STATUSES = new Set(['pending', 'in_review', 'revision_requested']);
const TIMELINE_DAY_COUNT = 28;

function startOfDay(value) {
  const nextDate = new Date(value);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function endOfDay(value) {
  const nextDate = new Date(value);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function addDays(value, amount) {
  const nextDate = new Date(value);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function addMonths(value, amount) {
  return startOfDay(new Date(value.getFullYear(), value.getMonth() + amount, 1));
}

function startOfWeek(value) {
  const nextDate = startOfDay(value);
  const day = nextDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  nextDate.setDate(nextDate.getDate() + diff);
  return nextDate;
}

function startOfMonth(value) {
  return startOfDay(new Date(value.getFullYear(), value.getMonth(), 1));
}

function formatDayKey(value) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function formatDayLabel(value) {
  return value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRangeLabel(viewMode, anchorDate, weekDays) {
  if (viewMode === 'calendar') {
    return anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  if (viewMode === 'timeline') {
    const start = startOfWeek(anchorDate);
    const end = addDays(start, TIMELINE_DAY_COUNT - 1);
    return `${formatDayLabel(start)} - ${formatDayLabel(end)}`;
  }

  if (viewMode === 'week' && weekDays.length > 0) {
    return `${formatDayLabel(weekDays[0])} - ${formatDayLabel(weekDays[weekDays.length - 1])}`;
  }

  return anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getDisplayName(member, fallback = 'Team member') {
  return member?.profile?.full_name
    || member?.profile?.email
    || member?.email
    || fallback;
}

function getPlatform(record) {
  return record?.account?.platform || record?.platform || 'unknown';
}

function getAccountScope(record) {
  const scope = String(record?.account?.scope || '').trim().toLowerCase();
  return scope || null;
}

function getAccountScopeLabel(scope) {
  if (scope === 'organization') return 'Org';
  if (scope === 'personal') return 'Personal';
  return '';
}

function getPlatformLabel(platform) {
  const normalized = String(platform || '').trim();
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getContentTypeLabel(record) {
  const mediaType = String(record?.media?.media_type || record?.generation?.media_type || '').toLowerCase();
  if (mediaType === 'video') return 'Video';
  if (mediaType === 'image') return 'Image';
  if (mediaType === 'edit') return 'Edit';
  return '';
}

function getCardTitle(record) {
  if (record?.caption) return record.caption;
  if (record?.media?.prompt) return record.media.prompt;
  if (record?.title) return record.title;
  return 'Untitled content';
}

function stripHashtagsFromText(value) {
  return String(value || '')
    .replace(/#[\w_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 140) {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getRecordPreviewText(record) {
  const base = stripHashtagsFromText(
    record?.caption
      || record?.media?.prompt
      || record?.submission_note
      || record?.title
      || '',
  );

  return truncateText(base, 120).replace('â€¦', '...');
}

function getRecordHashtags(record) {
  if (Array.isArray(record?.hashtags) && record.hashtags.length > 0) {
    return record.hashtags;
  }

  return String(record?.caption || '')
    .match(/#[\w_]+/g) || [];
}

function getRecordMediaPreviewUrl(record) {
  const attachedAsset = Array.isArray(record?.attachedAssets) ? record.attachedAssets[0] : null;
  return attachedAsset?.thumbnail_url
    || attachedAsset?.file_url
    || record?.media?.storage_path
    || record?.generation?.storage_path
    || null;
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

function getStatusTone(status) {
  switch (status) {
    case 'published':
      return 'published';
    case 'scheduled':
      return 'scheduled';
    case 'approved':
      return 'approved';
    case 'in_review':
      return 'review';
    case 'revision_requested':
    case 'rejected':
    case 'withdrawn':
    case 'failed':
      return 'blocked';
    default:
      return 'draft';
  }
}

function deriveLifecycleStatus(post, pipelineItem) {
  if (pipelineItem?.status === 'scheduled') return 'scheduled';
  if (pipelineItem?.status === 'published') return 'published';
  if (pipelineItem?.status === 'approved') {
    if (post?.status === 'scheduled') return 'scheduled';
    if (post?.status === 'published') return 'published';
    return 'approved';
  }
  if (pipelineItem?.status === 'revision_requested') return 'revision_requested';
  if (pipelineItem?.status === 'rejected') return 'rejected';
  if (pipelineItem?.status === 'withdrawn') return 'withdrawn';
  if (pipelineItem?.status === 'pending' || pipelineItem?.status === 'in_review') return 'in_review';
  if (post?.status === 'published') return 'published';
  if (post?.status === 'scheduled') return 'scheduled';
  if (post?.status === 'failed') return 'failed';
  return 'draft';
}

function getSlaState(deadline) {
  if (!deadline) return null;
  const nextDate = new Date(deadline);
  if (Number.isNaN(nextDate.getTime())) return null;
  const diffMs = nextDate.getTime() - Date.now();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (diffHours < 0) return { label: 'Overdue', tone: 'blocked' };
  if (diffHours <= 24) return { label: `${Math.max(diffHours, 1)}h left`, tone: 'review' };
  return { label: `${Math.ceil(diffHours / 24)}d left`, tone: 'approved' };
}

function getAgeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Added today';
  if (diffDays === 1) return '1 day old';
  return `${diffDays} days old`;
}

function canActOnPipelineItem(item, userId, role) {
  const normalizedRole = String(role || '').trim();
  const adminLike = ['org_owner', 'org_admin', 'editor'].includes(normalizedRole);
  if (adminLike) return true;
  if (item?.current_assignee_user_id) return item.current_assignee_user_id === userId;
  const stageRole = String(item?.current_assignee_role || '').trim();
  return Boolean(stageRole) && stageRole === normalizedRole;
}

function parseDropTarget(value) {
  const parts = String(value || '').split(':');
  if (parts[0] === 'day' && parts[1]) return { dayKey: parts[1] };
  if (parts[0] === 'timeline' && parts[2]) return { laneKey: parts[1], dayKey: parts[2] };
  return null;
}

function parseTaskDropTarget(value) {
  const parts = String(value || '').split(':');
  if (parts[0] === 'task-status' && parts[1]) {
    return { statusId: parts[1] };
  }
  return null;
}

function buildScheduledDropDate(dayKey, existingValue = null) {
  const existingDate = existingValue ? new Date(existingValue) : null;
  const hour = existingDate && !Number.isNaN(existingDate.getTime()) ? existingDate.getHours() : 10;
  const minute = existingDate && !Number.isNaN(existingDate.getTime()) ? existingDate.getMinutes() : 0;
  const nextDate = new Date(`${dayKey}T00:00:00`);
  nextDate.setHours(hour, minute, 0, 0);
  return nextDate.toISOString();
}

function isPastDay(value) {
  if (!value) return false;
  const date = startOfDay(new Date(value));
  if (Number.isNaN(date.getTime())) return false;
  return date < startOfDay(new Date());
}

function buildMultiAssetSeedPrompt(assets = []) {
  if (!Array.isArray(assets) || assets.length === 0) return '';
  const names = assets.map((asset) => asset?.name).filter(Boolean);
  const tags = [...new Set(assets.flatMap((asset) => Array.isArray(asset?.tags) ? asset.tags : []))];
  const descriptions = assets.map((asset) => asset?.description).filter(Boolean).slice(0, 3);
  const parts = [`Create social content inspired by these selected assets: ${names.join(', ')}.`];
  if (descriptions.length > 0) parts.push(`Reference notes: ${descriptions.join(' ')}`);
  if (tags.length > 0) parts.push(`Themes or tags: ${tags.slice(0, 8).join(', ')}.`);
  return parts.join(' ');
}

function buildTaskSearchValue(task) {
  return [
    task.title,
    task.description,
    task.status?.name,
    task.priority,
    task.assignee_profile?.full_name,
    task.assignee_profile?.email,
    task.linked_post?.caption,
    task.linked_pipeline_item?.title,
    task.blocked_reason,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

function filterTask(task, filters = {}) {
  const assigneeMatch = filters.assignee === 'all' || task.assignee_user_id === filters.assignee;
  const statusMatch = filters.status === 'all' || task.status_id === filters.status;
  const priorityMatch = filters.priority === 'all' || task.priority === filters.priority;
  const includeCompleted = filters.includeCompleted !== false;
  const completedMatch = includeCompleted || task.status?.key !== 'completed';
  const blockedMatch = filters.blocked === 'all'
    || (filters.blocked === 'blocked' ? Boolean(task.is_blocked) : !task.is_blocked);
  const searchValue = String(filters.search || '').trim().toLowerCase();
  const searchMatch = !searchValue || buildTaskSearchValue(task).includes(searchValue);
  return assigneeMatch && statusMatch && priorityMatch && completedMatch && blockedMatch && searchMatch;
}

function filterRecord(record, filters) {
  const memberMatch = filters.member === 'all' || record.ownerId === filters.member;
  const platformMatch = filters.platform === 'all' || record.platform === filters.platform;
  const statusMatch = filters.status === 'all' || record.lifecycleStatus === filters.status;
  return memberMatch && platformMatch && statusMatch;
}

function SummaryTile({ label, value, copy, tone = 'default' }) {
  return (
    <article className={`org-calendar-summary-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{copy}</small>
    </article>
  );
}

function DraggableCalendarCard({ record, variant = 'ops', onOpenRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `calendar-record:${record.id}`,
    disabled: !record.dragEnabled,
    data: { record },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`org-calendar-draggable ${isDragging ? 'dragging' : ''} ${record.dragEnabled ? '' : 'disabled'}`.trim()}
      {...attributes}
      {...listeners}
    >
      <CalendarContentCard record={record} variant={variant} onClick={() => onOpenRecord(record)} />
    </div>
  );
}

function QuickAddMenu({
  day,
  disabled = false,
  onGenerate,
  onBrowseLibrary,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleGenerate = () => {
    setOpen(false);
    onGenerate?.(day);
  };

  const handleBrowse = () => {
    setOpen(false);
    onBrowseLibrary?.(day);
  };

  return (
    <div ref={rootRef} className={`org-calendar-quick-add ${open ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="org-calendar-cell-add"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label="Add content"
      >
        <Plus size={12} />
      </button>

      {open ? (
        <div className="org-calendar-quick-add-menu">
          <button type="button" onClick={handleGenerate}>
            Generate Content
          </button>
          <button type="button" onClick={handleBrowse}>
            Add From Library
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MonthCell({
  day,
  items,
  reviewCount,
  isCurrentMonth,
  onOpenRecord,
  onCreateDraft,
  onBrowseLibrary,
}) {
  const dayKey = formatDayKey(day);
  const locked = isPastDay(day);
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dayKey}`,
    disabled: locked,
    data: { dayKey },
  });

  return (
    <section
      ref={setNodeRef}
      className={`org-calendar-month-cell ${isCurrentMonth ? '' : 'muted'} ${isOver ? 'over' : ''} ${locked ? 'locked' : ''}`.trim()}
    >
      <div className="org-calendar-month-label">
        <strong>{day.getDate()}</strong>
        <div className="org-calendar-cell-actions">
          {reviewCount > 0 ? <span>{reviewCount} due</span> : null}
          <QuickAddMenu
            day={day}
            disabled={locked}
            onGenerate={onCreateDraft}
            onBrowseLibrary={onBrowseLibrary}
          />
        </div>
      </div>

      {locked ? <div className="org-calendar-day-lock">Locked</div> : null}

      <div className="org-calendar-month-stack">
        {items.slice(0, 3).map((item) => (
          <CalendarContentCard
            key={item.id}
            record={item}
            variant="compact"
            onClick={() => onOpenRecord(item)}
          />
        ))}

        {items.length > 3 ? (
          <button type="button" className="org-calendar-month-more" onClick={() => onOpenRecord(items[3])}>
            +{items.length - 3} more
          </button>
        ) : null}
      </div>
    </section>
  );
}

function WeekDropColumn({
  day,
  items,
  reviewCount,
  onOpenRecord,
  onCreateDraft,
  onBrowseLibrary,
}) {
  const dayKey = formatDayKey(day);
  const locked = isPastDay(day);
  const { isOver, setNodeRef } = useDroppable({
    id: `day:${dayKey}`,
    disabled: locked,
    data: { dayKey },
  });

  return (
    <section ref={setNodeRef} className={`org-calendar-week-column ${isOver ? 'over' : ''} ${locked ? 'locked' : ''}`.trim()}>
      <header>
        <div>
          <strong>{formatDayLabel(day)}</strong>
          <span>{items.length} scheduled</span>
        </div>
        <QuickAddMenu
          day={day}
          disabled={locked}
          onGenerate={onCreateDraft}
          onBrowseLibrary={onBrowseLibrary}
        />
      </header>

      {reviewCount > 0 ? (
        <div className="org-calendar-week-review-strip">
          <span>{reviewCount} approvals due</span>
        </div>
      ) : null}

      {locked ? <div className="org-calendar-day-lock">Past date locked</div> : null}

      <div className="org-calendar-week-stack">
        {items.length === 0 ? (
          <div className="org-calendar-empty-inline">No scheduled work.</div>
        ) : (
          items.map((item) => (
            <DraggableCalendarCard
              key={item.id}
              record={item}
              variant="week"
              onOpenRecord={onOpenRecord}
            />
          ))
        )}
      </div>
    </section>
  );
}

function WorkloadTable({ rows = [] }) {
  return (
    <div className="org-calendar-workload-table">
      <div className="org-calendar-workload-head">
        <span>Member</span>
        <span>Scheduled</span>
        <span>Drafts</span>
        <span>Approved</span>
        <span>In Review</span>
        <span>Overdue</span>
      </div>

      {rows.length === 0 ? (
        <div className="org-calendar-empty-inline">No workload data is available for the current filters.</div>
      ) : (
        rows.map((row) => (
          <div key={row.userId} className="org-calendar-workload-row">
            <div>
              <strong>{row.label}</strong>
              <small>{row.roleLabel}</small>
            </div>
            <span>{row.scheduled}</span>
            <span>{row.drafts}</span>
            <span>{row.approved}</span>
            <span>{row.inReview}</span>
            <span className={row.overdue > 0 ? 'danger' : ''}>{row.overdue}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function OrgCalendar() {
  const { navigate } = useAppNavigation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const {
    organizationId,
    organization,
    activeBrandProject,
  } = useOrgContext();
  const {
    loading,
    error,
    members,
    posts,
    pipelineItems,
    taskStatuses,
    tasks,
    assets,
    stats,
    userId,
    role,
    canSchedule,
    canPublish,
    canManageTasks,
    visibleViews,
    presets,
    presetsLoading,
    refresh,
    scheduleRecord,
    publishRecord,
    actOnPipelineItem,
    createPreset,
    updatePreset,
    deletePreset,
    previewBatchSchedule,
    executeBatchSchedule,
    createTask,
    saveTask,
    removeTask,
    addTaskNote,
  } = useOrgCalendar();

  const navigateToPipeline = useCallback((pipelineItemId = null, source = 'org_calendar') => {
    const target = buildDeepLink({
      path: `/app/org/${organizationId}/pipeline`,
      source,
      target: 'org_pipeline_item',
      params: pipelineItemId ? { pipelineItemId } : {},
    });
    navigate(target.path, { state: target.state });
  }, [navigate, organizationId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [anchorDate, setAnchorDate] = useState(() => startOfMonth(new Date()));
  const [viewMode, setViewMode] = useState('calendar');
  const [filters, setFilters] = useState({ member: 'all', platform: 'all', status: 'all' });
  const [timelineLaneMode, setTimelineLaneMode] = useState('member');
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerIntent, setComposerIntent] = useState(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryTargetDate, setLibraryTargetDate] = useState(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [defaultPresetApplied, setDefaultPresetApplied] = useState(false);
  const [taskPresentation, setTaskPresentation] = useState('board');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskFilters, setTaskFilters] = useState({
    assignee: 'all',
    status: 'all',
    priority: 'all',
    blocked: 'all',
    includeCompleted: true,
  });
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const filtersRef = useRef(null);
  const handledSearchPostIdRef = useRef('');

  const visibleViewOptions = useMemo(
    () => VIEW_MODES.filter((item) => visibleViews.includes(item.id)),
    [visibleViews],
  );
  const canManageSharedViews = SHARED_VIEW_ROLES.has(String(role || '').trim());

  useEffect(() => {
    if (!visibleViews.includes(viewMode)) {
      setViewMode(visibleViews[0] || 'calendar');
    }
  }, [viewMode, visibleViews]);

  useEffect(() => {
    setDefaultPresetApplied(false);
  }, [organizationId, userId]);

  useEffect(() => {
    if (!filtersOpen) return undefined;

    function handleClickOutside(event) {
      if (!filtersRef.current?.contains(event.target)) {
        setFiltersOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filtersOpen]);

  const effectiveFilters = useMemo(() => {
    if (!['contributor', 'reviewer'].includes(String(role || '').trim()) || !userId) {
      return filters;
    }

    return {
      ...filters,
      member: filters.member === 'all' ? userId : filters.member,
    };
  }, [filters, role, userId]);

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [anchorDate]);

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(anchorDate);
    const calendarStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  }, [anchorDate]);

  const records = useMemo(() => {
    const linkedPostIds = new Set();
    const nextRecords = [];

    pipelineItems.forEach((item) => {
      const linkedPost = item.linkedPost || null;
      if (linkedPost?.id) linkedPostIds.add(linkedPost.id);

      const lifecycleStatus = deriveLifecycleStatus(linkedPost, item);
      const ownerMember = linkedPost?.member || item.member || item.submitter || null;
      const ownerName = getDisplayName(ownerMember, linkedPost?.user_id === userId ? 'You' : 'Team member');
      const platform = getPlatform(linkedPost || item);
      const accountScope = getAccountScope(linkedPost || item);
      const slaState = getSlaState(item.sla_deadline);
      const scheduledAt = linkedPost?.scheduled_at || item.scheduled_for || null;
      const attachedAssets = Array.isArray(item.attached_assets) && item.attached_assets.length > 0
        ? item.attached_assets
        : linkedPost?.attachedAssets || [];
      const captionText = String(linkedPost?.caption || '').trim();
      const hashtags = getRecordHashtags(linkedPost);
      const previewText = getRecordPreviewText({
        caption: linkedPost?.caption,
        media: linkedPost?.media,
        submission_note: item.submission_note,
        title: item.title,
      });
      const mediaPreviewUrl = getRecordMediaPreviewUrl({
        attachedAssets,
        media: linkedPost?.media,
      });
      const canScheduleAction = Boolean(
        canSchedule
        && linkedPost?.id
        && ['approved', 'scheduled'].includes(lifecycleStatus)
        && !isPastDay(scheduledAt)
      );

      nextRecords.push({
        id: `pipeline:${item.id}`,
        postId: linkedPost?.id || null,
        pipelineItemId: item.id,
        title: getCardTitle(linkedPost || item),
        lifecycleStatus,
        statusLabel: getStatusLabel(lifecycleStatus),
        tone: getStatusTone(lifecycleStatus),
        platform,
        platformLabel: getPlatformLabel(platform),
        accountScope,
        accountScopeLabel: getAccountScopeLabel(accountScope),
        contentTypeLabel: getContentTypeLabel(linkedPost || item),
        ownerId: linkedPost?.user_id || ownerMember?.userId || item.submitted_by || null,
        ownerName,
        assigneeLabel: item.assigneeMember
          ? getDisplayName(item.assigneeMember)
          : (item.current_assignee_role || '').replace(/_/g, ' '),
        submitterLabel: item.submitter ? getDisplayName(item.submitter) : ownerName,
        stageLabel: item.currentStageName || 'Stage',
        slaLabel: slaState?.label || null,
        slaTone: slaState?.tone || null,
        createdAt: linkedPost?.created_at || item.created_at || null,
        updatedAt: linkedPost?.updated_at || item.updated_at || null,
        scheduledAt,
        scheduleLabel: scheduledAt ? formatDateTime(scheduledAt) : '',
        publishedAt: linkedPost?.published_at || null,
        brandProjectId: item.brand_project_id || linkedPost?.brand_project_id || null,
        brandProjectLabel: activeBrandProject?.id === (item.brand_project_id || linkedPost?.brand_project_id)
          ? activeBrandProject.name
          : (item.brand_project_id || linkedPost?.brand_project_id ? 'Brand Project' : 'Org-wide'),
        ageLabel: getAgeLabel(item.created_at || linkedPost?.created_at),
        captionText,
        hashtags,
        previewText,
        mediaPreviewUrl,
        dragEnabled: canScheduleAction,
        canScheduleAction,
        canPublishAction: Boolean(canPublish && ['approved', 'scheduled'].includes(lifecycleStatus) && !isPastDay(scheduledAt)),
        canReviewAction: canActOnPipelineItem(item, userId, role),
        isPastLocked: isPastDay(scheduledAt),
        attachedAssets,
        rawPost: linkedPost,
        rawPipelineItem: item,
      });
    });

    posts.forEach((post) => {
      if (linkedPostIds.has(post.id) || post.pipeline_item_id) return;

      const lifecycleStatus = deriveLifecycleStatus(post, null);
      const platform = getPlatform(post);
      const accountScope = getAccountScope(post);
      const captionText = String(post.caption || '').trim();
      const hashtags = getRecordHashtags(post);
      const previewText = getRecordPreviewText(post);
      const mediaPreviewUrl = getRecordMediaPreviewUrl({
        attachedAssets: post.attachedAssets,
        media: post.media,
      });
      const canScheduleAction = Boolean(
        canSchedule
        && ['draft', 'scheduled'].includes(lifecycleStatus)
        && !(post.scheduled_at && isPastDay(post.scheduled_at))
      );

      nextRecords.push({
        id: `post:${post.id}`,
        postId: post.id,
        pipelineItemId: null,
        title: getCardTitle(post),
        lifecycleStatus,
        statusLabel: getStatusLabel(lifecycleStatus),
        tone: getStatusTone(lifecycleStatus),
        platform,
        platformLabel: getPlatformLabel(platform),
        accountScope,
        accountScopeLabel: getAccountScopeLabel(accountScope),
        contentTypeLabel: getContentTypeLabel(post),
        ownerId: post.user_id,
        ownerName: getDisplayName(post.member, post.user_id === userId ? 'You' : 'Team member'),
        assigneeLabel: '',
        submitterLabel: '',
        stageLabel: '',
        slaLabel: null,
        slaTone: null,
        createdAt: post.created_at || null,
        updatedAt: post.updated_at || null,
        scheduledAt: post.scheduled_at || null,
        scheduleLabel: post.scheduled_at ? formatDateTime(post.scheduled_at) : '',
        publishedAt: post.published_at || null,
        brandProjectId: post.brand_project_id || null,
        brandProjectLabel: activeBrandProject?.id === post.brand_project_id
          ? activeBrandProject.name
          : (post.brand_project_id ? 'Brand Project' : 'Org-wide'),
        ageLabel: getAgeLabel(post.created_at),
        captionText,
        hashtags,
        previewText,
        mediaPreviewUrl,
        dragEnabled: canScheduleAction,
        canScheduleAction,
        canPublishAction: false,
        canReviewAction: false,
        isPastLocked: isPastDay(post.scheduled_at),
        attachedAssets: Array.isArray(post.attachedAssets) ? post.attachedAssets : [],
        rawPost: post,
        rawPipelineItem: null,
      });
    });

    return nextRecords.sort((left, right) => {
      const leftDate = new Date(left.scheduledAt || left.createdAt || 0).getTime();
      const rightDate = new Date(right.scheduledAt || right.createdAt || 0).getTime();
      return leftDate - rightDate;
    });
  }, [activeBrandProject, canPublish, canSchedule, pipelineItems, posts, role, userId]);

  const filteredRecords = useMemo(
    () => records.filter((record) => filterRecord(record, effectiveFilters)),
    [effectiveFilters, records],
  );

  const dayRecords = useMemo(() => {
    const grouped = new Map();
    filteredRecords.forEach((record) => {
      const value = record.scheduledAt || record.publishedAt;
      if (!value) return;
      const key = formatDayKey(new Date(value));
      const current = grouped.get(key) || [];
      current.push(record);
      grouped.set(key, current);
    });
    return grouped;
  }, [filteredRecords]);

  const reviewCountsByDay = useMemo(() => {
    const grouped = new Map();
    filteredRecords.forEach((record) => {
      if (!record.rawPipelineItem?.sla_deadline || !ACTIVE_APPROVAL_STATUSES.has(record.rawPipelineItem.status)) return;
      const key = formatDayKey(new Date(record.rawPipelineItem.sla_deadline));
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    return grouped;
  }, [filteredRecords]);

  const queueRecords = useMemo(
    () => filteredRecords
      .filter((record) => record.lifecycleStatus === 'approved' && !record.scheduledAt && record.pipelineItemId)
      .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0)),
    [filteredRecords],
  );

  const approvalRows = useMemo(
    () => filteredRecords
      .filter((record) => record.pipelineItemId && ACTIVE_APPROVAL_STATUSES.has(record.rawPipelineItem?.status))
      .sort((left, right) => {
        const leftOverdue = left.slaTone === 'blocked' ? 1 : 0;
        const rightOverdue = right.slaTone === 'blocked' ? 1 : 0;
        if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
        const leftDeadline = left.rawPipelineItem?.sla_deadline ? new Date(left.rawPipelineItem.sla_deadline).getTime() : Number.MAX_SAFE_INTEGER;
        const rightDeadline = right.rawPipelineItem?.sla_deadline ? new Date(right.rawPipelineItem.sla_deadline).getTime() : Number.MAX_SAFE_INTEGER;
        if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
        return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
      }),
    [filteredRecords],
  );

  const boardColumns = useMemo(
    () => BOARD_COLUMN_CONFIG.map((column) => ({
      ...column,
      records: filteredRecords.filter((record) => record.lifecycleStatus === column.id),
    })),
    [filteredRecords],
  );
  const archiveRecords = useMemo(
    () => filteredRecords.filter((record) => ARCHIVE_STATUSES.has(record.lifecycleStatus)),
    [filteredRecords],
  );

  const workloadRows = useMemo(
    () => members.map((member) => {
      const memberRecords = filteredRecords.filter((record) => record.ownerId === member.userId);
      return {
        userId: member.userId,
        label: getDisplayName(member),
        roleLabel: String(member.role || 'member').replace(/_/g, ' '),
        scheduled: memberRecords.filter((record) => record.lifecycleStatus === 'scheduled').length,
        drafts: memberRecords.filter((record) => record.lifecycleStatus === 'draft').length,
        approved: memberRecords.filter((record) => record.lifecycleStatus === 'approved').length,
        inReview: memberRecords.filter((record) => record.lifecycleStatus === 'in_review').length,
        overdue: memberRecords.filter((record) => record.slaTone === 'blocked').length,
      };
    }),
    [filteredRecords, members],
  );

  const taskStatusMap = useMemo(
    () => new Map(safeTaskArray(taskStatuses).map((status) => [status.id, status])),
    [taskStatuses],
  );
  const enrichedTasks = useMemo(
    () => safeTaskArray(tasks).map((task) => ({
      ...task,
      status: task.status || taskStatusMap.get(task.status_id) || null,
    })),
    [taskStatusMap, tasks],
  );
  const filteredTasks = useMemo(
    () => enrichedTasks.filter((task) => filterTask(task, { ...taskFilters, search: taskSearch })),
    [enrichedTasks, taskFilters, taskSearch],
  );
  const selectedTask = useMemo(
    () => filteredTasks.find((task) => task.id === selectedTaskId) || enrichedTasks.find((task) => task.id === selectedTaskId) || null,
    [enrichedTasks, filteredTasks, selectedTaskId],
  );
  const taskStats = useMemo(() => ({
    open: filteredTasks.filter((task) => task.status?.key !== 'completed').length,
    blocked: filteredTasks.filter((task) => task.is_blocked).length,
    dueSoon: filteredTasks.filter((task) => {
      if (!task?.due_at) return false;
      const dueAt = new Date(task.due_at).getTime();
      if (Number.isNaN(dueAt)) return false;
      const diffHours = (dueAt - Date.now()) / (1000 * 60 * 60);
      return diffHours >= 0 && diffHours <= 48;
    }).length,
    completed: filteredTasks.filter((task) => task.status?.key === 'completed').length,
  }), [filteredTasks]);
  const taskMemberOptions = useMemo(() => [
    { value: 'all', label: 'All Assignees', description: 'Show every assigned lane.' },
    ...members.map((member) => ({
      value: member.userId,
      label: getDisplayName(member),
      description: String(member.role || 'member').replace(/_/g, ' '),
    })),
  ], [members]);
  const taskStatusOptions = useMemo(() => [
    { value: 'all', label: 'All Statuses', description: 'Show the full task board.' },
    ...safeTaskArray(taskStatuses).map((status) => ({
      value: status.id,
      label: status.name,
      description: status.key,
    })),
  ], [taskStatuses]);
  const taskPriorityOptions = useMemo(() => ([
    { value: 'all', label: 'All Priorities', description: 'Show every priority band.' },
    { value: 'low', label: 'Low', description: 'Low urgency tasks.' },
    { value: 'medium', label: 'Medium', description: 'Standard workload.' },
    { value: 'high', label: 'High', description: 'Higher urgency tasks.' },
    { value: 'urgent', label: 'Urgent', description: 'Immediate attention needed.' },
  ]), []);
  const taskBlockedOptions = useMemo(() => ([
    { value: 'all', label: 'All States', description: 'Show blocked and unblocked tasks.' },
    { value: 'blocked', label: 'Blocked', description: 'Only blocked tasks.' },
    { value: 'active', label: 'Active', description: 'Only tasks not currently blocked.' },
  ]), []);
  const taskPostOptions = useMemo(
    () => posts.map((post) => ({
      id: post.id,
      title: getCardTitle(post),
      status: post.status,
    })),
    [posts],
  );
  const taskPipelineOptions = useMemo(
    () => pipelineItems.map((item) => ({
      id: item.id,
      title: item.title || item.linkedPost?.caption || `Pipeline ${String(item.id).slice(0, 8).toUpperCase()}`,
      status: item.status,
    })),
    [pipelineItems],
  );

  const memberOptions = useMemo(() => {
    const base = [{ value: 'all', label: 'All Members', description: 'Show every owner lane.' }];
    return base.concat(
      members.map((member) => ({
        value: member.userId,
        label: getDisplayName(member),
        description: String(member.role || 'member').replace(/_/g, ' '),
      })),
    );
  }, [members]);

  const platformOptions = useMemo(() => {
    const seen = new Set(records.map((record) => record.platform).filter(Boolean));
    return [
      { value: 'all', label: 'All Platforms', description: 'Show every channel.' },
      ...[...seen].sort().map((platform) => ({
        value: platform,
        label: getPlatformLabel(platform),
        description: 'Destination platform',
      })),
    ];
  }, [records]);

  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All Statuses', description: 'Show the full lifecycle.' },
    { value: 'draft', label: 'Draft / Idea', description: 'Drafting work.' },
    { value: 'in_review', label: 'In Review', description: 'Waiting for reviewer action.' },
    { value: 'revision_requested', label: 'Changes Requested', description: 'Needs revision.' },
    { value: 'approved', label: 'Approved', description: 'Ready to place.' },
    { value: 'scheduled', label: 'Scheduled', description: 'Placed on the calendar.' },
    { value: 'published', label: 'Published', description: 'Already live.' },
  ], []);

  const selectedRecord = useMemo(
    () => filteredRecords.find((record) => record.id === selectedRecordId) || records.find((record) => record.id === selectedRecordId) || null,
    [filteredRecords, records, selectedRecordId],
  );

  const applyPreset = useCallback((preset, silent = false) => {
    if (!preset) return;
    const nextViewMode = visibleViews.includes(preset.viewMode) ? preset.viewMode : (visibleViews[0] || 'calendar');
    setViewMode(nextViewMode);
    setFilters({
      member: preset.filters?.member || 'all',
      platform: preset.filters?.platform || 'all',
      status: preset.filters?.status || 'all',
    });
    setTimelineLaneMode(preset.layout?.timelineLaneMode || 'member');
    if (preset.layout?.anchorDate) {
      const nextAnchor = new Date(preset.layout.anchorDate);
      if (!Number.isNaN(nextAnchor.getTime())) {
        setAnchorDate(startOfDay(nextAnchor));
      }
    }
    if (!silent) {
      toast.success(`Applied "${preset.name}"`);
    }
  }, [visibleViews]);

  useEffect(() => {
    if (presetsLoading || defaultPresetApplied) return;
    const personalDefault = presets.find((preset) => preset.scope === 'personal' && preset.isDefault);
    const sharedDefault = presets.find((preset) => preset.scope === 'shared' && preset.isDefault);
    const preset = personalDefault || sharedDefault;
    if (preset) {
      applyPreset(preset, true);
    }
    setDefaultPresetApplied(true);
  }, [applyPreset, defaultPresetApplied, presets, presetsLoading]);

  useEffect(() => {
    const requestedTaskId = searchParams.get('taskId');
    if (!requestedTaskId) return;

    const matchingTask = enrichedTasks.find((task) => task.id === requestedTaskId);
    if (!matchingTask) return;

    setViewMode('tasks');
    setSelectedTaskId(matchingTask.id);
  }, [enrichedTasks, searchParams]);

  useEffect(() => {
    const requestedPostId = String(searchParams.get('postId') || '').trim();
    if (!requestedPostId) {
      handledSearchPostIdRef.current = '';
      return;
    }

    if (handledSearchPostIdRef.current === requestedPostId) return;

    const matchingRecord = records.find((record) => record.postId === requestedPostId);
    if (!matchingRecord) return;

    handledSearchPostIdRef.current = requestedPostId;
    setSelectedRecordId(matchingRecord.id);

    const focusDateValue = matchingRecord.scheduledAt || matchingRecord.publishedAt || matchingRecord.createdAt;
    if (focusDateValue) {
      const focusDate = startOfDay(new Date(focusDateValue));
      if (!Number.isNaN(focusDate.getTime())) {
        setAnchorDate(focusDate);
      }
    }

    setViewMode((current) => (
      current === 'calendar' || current === 'week' || current === 'timeline'
        ? current
        : 'calendar'
    ));
  }, [records, searchParams]);

  const schedulableRecords = useMemo(
    () => filteredRecords.filter((record) => {
      if (!record.canScheduleAction) return false;
      if (record.pipelineItemId) return record.lifecycleStatus === 'approved';
      return ['draft', 'scheduled'].includes(record.lifecycleStatus);
    }),
    [filteredRecords],
  );

  useEffect(() => {
    setSelectedBatchIds((current) => current.filter((id) => schedulableRecords.some((record) => record.id === id)));
  }, [schedulableRecords]);

  const selectedBatchRecords = useMemo(() => {
    if (selectedBatchIds.length === 0) return [];
    const selectedSet = new Set(selectedBatchIds);
    return schedulableRecords.filter((record) => selectedSet.has(record.id));
  }, [schedulableRecords, selectedBatchIds]);

  const batchRecords = selectedBatchRecords.length > 0 ? selectedBatchRecords : schedulableRecords;
  const topBottlenecks = useMemo(() => (stats.bottleneckLanes || []).slice(0, 3), [stats.bottleneckLanes]);
  const currentRangeLabel = useMemo(() => formatRangeLabel(viewMode, anchorDate, weekDays), [anchorDate, viewMode, weekDays]);
  const activeFilterCount = useMemo(
    () => ['member', 'status', 'platform'].reduce((count, key) => (
      filters[key] !== 'all' ? count + 1 : count
    ), 0),
    [filters],
  );
  const timelineRangeHasRecords = useMemo(() => {
    if (viewMode !== 'timeline' || filteredRecords.length === 0) return true;
    const rangeStart = startOfWeek(anchorDate);
    const rangeEnd = endOfDay(addDays(rangeStart, TIMELINE_DAY_COUNT - 1)).getTime();
    const windowStart = startOfDay(rangeStart).getTime();

    return filteredRecords.some((record) => {
      const start = new Date(record.createdAt || record.scheduledAt || record.updatedAt || 0).getTime();
      const end = new Date(record.publishedAt || record.scheduledAt || record.updatedAt || record.createdAt || 0).getTime();
      return start <= rangeEnd && end >= windowStart;
    });
  }, [anchorDate, filteredRecords, viewMode]);

  useEffect(() => {
    if (viewMode !== 'timeline' || timelineRangeHasRecords || filteredRecords.length === 0) return;

    const firstRelevantValue = filteredRecords
      .map((record) => record.scheduledAt || record.createdAt || record.updatedAt || null)
      .find(Boolean);

    if (!firstRelevantValue) return;

    const nextAnchor = startOfWeek(new Date(firstRelevantValue));
    if (!Number.isNaN(nextAnchor.getTime()) && formatDayKey(nextAnchor) !== formatDayKey(anchorDate)) {
      setAnchorDate(nextAnchor);
    }
  }, [anchorDate, filteredRecords, timelineRangeHasRecords, viewMode]);

  const openComposer = useCallback((intent) => {
    setComposerIntent({ ...intent, nonce: Date.now() });
    setComposerOpen(true);
  }, []);

  const handleCreateDraft = useCallback((date = null) => {
    openComposer({
      mode: 'new',
      prefillDate: date ? startOfDay(date).toISOString() : null,
    });
  }, [openComposer]);

  const handleBrowseLibrary = useCallback((date = null) => {
    setLibraryTargetDate(date ? startOfDay(date).toISOString() : null);
    setLibraryPickerOpen(true);
  }, []);

  const handleConfirmLibraryAssets = useCallback((selectedAssets) => {
    setLibraryPickerOpen(false);
    openComposer({
      mode: 'new',
      assetReferences: selectedAssets,
      seedPrompt: buildMultiAssetSeedPrompt(selectedAssets),
      prefillDate: libraryTargetDate,
    });
  }, [libraryTargetDate, openComposer]);

  const handleRangeStep = useCallback((direction) => {
    setAnchorDate((current) => {
      if (viewMode === 'calendar') return addMonths(current, direction);
      if (viewMode === 'timeline') return addDays(current, direction * 7);
      return addDays(current, direction * 7);
    });
  }, [viewMode]);

  const handleCreatePreset = useCallback(async ({ name, scope, isDefault }) => {
    if (!organizationId || !userId) return;
    await createPreset({
      organizationId,
      ownerUserId: userId,
      createdBy: userId,
      name,
      scope,
      isDefault,
      viewMode,
      filters,
      layout: {
        anchorDate: anchorDate.toISOString(),
        timelineLaneMode,
      },
      sort: {},
    });
    toast.success('Saved current view');
  }, [anchorDate, createPreset, filters, organizationId, timelineLaneMode, userId, viewMode]);

  const handleDeletePreset = useCallback(async (preset) => {
    if (!preset?.id) return;
    if (!window.confirm(`Delete "${preset.name}"?`)) return;
    await deletePreset(preset.id);
    toast.success('Saved view deleted');
  }, [deletePreset]);

  const handleSetDefaultPreset = useCallback(async (preset) => {
    if (!preset?.id) return;
    await updatePreset(preset.id, { isDefault: true });
    toast.success(`"${preset.name}" is now the default view`);
  }, [updatePreset]);

  const handleToggleBatchRecord = useCallback((recordId) => {
    setSelectedBatchIds((current) => (
      current.includes(recordId)
        ? current.filter((item) => item !== recordId)
        : [...current, recordId]
    ));
  }, []);

  const handleApprove = useCallback(async (comment) => {
    if (!selectedRecord?.pipelineItemId) {
      throw new Error('This record cannot be approved from the schedule modal.');
    }

    await actOnPipelineItem({
      pipelineItemId: selectedRecord.pipelineItemId,
      action: 'approve',
      comment: String(comment || '').trim() || undefined,
    });
    await refresh();
  }, [actOnPipelineItem, refresh, selectedRecord]);

  const handleRequestChanges = useCallback(async (comment) => {
    if (!selectedRecord?.pipelineItemId) {
      throw new Error('This record cannot be sent back for revision from the schedule modal.');
    }

    await actOnPipelineItem({
      pipelineItemId: selectedRecord.pipelineItemId,
      action: 'request_revision',
      comment: String(comment || '').trim() || undefined,
    });
    await refresh();
  }, [actOnPipelineItem, refresh, selectedRecord]);

  const handlePublishNow = useCallback(async () => {
    if (!selectedRecord?.pipelineItemId) {
      throw new Error('A pipeline item is required to publish content.');
    }

    await publishRecord({ pipelineItemId: selectedRecord.pipelineItemId });
    await refresh();
  }, [publishRecord, refresh, selectedRecord]);

  const handleExecuteBatch = useCallback(async ({ plan }) => {
    const results = await executeBatchSchedule({ plan });
    const successCount = results.filter((entry) => entry.success).length;
    const failedCount = results.length - successCount;
    if (successCount > 0) {
      toast.success(`Scheduled ${successCount} item${successCount === 1 ? '' : 's'}.`);
    }
    if (failedCount > 0) {
      toast.error(`${failedCount} item${failedCount === 1 ? '' : 's'} could not be scheduled.`);
    }
    setSelectedBatchIds([]);
  }, [executeBatchSchedule]);

  const handleOpenTask = useCallback((taskId) => {
    if (!taskId) return;
    setSelectedTaskId(taskId);
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set('taskId', taskId);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleCloseTask = useCallback(() => {
    setSelectedTaskId(null);
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.delete('taskId');
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleCreateTask = useCallback(async (payload) => {
    try {
      const createdTask = await createTask({
        organization_id: organizationId,
        ...payload,
      });
      toast.success('Task created.');
      handleOpenTask(createdTask.id);
    } catch (error) {
      toast.error(error?.message || 'Could not create this task.');
      throw error;
    }
  }, [createTask, handleOpenTask, organizationId]);

  const handleSaveTask = useCallback(async (taskId, updates) => {
    try {
      await saveTask(taskId, updates);
      toast.success('Task updated.');
    } catch (error) {
      toast.error(error?.message || 'Could not update this task.');
      throw error;
    }
  }, [saveTask]);

  const handleDeleteTask = useCallback(async (taskId) => {
    if (!taskId) return;
    if (!window.confirm('Delete this task?')) return;

    try {
      await removeTask(taskId);
      toast.success('Task deleted.');
      handleCloseTask();
    } catch (error) {
      toast.error(error?.message || 'Could not delete this task.');
    }
  }, [handleCloseTask, removeTask]);

  const handleAddTaskNote = useCallback(async (payload) => {
    try {
      await addTaskNote(payload);
      toast.success('Task note added.');
    } catch (error) {
      toast.error(error?.message || 'Could not save this task note.');
      throw error;
    }
  }, [addTaskNote]);

  const handleOpenTaskSchedule = useCallback(({ postId = null, pipelineItemId = null } = {}) => {
    const linkedRecord = records.find((record) => (
      (pipelineItemId && record.pipelineItemId === pipelineItemId)
      || (postId && record.postId === postId)
    ));

    if (!linkedRecord) {
      toast.error('The linked record could not be opened from the calendar snapshot.');
      return;
    }

    handleCloseTask();
    setSelectedRecordId(linkedRecord.id);
  }, [handleCloseTask, records]);

  const handleDragEnd = useCallback(async ({ active, over }) => {
    const draggedTask = active?.data?.current?.task;
    const taskDropTarget = parseTaskDropTarget(over?.id);
    if (draggedTask && taskDropTarget?.statusId) {
      if (!canManageTasks || draggedTask.status_id === taskDropTarget.statusId) return;

      try {
        await handleSaveTask(draggedTask.id, { status_id: taskDropTarget.statusId });
      } catch (_error) {
        // Toast is handled by handleSaveTask.
      }
      return;
    }

    const record = active?.data?.current?.record;
    const dropTarget = parseDropTarget(over?.id);
    if (!record || !dropTarget?.dayKey) return;
    if (!record.canScheduleAction) {
      toast.error('This item is not schedulable from the calendar.');
      return;
    }
    if (isPastDay(dropTarget.dayKey)) {
      toast.error('Past dates are locked.');
      return;
    }

    try {
      await scheduleRecord({
        postId: record.postId,
        pipelineItemId: record.pipelineItemId,
        scheduledAt: buildScheduledDropDate(dropTarget.dayKey, record.scheduledAt),
      });
      toast.success('Content moved on the calendar');
      await refresh();
    } catch (nextError) {
      toast.error(nextError?.message || 'Could not move this record.');
    }
  }, [canManageTasks, handleSaveTask, refresh, scheduleRecord]);

  const renderMonthView = () => (
    <div className="org-calendar-month-grid">
      {monthDays.map((day) => {
        const dayKey = formatDayKey(day);
        return (
          <MonthCell
            key={dayKey}
            day={day}
            items={dayRecords.get(dayKey) || []}
            reviewCount={reviewCountsByDay.get(dayKey) || 0}
            isCurrentMonth={day.getMonth() === anchorDate.getMonth()}
            onOpenRecord={(record) => setSelectedRecordId(record.id)}
            onCreateDraft={handleCreateDraft}
            onBrowseLibrary={handleBrowseLibrary}
          />
        );
      })}
    </div>
  );

  const renderWeekView = () => (
    <div className="org-calendar-week-grid">
      {weekDays.map((day) => {
        const dayKey = formatDayKey(day);
        return (
          <WeekDropColumn
            key={dayKey}
            day={day}
            items={dayRecords.get(dayKey) || []}
            reviewCount={reviewCountsByDay.get(dayKey) || 0}
            onOpenRecord={(record) => setSelectedRecordId(record.id)}
            onCreateDraft={handleCreateDraft}
            onBrowseLibrary={handleBrowseLibrary}
          />
        );
      })}
    </div>
  );

  const renderQueueView = () => (
    <div className="org-calendar-queue-view">
      <div className="org-calendar-queue-view-toolbar">
        <div>
          <strong>{queueRecords.length} approved items ready to place</strong>
          <span>Queue items stay schema-safe and schedule through the existing org publishing path.</span>
        </div>
        <div className="org-calendar-queue-view-actions">
          <button type="button" className="org-text-button" onClick={() => setSelectedBatchIds(queueRecords.map((record) => record.id))}>
            Select Visible
          </button>
          <button type="button" className="org-text-button" onClick={() => setSelectedBatchIds([])}>
            Clear
          </button>
          <button type="button" className="org-text-button" onClick={() => handleBrowseLibrary()}>
            Browse Library
          </button>
        </div>
      </div>

      {queueRecords.length === 0 ? (
        <div className="org-calendar-empty-inline">No approved items are waiting for placement.</div>
      ) : (
        <div className="org-calendar-queue-view-list">
          {queueRecords.map((record) => {
            const selected = selectedBatchIds.includes(record.id);
            return (
              <article key={record.id} className={`org-calendar-queue-view-card ${selected ? 'selected' : ''}`.trim()}>
                <label className="org-calendar-queue-select">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => handleToggleBatchRecord(record.id)}
                  />
                  <span>Select</span>
                </label>

                <CalendarContentCard
                  record={record}
                  variant="queue-preview"
                  onClick={() => setSelectedRecordId(record.id)}
                />

                <div className="org-calendar-queue-view-actions">
                  <button type="button" className="org-text-button" onClick={() => setSelectedRecordId(record.id)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="org-text-button"
                    onClick={() => navigateToPipeline(record.pipelineItemId || null, 'org_calendar_queue')}
                  >
                    Pipeline
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderApprovalView = () => (
    <div className="org-calendar-approval-shell">
      {topBottlenecks.length > 0 ? (
        <div className="org-calendar-bottleneck-chip-row">
          {topBottlenecks.map((lane) => (
            <span key={lane.laneKey} className="org-calendar-bottleneck-chip">
              {lane.label} | score {lane.pressureScore} | overdue {lane.overdueCount}
            </span>
          ))}
        </div>
      ) : null}

      <CalendarApprovalTracker
        rows={approvalRows}
        onOpenRecord={(record) => setSelectedRecordId(record.id)}
        onOpenPipeline={() => navigateToPipeline(null, 'org_calendar_approval')}
      />
    </div>
  );

  const renderTasksView = () => {
    if (filteredTasks.length === 0) {
      return (
        <OrgEmptyState
          eyebrow="Tasks"
          title="No tasks match this view"
          description="Adjust the task filters, include completed work, or create a new task."
          action={canManageTasks ? (
            <button type="button" className="org-primary-button" onClick={() => setTaskCreateOpen(true)}>
              Create Task
            </button>
          ) : null}
        />
      );
    }

    if (taskPresentation === 'table') {
      return (
        <TaskTableView
          tasks={filteredTasks}
          statusMap={taskStatusMap}
          onOpenTask={handleOpenTask}
        />
      );
    }

    return (
      <TaskBoardView
        statuses={taskStatuses}
        tasks={filteredTasks}
        selectedTaskId={selectedTaskId}
        canManageTasks={canManageTasks}
        onOpenTask={handleOpenTask}
      />
    );
  };

  const renderActiveView = () => {
    switch (viewMode) {
      case 'week':
        return renderWeekView();
      case 'timeline':
        return (
          <div className="org-calendar-timeline-wrap">
            {topBottlenecks.length > 0 ? (
              <div className="org-calendar-bottleneck-chip-row">
                {topBottlenecks.map((lane) => (
                  <span key={lane.laneKey} className="org-calendar-bottleneck-chip">
                    {lane.label} | {lane.activeCount} active | {lane.averageStageAgeHours}h avg
                  </span>
                ))}
              </div>
            ) : null}
            <CalendarTimelineView
              records={filteredRecords}
              anchorDate={anchorDate}
              laneMode={timelineLaneMode}
              onLaneModeChange={setTimelineLaneMode}
              onOpenRecord={(record) => setSelectedRecordId(record.id)}
              onJumpToday={() => setAnchorDate(startOfWeek(new Date()))}
            />
          </div>
        );
      case 'board':
        return (
          <CalendarStatusBoard
            columns={boardColumns}
            archiveRecords={archiveRecords}
            onOpenRecord={(record) => setSelectedRecordId(record.id)}
            onOpenPipeline={() => navigateToPipeline(null, 'org_calendar_status_board')}
          />
        );
      case 'queue':
        return renderQueueView();
      case 'approval':
        return renderApprovalView();
      case 'workload':
        return <WorkloadTable rows={workloadRows} />;
      case 'tasks':
        return renderTasksView();
      case 'calendar':
      default:
        return renderMonthView();
    }
  };

  if (!organizationId) {
    return (
      <section className="org-page">
        <OrgEmptyState
          eyebrow="Calendar"
          title="Select an organization first"
          description="The org content calendar loads once an active org workspace is selected."
        />
      </section>
    );
  }

  return (
    <section className="org-page org-calendar-page">
      <div className="org-page-header">
        <div>
          <h1>{organization?.name || 'Organization'} Calendar</h1>
          <p>{activeBrandProject ? `${activeBrandProject.name} planning surface` : 'Content operations planning surface'}</p>
        </div>

        <div className="org-calendar-header-actions">
          {viewMode === 'tasks' ? (
            canManageTasks ? (
              <button type="button" className="org-primary-button" onClick={() => setTaskCreateOpen(true)}>
                New Task
              </button>
            ) : null
          ) : (
            <>
              <button type="button" className="org-text-button" onClick={() => handleBrowseLibrary()}>
                Browse Library
              </button>
              <button type="button" className="org-primary-button" onClick={() => handleCreateDraft()}>
                New Draft
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="org-panel-loading">Loading the org calendar...</div>
      ) : error ? (
        <OrgEmptyState
          eyebrow="Calendar"
          title="Unable to load the calendar"
          description={error}
          action={(
            <button type="button" className="org-primary-button" onClick={() => refresh()}>
              Try Again
            </button>
          )}
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {viewMode === 'tasks' ? (
            <>
              <div className="org-summary-grid org-calendar-summary-grid">
                <SummaryTile label="Open Tasks" value={taskStats.open} copy="Still active in the selected task view." tone="primary" />
                <SummaryTile label="Blocked" value={taskStats.blocked} copy="Need dependency resolution before work can continue." tone="danger" />
                <SummaryTile label="Due Soon" value={taskStats.dueSoon} copy="Due within the next 48 hours." tone="warning" />
                <SummaryTile label="Completed" value={taskStats.completed} copy="Completed tasks in the current filtered set." tone="success" />
              </div>

              <div className="org-panel org-calendar-toolbar org-task-toolbar">
                <div className="org-calendar-toolbar-strip">
                  <div className="org-calendar-toolbar-primary">
                    <div className="org-calendar-view-switcher-scroll">
                      <UiTabs
                        className="org-calendar-view-switcher"
                        tabs={visibleViewOptions.map((item) => ({
                          value: item.id,
                          label: item.label,
                          icon: item.icon,
                        }))}
                        value={viewMode}
                        onChange={setViewMode}
                        ariaLabel="Org calendar views"
                      />
                    </div>

                    <UiTabs
                      className="org-task-presentation-toggle"
                      tabs={[
                        { value: 'board', label: 'Board' },
                        { value: 'table', label: 'Table' },
                      ]}
                      value={taskPresentation}
                      onChange={setTaskPresentation}
                      ariaLabel="Task presentation"
                    />
                  </div>

                  <div className="org-calendar-toolbar-secondary org-task-toolbar-secondary">
                    <input
                      type="search"
                      className="org-task-search-input"
                      value={taskSearch}
                      onChange={(event) => setTaskSearch(event.target.value)}
                      placeholder="Search tasks, assignees, or linked content"
                    />
                    <OrgSelect
                      value={taskFilters.assignee}
                      options={taskMemberOptions}
                      onChange={(value) => setTaskFilters((current) => ({ ...current, assignee: value }))}
                      className="org-calendar-filter-select"
                    />
                    <OrgSelect
                      value={taskFilters.status}
                      options={taskStatusOptions}
                      onChange={(value) => setTaskFilters((current) => ({ ...current, status: value }))}
                      className="org-calendar-filter-select"
                    />
                    <OrgSelect
                      value={taskFilters.priority}
                      options={taskPriorityOptions}
                      onChange={(value) => setTaskFilters((current) => ({ ...current, priority: value }))}
                      className="org-calendar-filter-select"
                    />
                    <OrgSelect
                      value={taskFilters.blocked}
                      options={taskBlockedOptions}
                      onChange={(value) => setTaskFilters((current) => ({ ...current, blocked: value }))}
                      className="org-calendar-filter-select"
                    />
                    <label className="org-checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={taskFilters.includeCompleted}
                        onChange={(event) => setTaskFilters((current) => ({ ...current, includeCompleted: event.target.checked }))}
                      />
                      <span>Include completed</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="org-panel org-task-canvas">
                {renderTasksView()}
              </div>
            </>
          ) : (
            <>
              <div className="org-summary-grid org-calendar-summary-grid">
                <SummaryTile label="Scheduled This Week" value={stats.scheduledThisWeek} copy="Placed on the team calendar." tone="primary" />
                <SummaryTile label="Approved Queue" value={stats.approvedQueueCount} copy="Ready for calendar placement." tone="success" />
                <SummaryTile label="In Review" value={stats.inReviewCount} copy="Still moving through approvals." tone="warning" />
                <SummaryTile label="Overdue" value={stats.overdueCount} copy="Items already beyond SLA." tone="danger" />
              </div>

              <div className="org-panel org-calendar-toolbar">
                <div className="org-calendar-toolbar-strip">
                  <div className="org-calendar-toolbar-primary">
                    <div className="org-calendar-range-control">
                      <button type="button" className="org-icon-button" onClick={() => handleRangeStep(-1)} aria-label="Previous range">
                        <ChevronLeft size={16} />
                      </button>
                      <strong>{currentRangeLabel}</strong>
                      <button type="button" className="org-icon-button" onClick={() => handleRangeStep(1)} aria-label="Next range">
                        <ChevronRight size={16} />
                      </button>
                    </div>

                    <CalendarSavedViewsMenu
                      presets={presets}
                      presetsLoading={presetsLoading}
                      canManageShared={canManageSharedViews}
                      onApplyPreset={applyPreset}
                      onCreatePreset={handleCreatePreset}
                      onDeletePreset={handleDeletePreset}
                      onSetDefault={handleSetDefaultPreset}
                    />

                    {canSchedule && batchRecords.length > 0 ? (
                      <button type="button" className="org-text-button" onClick={() => setBatchOpen(true)}>
                        Batch Schedule {selectedBatchRecords.length > 0 ? `(${selectedBatchRecords.length})` : ''}
                      </button>
                    ) : null}
                  </div>

                  <div className="org-calendar-toolbar-secondary">
                    <div className="org-calendar-view-switcher-scroll">
                      <UiTabs
                        className="org-calendar-view-switcher"
                        tabs={visibleViewOptions.map((item) => ({
                          value: item.id,
                          label: item.label,
                          icon: item.icon,
                        }))}
                        value={viewMode}
                        onChange={setViewMode}
                        ariaLabel="Org calendar views"
                      />
                    </div>

                    <div ref={filtersRef} className={`org-calendar-filter-shell ${filtersOpen ? 'open' : ''}`.trim()}>
                      <button
                        type="button"
                        className="org-calendar-filter-trigger"
                        onClick={() => setFiltersOpen((current) => !current)}
                      >
                        <SlidersHorizontal size={14} />
                        Filters
                        {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
                      </button>

                      {filtersOpen ? (
                        <div className="org-calendar-filter-popover">
                          <div className="org-calendar-filter-row">
                            <OrgSelect
                              value={effectiveFilters.member}
                              options={memberOptions}
                              onChange={(value) => setFilters((current) => ({ ...current, member: value }))}
                              className="org-calendar-filter-select"
                            />
                            <OrgSelect
                              value={effectiveFilters.status}
                              options={statusOptions}
                              onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
                              className="org-calendar-filter-select"
                            />
                            <OrgSelect
                              value={effectiveFilters.platform}
                              options={platformOptions}
                              onChange={(value) => setFilters((current) => ({ ...current, platform: value }))}
                              className="org-calendar-filter-select"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="org-calendar-legend">
                <span className="tone-scheduled">Scheduled</span>
                <span className="tone-approved">Approved</span>
                <span className="tone-review">Review Pressure</span>
                <span className="tone-blocked">Overdue / Blocked</span>
              </div>

              <div className="org-calendar-layout">
                <aside className="org-panel org-calendar-side-panel">
                  <div className="org-panel-header">
                    <div>
                      <h3>Ready to Schedule</h3>
                      <p>Approved items waiting for the next open slot.</p>
                    </div>
                    <button type="button" className="org-text-button" onClick={() => handleBrowseLibrary()}>
                      Browse Library
                    </button>
                  </div>

                  <div className="org-calendar-queue-list">
                    {queueRecords.length === 0 ? (
                      <div className="org-calendar-empty-inline">No approved items are waiting for placement.</div>
                    ) : (
                      queueRecords.slice(0, 5).map((record) => (
                        <article key={record.id} className={`org-calendar-queue-entry ${selectedBatchIds.includes(record.id) ? 'selected' : ''}`.trim()}>
                          <div className="org-calendar-queue-entry-header">
                            <strong>{record.title}</strong>
                            <span className={`org-calendar-pill tone-${record.tone || 'draft'}`.trim()}>{record.statusLabel}</span>
                          </div>
                          <div className="org-calendar-queue-entry-meta">
                            <span>{record.platformLabel}</span>
                            {record.contentTypeLabel ? <span>{record.contentTypeLabel}</span> : null}
                            {record.ageLabel ? <span>{record.ageLabel}</span> : null}
                          </div>
                          <p className="org-calendar-queue-entry-preview">{record.previewText || 'No content summary yet.'}</p>
                          <div className="org-calendar-queue-entry-actions">
                            <button type="button" className="org-text-button" onClick={() => setSelectedRecordId(record.id)}>
                              Open
                            </button>
                            <button type="button" className="org-text-button" onClick={() => handleBrowseLibrary()}>
                              Library
                            </button>
                            <button type="button" className="org-text-button" onClick={() => handleToggleBatchRecord(record.id)}>
                              {selectedBatchIds.includes(record.id) ? 'Unselect' : 'Select'}
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>

                  <section className="org-calendar-side-section">
                    <div className="org-panel-header">
                      <div>
                        <h3>Bottlenecks</h3>
                        <p>Weighted review pressure based on overdue work, rework, and stage age.</p>
                      </div>
                    </div>

                    <div className="org-calendar-bottleneck-list">
                      {topBottlenecks.length === 0 ? (
                        <div className="org-calendar-empty-inline">No active bottlenecks.</div>
                      ) : (
                        topBottlenecks.map((lane) => (
                          <article key={lane.laneKey} className="org-calendar-bottleneck-item">
                            <div className="org-calendar-bottleneck-item-top">
                              <strong>{lane.label}</strong>
                              <span className={`org-calendar-pill ${lane.overdueCount > 0 ? 'danger' : 'neutral'}`.trim()}>
                                Score {lane.pressureScore}
                              </span>
                            </div>
                            <p>
                              {lane.overdueCount > 0
                                ? `${lane.overdueCount} overdue item${lane.overdueCount === 1 ? '' : 's'} are pressuring this lane.`
                                : 'Active review work is accumulating in this lane.'}
                            </p>
                            <div className="org-calendar-bottleneck-metrics">
                              <span>{lane.activeCount} active</span>
                              <span>{lane.revisionCount} rework</span>
                              <span>{lane.averageStageAgeHours}h avg age</span>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                </aside>

                <div className="org-panel org-calendar-canvas">
                  {filteredRecords.length === 0 ? (
                    <OrgEmptyState
                      eyebrow="Calendar"
                      title="No records match this view"
                      description="Adjust the filters or start a new draft to populate the calendar."
                      action={(
                        <button type="button" className="org-primary-button" onClick={() => handleCreateDraft()}>
                          Create Draft
                        </button>
                      )}
                    />
                  ) : renderActiveView()}
                </div>
              </div>
            </>
          )}
        </DndContext>
      )}

      <OrgScheduleModal
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        postId={selectedRecord?.postId || null}
        pipelineItemId={selectedRecord?.pipelineItemId || null}
        onClose={() => setSelectedRecordId(null)}
        onScheduled={refresh}
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
        onPublishNow={handlePublishNow}
        onOpenPipeline={() => navigateToPipeline(null, 'org_calendar_schedule_modal')}
      />

      <TaskCreateModal
        open={taskCreateOpen}
        statuses={taskStatuses}
        members={members}
        postOptions={taskPostOptions}
        pipelineOptions={taskPipelineOptions}
        defaultBrandProjectId={activeBrandProject?.id || null}
        currentUserId={userId}
        onClose={() => setTaskCreateOpen(false)}
        onCreate={handleCreateTask}
      />

      <TaskDetailDrawer
        open={Boolean(selectedTask)}
        task={selectedTask}
        statuses={taskStatuses}
        members={members}
        postOptions={taskPostOptions}
        pipelineOptions={taskPipelineOptions}
        canManageTasks={canManageTasks}
        currentUserId={userId}
        onClose={handleCloseTask}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onAddNote={handleAddTaskNote}
        onOpenSchedule={handleOpenTaskSchedule}
        onOpenPipeline={(pipelineItemId) => navigateToPipeline(pipelineItemId, 'org_calendar_task_drawer')}
      />

      <CalendarLibraryPicker
        open={libraryPickerOpen}
        assets={assets}
        onClose={() => setLibraryPickerOpen(false)}
        onConfirmAssets={handleConfirmLibraryAssets}
        onUploaded={refresh}
      />

      <CalendarBatchScheduleModal
        open={batchOpen}
        records={batchRecords}
        existingRecords={records.filter((record) => Boolean(record.scheduledAt))}
        onClose={() => setBatchOpen(false)}
        onPreview={previewBatchSchedule}
        onExecute={handleExecuteBatch}
      />

      <OrgGenerateComposer
        open={composerOpen}
        intent={composerIntent}
        onClose={() => {
          setComposerOpen(false);
          setComposerIntent(null);
        }}
      />
    </section>
  );
}
