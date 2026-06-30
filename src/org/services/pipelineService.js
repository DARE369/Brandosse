import { supabase } from '../../services/supabaseClient';
import { fetchOrgPostAssetLinks } from './assetLibraryService';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `stage-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

export const PIPELINE_TEMPLATE_PRESETS = [
  {
    key: 'standard',
    label: 'Standard',
    description: 'Contributor to editor to final approval.',
  },
  {
    key: 'agency_client',
    label: 'Agency Client',
    description: 'Adds a client review stage before final approval.',
  },
  {
    key: 'fast_track',
    label: 'Fast Track',
    description: 'Lean review flow for time-sensitive content.',
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description: 'Adds legal or compliance review ahead of approval.',
  },
];

export function createPipelineStage(partial = {}) {
  return {
    id: partial.id || createUuid(),
    order: Number(partial.order || 1),
    name: partial.name || 'Review',
    description: partial.description || '',
    assignee_type: partial.assignee_type || 'role',
    assignee_role: partial.assignee_role || 'editor',
    assignee_user_id: partial.assignee_user_id || null,
    sla_hours: partial.sla_hours === '' || partial.sla_hours === undefined || partial.sla_hours === null
      ? null
      : Number(partial.sla_hours),
    escalation_user_id: partial.escalation_user_id || null,
    require_comment_on_rejection: Boolean(partial.require_comment_on_rejection),
    is_optional: Boolean(partial.is_optional),
    generates_client_review_link: Boolean(partial.generates_client_review_link),
  };
}

export function normalizePipelineStages(stages = []) {
  return safeArray(stages).map((stage, index) => ({
    ...createPipelineStage(stage),
    order: index + 1,
  }));
}

export function buildTemplateStages(templateKey = 'standard') {
  switch (templateKey) {
    case 'agency_client':
      return normalizePipelineStages([
        createPipelineStage({ name: 'Contributor Review', assignee_role: 'editor', sla_hours: 12 }),
        createPipelineStage({ name: 'Client Review', assignee_role: 'reviewer', generates_client_review_link: true, sla_hours: 24 }),
        createPipelineStage({ name: 'Final Approval', assignee_role: 'org_admin', sla_hours: 12 }),
      ]);
    case 'fast_track':
      return normalizePipelineStages([
        createPipelineStage({ name: 'Quick Review', assignee_role: 'editor', sla_hours: 6 }),
        createPipelineStage({ name: 'Publish Approval', assignee_role: 'org_admin', sla_hours: 6 }),
      ]);
    case 'compliance':
      return normalizePipelineStages([
        createPipelineStage({ name: 'Editorial Review', assignee_role: 'editor', sla_hours: 12 }),
        createPipelineStage({ name: 'Compliance Check', assignee_role: 'org_admin', require_comment_on_rejection: true, sla_hours: 24 }),
        createPipelineStage({ name: 'Final Approval', assignee_role: 'org_owner', sla_hours: 12 }),
      ]);
    case 'standard':
    default:
      return normalizePipelineStages([
        createPipelineStage({ name: 'Editorial Review', assignee_role: 'editor', sla_hours: 12 }),
        createPipelineStage({ name: 'Final Approval', assignee_role: 'org_admin', sla_hours: 12 }),
      ]);
  }
}

function resolveCurrentStage(config, item) {
  const stages = Array.isArray(config?.stages)
    ? [...config.stages].sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    : [];

  return stages.find((stage) => Number(stage?.order || 0) === Number(item?.current_stage_order || 0))
    || stages[0]
    || null;
}

export async function fetchPipelineConfigs({ organizationId, brandProjectId = null }) {
  if (!organizationId) return [];

  let query = supabase
    .from('pipeline_configs')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[pipelineService] failed to fetch pipeline configs:', error.message);
    }
    return [];
  }

  return safeArray(data);
}

async function syncDefaultPipelineSetting({ organizationId, pipelineConfigId }) {
  const { data: organizationRow, error: organizationError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .maybeSingle();

  if (organizationError) {
    if (!isMissingRelationError(organizationError)) {
      throw organizationError;
    }
    return null;
  }

  const nextSettings = organizationRow?.settings && typeof organizationRow.settings === 'object'
    ? { ...organizationRow.settings }
    : {};

  nextSettings.default_pipeline_id = pipelineConfigId;

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', organizationId);

  if (updateError && !isMissingRelationError(updateError)) {
    throw updateError;
  }

  return nextSettings;
}

export async function createPipelineConfig({
  organizationId,
  brandProjectId = null,
  name,
  description = '',
  templateKey = 'custom',
  stages = [],
  isDefault = false,
  createdBy = null,
}) {
  if (!organizationId) {
    throw new Error('An organization is required.');
  }

  const payload = {
    organization_id: organizationId,
    brand_project_id: brandProjectId,
    name: String(name || 'Untitled Pipeline').trim(),
    description: String(description || '').trim(),
    is_default: Boolean(isDefault),
    template_key: templateKey || 'custom',
    stages: normalizePipelineStages(stages),
    created_by: createdBy || null,
  };

  const { data, error } = await supabase
    .from('pipeline_configs')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;

  if (payload.is_default) {
    await setDefaultPipelineConfig({
      organizationId,
      pipelineConfigId: data.id,
    });
  }

  return data;
}

export async function updatePipelineConfig(pipelineConfigId, updates = {}) {
  if (!pipelineConfigId) {
    throw new Error('A pipeline config id is required.');
  }

  const payload = { ...updates };
  if (payload.stages) {
    payload.stages = normalizePipelineStages(payload.stages);
  }

  const { data, error } = await supabase
    .from('pipeline_configs')
    .update(payload)
    .eq('id', pipelineConfigId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function duplicatePipelineConfig({
  organizationId,
  pipelineConfig,
  createdBy = null,
}) {
  if (!pipelineConfig?.id) {
    throw new Error('Choose a pipeline to duplicate.');
  }

  return createPipelineConfig({
    organizationId,
    brandProjectId: pipelineConfig.brand_project_id || null,
    name: `${pipelineConfig.name || 'Pipeline'} Copy`,
    description: pipelineConfig.description || '',
    templateKey: pipelineConfig.template_key || 'custom',
    stages: normalizePipelineStages(pipelineConfig.stages || []),
    isDefault: false,
    createdBy,
  });
}

export async function deletePipelineConfig(pipelineConfigId) {
  if (!pipelineConfigId) {
    throw new Error('A pipeline config id is required.');
  }

  const { error } = await supabase
    .from('pipeline_configs')
    .delete()
    .eq('id', pipelineConfigId);

  if (error) throw error;
  return true;
}

export async function setDefaultPipelineConfig({ organizationId, pipelineConfigId }) {
  if (!organizationId || !pipelineConfigId) {
    throw new Error('Organization and pipeline config are required.');
  }

  const { error: clearError } = await supabase
    .from('pipeline_configs')
    .update({ is_default: false })
    .eq('organization_id', organizationId);

  if (clearError) throw clearError;

  const { data, error } = await supabase
    .from('pipeline_configs')
    .update({ is_default: true })
    .eq('id', pipelineConfigId)
    .select('*')
    .single();

  if (error) throw error;

  await syncDefaultPipelineSetting({ organizationId, pipelineConfigId });
  return data;
}

export async function fetchPipelineItems({ organizationId, brandProjectId = null }) {
  if (!organizationId) return [];

  const selectVariants = [
    `
      id,
      organization_id,
      brand_project_id,
      pipeline_config_id,
      post_id,
      task_id,
      generation_id,
      submitted_by,
      current_stage_order,
      status,
      title,
      platform,
      scheduled_for,
      submission_note,
      history,
      current_assignee_role,
      current_assignee_user_id,
      sla_deadline,
      client_review_token,
      client_review_token_expires_at,
      created_at,
      updated_at,
      posts (
        id,
        caption,
        status,
        scheduled_at,
        generation_id
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
      organization_id,
      brand_project_id,
      pipeline_config_id,
      post_id,
      generation_id,
      submitted_by,
      current_stage_order,
      status,
      title,
      platform,
      scheduled_for,
      submission_note,
      history,
      current_assignee_role,
      current_assignee_user_id,
      sla_deadline,
      client_review_token,
      client_review_token_expires_at,
      created_at,
      updated_at,
      posts (
        id,
        caption,
        status,
        scheduled_at,
        generation_id
      ),
      generations (
        id,
        prompt,
        storage_path,
        media_type
      )
    `,
  ];

  let data = [];

  for (const selection of selectVariants) {
    let query = supabase
      .from('pipeline_items')
      .select(selection)
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false });

    if (brandProjectId) {
      query = query.eq('brand_project_id', brandProjectId);
    }

    const { data: rows, error } = await query;
    if (!error) {
      data = safeArray(rows);
      break;
    }

    if (!isMissingRelationError(error)) {
      console.warn('[pipelineService] failed to fetch pipeline items:', error.message);
      return [];
    }
  }

  const items = safeArray(data);
  const configs = await fetchPipelineConfigs({ organizationId, brandProjectId });
  const configMap = new Map(safeArray(configs).map((config) => [config.id, config]));
  const postIds = items
    .map((item) => item.posts?.id || item.post_id)
    .filter(Boolean);

  const linksByPostId = new Map();
  if (postIds.length > 0) {
    const links = await fetchOrgPostAssetLinks({
      organizationId,
      postIds,
    });

    safeArray(links).forEach((link) => {
      const current = linksByPostId.get(link.post_id) || [];
      current.push(link);
      linksByPostId.set(link.post_id, current);
    });
  }

  return items.map((item) => {
    const postId = item.posts?.id || item.post_id;
    const assetLinks = linksByPostId.get(postId) || [];
    const currentStage = resolveCurrentStage(configMap.get(item.pipeline_config_id) || null, item);
    return {
      ...item,
      currentStage,
      currentStageName: currentStage?.name || item.current_assignee_role || item.status || 'Stage',
      asset_links: assetLinks,
      attached_assets: assetLinks.map((link) => link.asset).filter(Boolean),
    };
  });
}

function resolveInitialStage(stages = []) {
  const normalizedStages = safeArray(stages)
    .slice()
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0));

  return normalizedStages[0] || null;
}

function resolveFinalStage(stages = []) {
  const normalizedStages = safeArray(stages)
    .slice()
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0));

  return normalizedStages[normalizedStages.length - 1] || null;
}

async function resolvePipelineBrandProjectId({
  organizationId,
  brandProjectId = null,
  post = null,
}) {
  const explicitBrandProjectId = brandProjectId
    || post?.brand_project_id
    || post?.generations?.brand_project_id
    || null;
  if (explicitBrandProjectId) {
    return explicitBrandProjectId;
  }

  const { data, error } = await supabase
    .from('brand_projects')
    .select('id, status, is_default, created_at')
    .eq('organization_id', organizationId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return null;
  }

  const projects = safeArray(data);
  const activeProject = projects.find((project) => (
    String(project?.status || 'active').trim().toLowerCase() !== 'archived'
  ));

  return activeProject?.id || projects[0]?.id || null;
}

export async function submitPostToPipeline({
  organizationId,
  brandProjectId,
  post,
  userId,
  pipelineConfigId = null,
  submissionNote = '',
}) {
  if (!organizationId || !post?.id || !userId) {
    throw new Error('Missing pipeline submission details');
  }

  const resolvedBrandProjectId = await resolvePipelineBrandProjectId({
    organizationId,
    brandProjectId,
    post,
  });
  if (!resolvedBrandProjectId) {
    throw new Error('A brand project is required before submitting to pipeline. Create/select a brand project, then try again.');
  }

  let chosenConfigId = pipelineConfigId;
  let chosenConfig = null;

  if (!chosenConfigId) {
    const configs = await fetchPipelineConfigs({
      organizationId,
      brandProjectId: resolvedBrandProjectId,
    });
    chosenConfig = configs[0] || null;
    chosenConfigId = chosenConfig?.id || null;
  } else {
    const configs = await fetchPipelineConfigs({
      organizationId,
      brandProjectId: resolvedBrandProjectId,
    });
    chosenConfig = configs.find((config) => config.id === chosenConfigId) || null;
  }

  if (!chosenConfigId || !chosenConfig) {
    throw new Error('No pipeline configuration is available for this organization yet');
  }

  const initialStage = resolveInitialStage(chosenConfig.stages);
  const history = [
    {
      event: 'submitted',
      stage_order: Number(initialStage?.order || 0),
      stage_name: initialStage?.name || 'Submitted',
      actor_id: userId,
      actor_name: 'Member',
      comment: submissionNote || null,
      timestamp: new Date().toISOString(),
    },
  ];

  const { data: inserted, error: insertError } = await supabase
    .from('pipeline_items')
    .insert({
      organization_id: organizationId,
      brand_project_id: resolvedBrandProjectId,
      pipeline_config_id: chosenConfigId,
      post_id: post.id,
      generation_id: post.generation_id || post.generations?.id || null,
      submitted_by: userId,
      current_stage_order: Number(initialStage?.order || 0),
      status: initialStage ? 'in_review' : 'pending',
      title: (post.title || post.caption || post.generations?.prompt || 'Untitled draft').slice(0, 120),
      platform: post.platform || null,
      scheduled_for: post.scheduled_at || null,
      submission_note: submissionNote || null,
      history,
      current_assignee_role: initialStage?.assignee_role || null,
      current_assignee_user_id: initialStage?.assignee_user_id || null,
      sla_deadline: initialStage?.sla_hours
        ? new Date(Date.now() + Number(initialStage.sla_hours) * 60 * 60 * 1000).toISOString()
        : null,
    })
    .select('*')
    .single();

  if (insertError) throw insertError;

  const { error: postUpdateError } = await supabase
    .from('posts')
    .update({ pipeline_item_id: inserted.id })
    .eq('id', post.id);

  if (postUpdateError && !isMissingRelationError(postUpdateError)) {
    throw postUpdateError;
  }

  return inserted;
}

export async function createDirectPublishPipelineItem({
  organizationId,
  brandProjectId,
  post,
  userId,
  pipelineConfigId = null,
  submissionNote = 'Direct publish selected',
}) {
  if (!organizationId || !post?.id || !userId) {
    throw new Error('Missing direct publish details');
  }

  const resolvedBrandProjectId = await resolvePipelineBrandProjectId({
    organizationId,
    brandProjectId,
    post,
  });
  if (!resolvedBrandProjectId) {
    throw new Error('A brand project is required before creating a direct publish pipeline item. Create/select a brand project, then try again.');
  }

  let chosenConfigId = pipelineConfigId;
  let chosenConfig = null;
  const configs = await fetchPipelineConfigs({
    organizationId,
    brandProjectId: resolvedBrandProjectId,
  });

  if (!chosenConfigId) {
    chosenConfig = configs[0] || null;
    chosenConfigId = chosenConfig?.id || null;
  } else {
    chosenConfig = configs.find((config) => config.id === chosenConfigId) || null;
  }

  if (!chosenConfigId || !chosenConfig) {
    throw new Error('No pipeline configuration is available for this organization yet');
  }

  const initialStage = resolveInitialStage(chosenConfig.stages);
  const finalStage = resolveFinalStage(chosenConfig.stages) || initialStage;
  const timestamp = new Date().toISOString();
  const history = [
    {
      event: 'submitted',
      stage_order: Number(initialStage?.order || 0),
      stage_name: initialStage?.name || 'Submitted',
      actor_id: userId,
      actor_name: 'Member',
      comment: submissionNote || null,
      timestamp,
    },
    {
      event: 'auto_approved',
      stage_order: Number(finalStage?.order || initialStage?.order || 0),
      stage_name: finalStage?.name || 'Approved',
      actor_id: userId,
      actor_name: 'Member',
      comment: 'Direct publish bypassed approval routing based on role permissions.',
      timestamp,
    },
  ];

  const titleSource = String(
    post.title
      || post.caption
      || post.generations?.prompt
      || 'Untitled draft',
  ).trim();

  const { data: inserted, error: insertError } = await supabase
    .from('pipeline_items')
    .insert({
      organization_id: organizationId,
      brand_project_id: resolvedBrandProjectId,
      pipeline_config_id: chosenConfigId,
      post_id: post.id,
      generation_id: post.generation_id || post.generations?.id || null,
      submitted_by: userId,
      current_stage_order: Number(finalStage?.order || initialStage?.order || 0),
      status: 'approved',
      title: titleSource.slice(0, 120),
      platform: post.platform || null,
      scheduled_for: post.scheduled_at || null,
      submission_note: submissionNote || null,
      history,
      current_assignee_role: null,
      current_assignee_user_id: null,
      sla_deadline: null,
    })
    .select('*')
    .single();

  if (insertError) throw insertError;

  const { error: postUpdateError } = await supabase
    .from('posts')
    .update({ pipeline_item_id: inserted.id })
    .eq('id', post.id);

  if (postUpdateError && !isMissingRelationError(postUpdateError)) {
    throw postUpdateError;
  }

  return inserted;
}

export async function advancePipelineItem(payload) {
  const { data, error } = await supabase.functions.invoke('pipeline-advance', {
    body: payload,
  });

  if (error) throw error;
  return data;
}

export async function generateClientReviewLink(pipelineItemId) {
  const { data, error } = await supabase.functions.invoke('pipeline-generate-client-link', {
    body: { pipeline_item_id: pipelineItemId },
  });

  if (error) throw error;
  return data;
}

export async function fetchClientReviewPreview(clientReviewToken) {
  const { data, error } = await supabase.functions.invoke('pipeline-client-action', {
    body: {
      client_review_token: clientReviewToken,
      action: 'preview',
    },
  });

  if (error) throw error;
  return data;
}

export async function submitClientReviewAction(payload) {
  const { data, error } = await supabase.functions.invoke('pipeline-client-action', {
    body: payload,
  });

  if (error) throw error;
  return data;
}
