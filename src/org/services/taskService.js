import { supabase } from '../../services/supabaseClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function normalizeText(value) {
  const nextValue = String(value ?? '').trim();
  return nextValue || null;
}

function normalizeTaskNotes(notes = [], profilesById = new Map()) {
  return safeArray(notes)
    .map((entry) => {
      const note = safeObject(entry);
      const body = String(note.body || '').trim();
      if (!body) return null;

      return {
        id: note.id || `${note.author_id || 'task'}-${note.created_at || Date.now()}`,
        body,
        author_id: note.author_id || null,
        created_at: note.created_at || null,
        author_profile: note.author_id ? profilesById.get(note.author_id) || null : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());
}

async function fetchProfiles(userIds = []) {
  const normalizedUserIds = [...new Set(safeArray(userIds).filter(Boolean))];
  if (normalizedUserIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url')
    .in('id', normalizedUserIds);

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return new Map();
  }

  return new Map(safeArray(data).map((profile) => [profile.id, profile]));
}

async function fetchLinkedPosts(postIds = []) {
  const normalizedPostIds = [...new Set(safeArray(postIds).filter(Boolean))];
  if (normalizedPostIds.length === 0) return new Map();

  const attempts = [
    `
      id,
      title,
      caption,
      status,
      scheduled_at,
      pipeline_item_id,
      task_id,
      generation_id,
      generations (
        storage_path,
        media_type
      )
    `,
    `
      id,
      title,
      caption,
      status,
      scheduled_at,
      pipeline_item_id,
      generation_id,
      generations (
        storage_path,
        media_type
      )
    `,
    'id, title, caption, status, scheduled_at, pipeline_item_id',
    'id, caption, status, scheduled_at, pipeline_item_id',
  ];

  for (const selection of attempts) {
    const { data, error } = await supabase
      .from('posts')
      .select(selection)
      .in('id', normalizedPostIds);

    if (!error) {
      return new Map(safeArray(data).map((post) => [post.id, post]));
    }

    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  return new Map();
}

async function fetchLinkedPipelineItems(pipelineItemIds = []) {
  const normalizedIds = [...new Set(safeArray(pipelineItemIds).filter(Boolean))];
  if (normalizedIds.length === 0) return new Map();

  const attempts = [
    'id, title, status, current_assignee_role, post_id, task_id',
    'id, title, status, current_assignee_role, post_id',
  ];

  for (const selection of attempts) {
    const { data, error } = await supabase
      .from('pipeline_items')
      .select(selection)
      .in('id', normalizedIds);

    if (!error) {
      return new Map(safeArray(data).map((item) => [item.id, item]));
    }

    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  return new Map();
}

export async function fetchOrgTaskStatuses({ organizationId }) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('org_task_statuses')
    .select('*')
    .eq('organization_id', organizationId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return [];
  }

  return safeArray(data);
}

export async function fetchOrgTasks({
  organizationId,
  brandProjectId = null,
}) {
  if (!organizationId) return [];

  let query = supabase
    .from('org_tasks')
    .select('*')
    .eq('organization_id', organizationId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return [];
  }

  const tasks = safeArray(data);
  const profilesById = await fetchProfiles([
    ...tasks.map((task) => task.assignee_user_id),
    ...tasks.map((task) => task.created_by),
    ...tasks.flatMap((task) => safeArray(task.notes).map((note) => safeObject(note).author_id)),
  ]);
  const postsById = await fetchLinkedPosts(tasks.map((task) => task.linked_post_id));
  const pipelineItemsById = await fetchLinkedPipelineItems(tasks.map((task) => task.linked_pipeline_item_id));

  return tasks.map((task) => ({
    ...task,
    assignee_profile: task.assignee_user_id ? profilesById.get(task.assignee_user_id) || null : null,
    creator_profile: task.created_by ? profilesById.get(task.created_by) || null : null,
    linked_post: task.linked_post_id ? postsById.get(task.linked_post_id) || null : null,
    linked_pipeline_item: task.linked_pipeline_item_id ? pipelineItemsById.get(task.linked_pipeline_item_id) || null : null,
    notes: normalizeTaskNotes(task.notes, profilesById),
  }));
}

function normalizeTaskPayload(payload = {}) {
  const nextPayload = { ...payload };

  if ('title' in nextPayload) {
    nextPayload.title = String(nextPayload.title || '').trim();
  }

  if ('description' in nextPayload) {
    nextPayload.description = normalizeText(nextPayload.description);
  }

  if ('priority' in nextPayload) {
    const allowed = new Set(['low', 'medium', 'high', 'urgent']);
    nextPayload.priority = allowed.has(String(nextPayload.priority || '').trim())
      ? String(nextPayload.priority).trim()
      : 'medium';
  }

  if ('due_at' in nextPayload) {
    nextPayload.due_at = nextPayload.due_at || null;
  }

  if ('assignee_user_id' in nextPayload) {
    nextPayload.assignee_user_id = nextPayload.assignee_user_id || null;
  }

  if ('status_id' in nextPayload) {
    nextPayload.status_id = nextPayload.status_id || null;
  }

  if ('linked_post_id' in nextPayload) {
    nextPayload.linked_post_id = nextPayload.linked_post_id || null;
  }

  if ('linked_pipeline_item_id' in nextPayload) {
    nextPayload.linked_pipeline_item_id = nextPayload.linked_pipeline_item_id || null;
  }

  if ('is_blocked' in nextPayload) {
    nextPayload.is_blocked = Boolean(nextPayload.is_blocked);
  }

  if ('blocked_reason' in nextPayload) {
    nextPayload.blocked_reason = nextPayload.is_blocked
      ? normalizeText(nextPayload.blocked_reason)
      : null;
  }

  if ('notes' in nextPayload) {
    nextPayload.notes = safeArray(nextPayload.notes);
  }

  if ('metadata' in nextPayload) {
    nextPayload.metadata = safeObject(nextPayload.metadata);
  }

  return nextPayload;
}

export async function createOrgTask(payload = {}) {
  const normalizedPayload = normalizeTaskPayload(payload);
  const { data, error } = await supabase
    .from('org_tasks')
    .insert(normalizedPayload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateOrgTask(taskId, updates = {}) {
  if (!taskId) {
    throw new Error('A task id is required.');
  }

  const normalizedUpdates = normalizeTaskPayload(updates);
  const { data, error } = await supabase
    .from('org_tasks')
    .update(normalizedUpdates)
    .eq('id', taskId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteOrgTask(taskId) {
  if (!taskId) {
    throw new Error('A task id is required.');
  }

  const { error } = await supabase
    .from('org_tasks')
    .delete()
    .eq('id', taskId);

  if (error) throw error;
  return true;
}

export async function appendOrgTaskNote({
  taskId,
  authorId,
  body,
}) {
  const trimmedBody = String(body || '').trim();
  if (!taskId || !authorId || !trimmedBody) {
    throw new Error('A task, author, and note body are required.');
  }

  const { data: currentTask, error: readError } = await supabase
    .from('org_tasks')
    .select('id, notes')
    .eq('id', taskId)
    .single();

  if (readError) throw readError;

  const nextNotes = safeArray(currentTask.notes).concat({
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `task-note-${Date.now()}`,
    body: trimmedBody,
    author_id: authorId,
    created_at: new Date().toISOString(),
  });

  return updateOrgTask(taskId, { notes: nextNotes });
}

export async function createOrgTaskStatus(payload = {}) {
  const nextPayload = {
    organization_id: payload.organization_id,
    name: String(payload.name || '').trim(),
    key: payload.key || null,
    color: normalizeText(payload.color) || '#64748B',
    position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : null,
    is_system: Boolean(payload.is_system),
    created_by: payload.created_by || null,
  };

  const { data, error } = await supabase
    .from('org_task_statuses')
    .insert(nextPayload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateOrgTaskStatus(statusId, updates = {}) {
  if (!statusId) {
    throw new Error('A task status id is required.');
  }

  const payload = {};
  if ('name' in updates) payload.name = String(updates.name || '').trim();
  if ('key' in updates) payload.key = updates.key || null;
  if ('color' in updates) payload.color = normalizeText(updates.color) || '#64748B';
  if ('position' in updates) payload.position = Number.isFinite(Number(updates.position)) ? Number(updates.position) : null;

  const { data, error } = await supabase
    .from('org_task_statuses')
    .update(payload)
    .eq('id', statusId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteOrgTaskStatus(statusId) {
  if (!statusId) {
    throw new Error('A task status id is required.');
  }

  const { error } = await supabase
    .from('org_task_statuses')
    .delete()
    .eq('id', statusId);

  if (error) throw error;
  return true;
}

export async function notifyOrgTaskUsers(payload = {}) {
  try {
    const { error } = await supabase.functions.invoke('org-task-notify', {
      body: payload,
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.warn('[taskService] task notification warning:', error?.message || error);
    return false;
  }
}
