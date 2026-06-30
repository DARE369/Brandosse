import { supabase } from '../../services/supabaseClient';
import { getSupabaseFunctionUrl, supabaseAnonKey } from '../../services/supabaseConfig';
import { DEFAULT_FOLDER_PATH, normalizeFolderName, normalizeFolderPath } from '../utils/assetFolders';

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

function isDuplicateError(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return error?.code === '23505' || message.includes('duplicate');
}

async function maybeSelectProfiles(userIds = []) {
  const normalizedUserIds = [...new Set(safeArray(userIds).filter(Boolean))];
  if (normalizedUserIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email')
    .in('id', normalizedUserIds);

  if (error && !isMissingRelationError(error)) {
    throw error;
  }

  return new Map(safeArray(data).map((profile) => [profile.id, profile]));
}

async function maybeSelectAssetPostLinks(organizationId, assetIds = []) {
  const normalizedAssetIds = [...new Set(safeArray(assetIds).filter(Boolean))];
  if (!organizationId || normalizedAssetIds.length === 0) return [];

  const { data, error } = await supabase
    .from('org_post_asset_links')
    .select('asset_id, post_id, sort_order, created_at')
    .eq('organization_id', organizationId)
    .in('asset_id', normalizedAssetIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return [];
  }

  return safeArray(data);
}

async function maybeSelectPosts(postIds = []) {
  const normalizedPostIds = [...new Set(safeArray(postIds).filter(Boolean))];
  if (normalizedPostIds.length === 0) return new Map();

  const attempts = [
    'id, pipeline_item_id, task_id',
    'id, pipeline_item_id',
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

async function maybeSelectPipelineItems(pipelineItemIds = []) {
  const normalizedPipelineIds = [...new Set(safeArray(pipelineItemIds).filter(Boolean))];
  if (normalizedPipelineIds.length === 0) return new Map();

  const attempts = [
    'id, title, task_id',
    'id, title',
  ];

  for (const selection of attempts) {
    const { data, error } = await supabase
      .from('pipeline_items')
      .select(selection)
      .in('id', normalizedPipelineIds);

    if (!error) {
      return new Map(safeArray(data).map((item) => [item.id, item]));
    }

    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  return new Map();
}

async function maybeSelectTasks(taskIds = []) {
  const normalizedTaskIds = [...new Set(safeArray(taskIds).filter(Boolean))];
  if (normalizedTaskIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('org_tasks')
    .select('id, title')
    .in('id', normalizedTaskIds);

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return new Map();
  }

  return new Map(safeArray(data).map((task) => [task.id, task]));
}

function shortCode(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return normalized.slice(0, 8).toUpperCase();
}

async function enrichOrgAssets(organizationId, assets = []) {
  const normalizedAssets = safeArray(assets);
  if (!organizationId || normalizedAssets.length === 0) return normalizedAssets;

  const uploaderProfiles = await maybeSelectProfiles(normalizedAssets.map((asset) => asset.uploaded_by));
  const assetLinks = await maybeSelectAssetPostLinks(organizationId, normalizedAssets.map((asset) => asset.id));
  const linksByAssetId = assetLinks.reduce((accumulator, link) => {
    if (!accumulator.has(link.asset_id)) {
      accumulator.set(link.asset_id, []);
    }
    accumulator.get(link.asset_id).push(link);
    return accumulator;
  }, new Map());

  const postsById = await maybeSelectPosts(assetLinks.map((link) => link.post_id));
  const pipelineItemsById = await maybeSelectPipelineItems(
    [...postsById.values()].map((post) => post.pipeline_item_id),
  );
  const tasksById = await maybeSelectTasks([
    ...[...postsById.values()].map((post) => post.task_id),
    ...[...pipelineItemsById.values()].map((item) => item.task_id),
  ]);

  return normalizedAssets.map((asset) => {
    const metadata = safeObject(asset.metadata);
    const links = safeArray(linksByAssetId.get(asset.id));
    const primaryLink = links[0] || null;
    const linkedPost = primaryLink?.post_id ? postsById.get(primaryLink.post_id) || null : null;

    const pipelineItemId = metadata.pipeline_item_id || linkedPost?.pipeline_item_id || null;
    const pipelineItem = pipelineItemId ? pipelineItemsById.get(pipelineItemId) || null : null;

    const taskId = metadata.task_id || linkedPost?.task_id || pipelineItem?.task_id || null;
    const task = taskId ? tasksById.get(taskId) || null : null;
    const uploaderProfile = uploaderProfiles.get(asset.uploaded_by) || null;

    return {
      ...asset,
      uploader_profile: uploaderProfile,
      origin: {
        uploaded_at: asset.created_at || null,
        linked_post_id: primaryLink?.post_id || metadata.post_id || null,
        pipeline_item_id: pipelineItemId,
        pipeline_short_code: shortCode(pipelineItemId),
        pipeline_title: pipelineItem?.title || metadata.pipeline_title || null,
        task_id: taskId,
        task_title: task?.title || metadata.task_title || null,
      },
    };
  });
}

export async function fetchOrgAssetFolders({
  organizationId,
  brandProjectId = null,
}) {
  if (!organizationId) return [];

  let query = supabase
    .from('org_asset_folders')
    .select('*')
    .eq('organization_id', organizationId)
    .order('folder_path', { ascending: true });

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  } else {
    query = query.is('brand_project_id', null);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[assetLibraryService] failed to fetch org asset folders:', error.message);
    }
    return [];
  }

  return safeArray(data);
}

export async function createOrgAssetFolder({
  organizationId,
  brandProjectId = null,
  name = '',
  description = '',
  parentFolderId = null,
  visibility = 'team',
  color = null,
  icon = null,
  createdBy,
}) {
  if (!organizationId) {
    throw new Error('An organization is required.');
  }

  const normalizedName = normalizeFolderName(name);
  if (!normalizedName) {
    throw new Error('Folder name is required.');
  }

  if (!createdBy) {
    throw new Error('A signed-in user is required.');
  }

  const { data, error } = await supabase
    .from('org_asset_folders')
    .insert({
      organization_id: organizationId,
      brand_project_id: brandProjectId || null,
      name: normalizedName,
      description: String(description || '').trim() || null,
      parent_folder_id: parentFolderId || null,
      visibility: visibility === 'private' ? 'private' : 'team',
      color: color || null,
      icon: icon || null,
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) {
    if (isDuplicateError(error)) {
      throw new Error('A folder with that path already exists.');
    }
    throw error;
  }

  return data;
}

export async function updateOrgAssetFolder(folderId, updates = {}) {
  if (!folderId) {
    throw new Error('A folder id is required.');
  }

  const payload = { ...updates };
  if ('name' in payload) {
    payload.name = normalizeFolderName(payload.name);
    if (!payload.name) {
      throw new Error('Folder name is required.');
    }
  }

  if ('description' in payload) {
    payload.description = String(payload.description || '').trim() || null;
  }

  if ('visibility' in payload) {
    payload.visibility = payload.visibility === 'private' ? 'private' : 'team';
  }

  const { data, error } = await supabase
    .from('org_asset_folders')
    .update(payload)
    .eq('id', folderId)
    .select('*')
    .single();

  if (error) {
    if (isDuplicateError(error)) {
      throw new Error('A folder with that path already exists.');
    }
    throw error;
  }

  return data;
}

export async function deleteOrgAssetFolder(folderId) {
  if (!folderId) {
    throw new Error('A folder id is required.');
  }

  const { error } = await supabase
    .from('org_asset_folders')
    .delete()
    .eq('id', folderId);

  if (error) throw error;
}

export async function fetchOrgAssets({
  organizationId,
  brandProjectId = null,
  includeArchived = false,
}) {
  if (!organizationId) return [];

  let query = supabase
    .from('org_asset_library')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[assetLibraryService] failed to fetch org assets:', error.message);
    }
    return [];
  }

  return enrichOrgAssets(organizationId, safeArray(data));
}

export async function updateOrgAsset(assetId, updates = {}) {
  if (!assetId) {
    throw new Error('An asset id is required.');
  }

  const payload = { ...updates };
  if ('folder_path' in payload) {
    payload.folder_path = normalizeFolderPath(payload.folder_path);
  }

  if ('description' in payload) {
    payload.description = String(payload.description || '').trim();
  }

  const { data, error } = await supabase
    .from('org_asset_library')
    .update(payload)
    .eq('id', assetId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function uploadOrgAsset({
  organizationId,
  brandProjectId = null,
  file,
  name = '',
  description = '',
  tags = [],
  folderId = null,
  folderPath = DEFAULT_FOLDER_PATH,
  assetLevel = 'project',
  isBrandAsset = false,
}) {
  if (!organizationId) {
    throw new Error('An organization is required to upload assets.');
  }

  if (!file) {
    throw new Error('Choose a file first.');
  }

  const formData = new FormData();
  formData.append('organization_id', organizationId);
  if (brandProjectId) formData.append('brand_project_id', brandProjectId);
  formData.append('file', file);
  formData.append('name', name || file.name || 'Uploaded asset');
  formData.append('description', description || '');
  formData.append('tags', JSON.stringify(safeArray(tags).filter(Boolean)));
  if (folderId) formData.append('folder_id', folderId);
  formData.append('folder_path', normalizeFolderPath(folderPath));
  formData.append('asset_level', assetLevel || 'project');
  formData.append('is_brand_asset', String(Boolean(isBrandAsset)));

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const response = await fetch(getSupabaseFunctionUrl('org-asset-upload'), {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: formData,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const serverMessage = payload?.error || payload?.message || payload?.code || '';

      if (response.status === 404) {
        throw new Error('The org-asset-upload edge function is not deployed to this Supabase project. Redeploy it, then try the upload again.');
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(serverMessage || 'You do not have permission to upload assets for this organization.');
      }

      throw new Error(serverMessage || `Asset upload failed with status ${response.status}.`);
    }

    return payload?.asset || null;
  } catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (
      message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('load failed')
      || message.includes('cors')
    ) {
      throw new Error('Could not reach the org-asset-upload edge function. Confirm it is deployed to this Supabase project and reachable from the current app origin.');
    }

    throw error;
  }
}

export async function fetchOrgPostAssetLinks({
  organizationId,
  postIds = [],
}) {
  if (!organizationId || !Array.isArray(postIds) || postIds.length === 0) {
    return [];
  }

  const normalizedPostIds = [...new Set(postIds.filter(Boolean))];
  if (normalizedPostIds.length === 0) return [];

  const { data: links, error } = await supabase
    .from('org_post_asset_links')
    .select('*')
    .eq('organization_id', organizationId)
    .in('post_id', normalizedPostIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return [];
  }

  const assetIds = [...new Set(safeArray(links).map((link) => link.asset_id).filter(Boolean))];
  if (assetIds.length === 0) return safeArray(links);

  const { data: assets, error: assetError } = await supabase
    .from('org_asset_library')
    .select('*')
    .in('id', assetIds);

  if (assetError) {
    if (!isMissingRelationError(assetError)) {
      throw assetError;
    }
    return safeArray(links);
  }

  const assetMap = new Map(safeArray(assets).map((asset) => [asset.id, asset]));
  return safeArray(links).map((link) => ({
    ...link,
    asset: assetMap.get(link.asset_id) || null,
  }));
}

export async function syncOrgPostAssetLinks({
  organizationId,
  postId,
  assetReferences = [],
  createdBy = null,
}) {
  if (!organizationId || !postId) return [];

  const desired = safeArray(assetReferences)
    .filter((asset) => asset?.id)
    .map((asset, index) => ({
      organization_id: organizationId,
      post_id: postId,
      asset_id: asset.id,
      asset_role: asset.assetRole || (index === 0 ? 'primary' : 'supporting'),
      sort_order: index,
      created_by: createdBy || null,
    }));

  const { data: existingRows, error: existingError } = await supabase
    .from('org_post_asset_links')
    .select('id, asset_id')
    .eq('organization_id', organizationId)
    .eq('post_id', postId);

  if (existingError) {
    if (!isMissingRelationError(existingError)) {
      throw existingError;
    }
    return [];
  }

  const existing = safeArray(existingRows);
  const nextAssetIds = new Set(desired.map((row) => row.asset_id));
  const staleIds = existing
    .filter((row) => !nextAssetIds.has(row.asset_id))
    .map((row) => row.id);

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('org_post_asset_links')
      .delete()
      .in('id', staleIds);

    if (deleteError && !isMissingRelationError(deleteError)) {
      throw deleteError;
    }
  }

  if (desired.length > 0) {
    const { error: upsertError } = await supabase
      .from('org_post_asset_links')
      .upsert(desired, {
        onConflict: 'post_id,asset_id',
      });

    if (upsertError && !isMissingRelationError(upsertError)) {
      throw upsertError;
    }
  }

  return fetchOrgPostAssetLinks({
    organizationId,
    postIds: [postId],
  });
}
