import { supabase } from '../../services/supabaseClient';
import { getUserOrgMemberships } from '../../services/authService';

export const ORG_ROLE_DEFAULTS = {
  org_owner: {
    can_publish: true,
    publish_requires_final_approval: false,
    can_manage_library: true,
    can_approve_library_uploads: true,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: true,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  org_admin: {
    can_publish: true,
    publish_requires_final_approval: false,
    can_manage_library: true,
    can_approve_library_uploads: true,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: true,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  editor: {
    can_publish: true,
    publish_requires_final_approval: true,
    can_manage_library: true,
    can_approve_library_uploads: false,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: false,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  contributor: {
    can_publish: false,
    publish_requires_final_approval: false,
    can_manage_library: false,
    can_approve_library_uploads: false,
    can_schedule: false,
    can_manage_tasks: false,
    can_invite_members: false,
    can_create_channels: false,
    monthly_credit_limit: 200,
  },
  reviewer: {
    can_publish: false,
    publish_requires_final_approval: false,
    can_manage_library: false,
    can_approve_library_uploads: false,
    can_schedule: false,
    can_manage_tasks: false,
    can_invite_members: false,
    can_create_channels: false,
    monthly_credit_limit: 0,
  },
  member: {
    can_publish: false,
    publish_requires_final_approval: false,
    can_manage_library: false,
    can_approve_library_uploads: false,
    can_schedule: false,
    can_manage_tasks: false,
    can_invite_members: false,
    can_create_channels: false,
    monthly_credit_limit: 200,
  },
};

const MEMBERSHIP_SELECT_VARIANTS = [
  'id, organization_id, user_id, role, org_role_key, status, permissions, brand_project_ids, credits_used_this_period, joined_at, invited_at, last_active_at',
  'id, organization_id, user_id, role, status, permissions, brand_project_ids, credits_used_this_period, joined_at, invited_at, last_active_at',
  'id, organization_id, user_id, role, status, joined_at',
];

const ORGANIZATION_SELECT_VARIANTS = [
  'id, name, slug, logo_url, avatar_url, brand_color, plan_key, status, settings, monthly_credit_pool, credits_used_this_period, credit_reset_date, owner_id, owner_user_id',
  'id, name, slug, avatar_url, status, owner_user_id',
];

const BRAND_PROJECT_SELECT_VARIANTS = [
  'id, organization_id, name, slug, description, logo_url, brand_color, brand_settings, is_default, status, created_by, created_at, updated_at',
  'id, organization_id, name, slug, description, is_default, status, created_at, updated_at',
];

function isMissingRelationError(error) {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('could not find')
    || message.includes('column')
    || message.includes('relation')
    || message.includes('pgrst')
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getInvitationBaseUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return '';
  }
  return window.location.origin.replace(/\/+$/, '');
}

export function buildOrganizationInvitationUrl(invitationToken) {
  const normalizedToken = String(invitationToken || '').trim();
  if (!normalizedToken) return '';

  const baseUrl = getInvitationBaseUrl();
  return baseUrl ? `${baseUrl}/join?token=${normalizedToken}` : `/join?token=${normalizedToken}`;
}

export function getOrganizationInvitationStatus(invitation) {
  if (!invitation) return 'missing';
  if (invitation.status && invitation.status !== 'pending') return invitation.status;

  if (invitation.expires_at || invitation.expiresAt) {
    const expiresAt = new Date(invitation.expires_at || invitation.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return 'expired';
    }
  }

  return 'pending';
}

function slugifyRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

export function normalizeOrgRole(membership) {
  const rawRole = String(
    membership?.org_role_key
      || membership?.role
      || 'contributor',
  ).trim().toLowerCase();

  if (!rawRole || rawRole === 'member') return 'contributor';
  return rawRole;
}

export function isOrgAdminRole(role) {
  return ['org_owner', 'org_admin'].includes(String(role || '').trim().toLowerCase());
}

export function toLegacyMembershipRole(roleKey) {
  return ['org_owner', 'org_admin'].includes(String(roleKey || '').trim().toLowerCase())
    ? 'org_admin'
    : 'member';
}

export function resolveOrgPermissions({ role, templatePermissions = {}, overrides = {} } = {}) {
  return {
    ...(ORG_ROLE_DEFAULTS[role] || ORG_ROLE_DEFAULTS.contributor),
    ...(templatePermissions && typeof templatePermissions === 'object' ? templatePermissions : {}),
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  };
}

function mapMembershipRow(row) {
  if (!row) return null;

  const role = normalizeOrgRole(row);
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    legacyRole: row.role || null,
    role,
    status: row.status || 'active',
    permissions: row.permissions && typeof row.permissions === 'object' ? row.permissions : {},
    brandProjectIds: Array.isArray(row.brand_project_ids) ? row.brand_project_ids : null,
    creditsUsedThisPeriod: Number(row.credits_used_this_period || 0),
    joinedAt: row.joined_at || null,
    invitedAt: row.invited_at || null,
    lastActiveAt: row.last_active_at || null,
  };
}

async function selectWithFallback(tableName, selectVariants, applyQuery) {
  let lastError = null;

  for (const selectClause of selectVariants) {
    const query = applyQuery(
      supabase.from(tableName).select(selectClause),
    );
    const result = await query;

    if (!result.error) {
      return result;
    }

    lastError = result.error;
    if (!isMissingRelationError(result.error)) {
      return result;
    }
  }

  return { data: null, error: lastError };
}

export async function fetchContextLastUsed(userId) {
  if (!userId) return null;

  const result = await supabase
    .from('context_last_used')
    .select('user_id, last_context_type, last_organization_id, last_brand_project_id, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (result.error) {
    if (!isMissingRelationError(result.error)) {
      console.warn('[orgService] failed to fetch context_last_used:', result.error.message);
    }
    return null;
  }

  return result.data || null;
}

export async function updateLastUsedContext({
  userId,
  contextType = 'personal',
  organizationId = null,
  brandProjectId = null,
}) {
  if (!userId) return false;

  const { error } = await supabase.from('context_last_used').upsert(
    {
      user_id: userId,
      last_context_type: contextType,
      last_organization_id: organizationId,
      last_brand_project_id: brandProjectId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[orgService] failed to update context_last_used:', error.message);
    }
    return false;
  }

  return true;
}

export async function fetchOrganizationMembership({ organizationId, userId }) {
  if (!organizationId || !userId) return null;

  const result = await selectWithFallback(
    'organization_members',
    MEMBERSHIP_SELECT_VARIANTS,
    (query) => query
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  );

  if (result.error) {
    if (!isMissingRelationError(result.error)) {
      console.warn('[orgService] failed to fetch organization membership:', result.error.message);
    }
    return null;
  }

  return mapMembershipRow(result.data || null);
}

export async function fetchOrganizationById(organizationId) {
  if (!organizationId) return null;

  const result = await selectWithFallback(
    'organizations',
    ORGANIZATION_SELECT_VARIANTS,
    (query) => query.eq('id', organizationId).maybeSingle(),
  );

  if (result.error) {
    if (!isMissingRelationError(result.error)) {
      console.warn('[orgService] failed to fetch organization:', result.error.message);
    }
    return null;
  }

  if (!result.data) return null;

  const row = result.data;
  return {
    id: row.id,
    name: row.name || 'Organization',
    slug: row.slug || null,
    logoUrl: row.logo_url || row.avatar_url || null,
    brandColor: row.brand_color || '#6366f1',
    planKey: row.plan_key || row.plan || 'organization',
    status: row.status || 'active',
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
    monthlyCreditPool: Number(row.monthly_credit_pool || 0),
    creditsUsedThisPeriod: Number(row.credits_used_this_period || 0),
    creditResetDate: row.credit_reset_date || null,
    ownerId: row.owner_id || row.owner_user_id || null,
  };
}

export async function fetchBrandProjects({ organizationId }) {
  if (!organizationId) return [];

  const result = await selectWithFallback(
    'brand_projects',
    BRAND_PROJECT_SELECT_VARIANTS,
    (query) => query
      .eq('organization_id', organizationId)
      .neq('status', 'archived')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  );

  if (result.error) {
    if (!isMissingRelationError(result.error)) {
      console.warn('[orgService] failed to fetch brand projects:', result.error.message);
    }
    return [];
  }

  return safeArray(result.data).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name || 'Brand Project',
    slug: row.slug || null,
    description: row.description || '',
    logoUrl: row.logo_url || null,
    brandColor: row.brand_color || '#6366f1',
    brandSettings: row.brand_settings && typeof row.brand_settings === 'object'
      ? row.brand_settings
      : {},
    isDefault: Boolean(row.is_default),
    status: row.status || 'active',
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
}

export function pickActiveBrandProject({
  brandProjects = [],
  membership = null,
  lastUsedContext = null,
}) {
  if (!brandProjects.length) return null;

  const scopedProjects = membership?.brandProjectIds
    ? brandProjects.filter((project) => membership.brandProjectIds.includes(project.id))
    : brandProjects;

  const candidateProjects = scopedProjects.length ? scopedProjects : brandProjects;
  const lastProject = candidateProjects.find(
    (project) => project.id === lastUsedContext?.last_brand_project_id,
  );
  if (lastProject) return lastProject;

  const defaultProject = candidateProjects.find((project) => project.isDefault);
  if (defaultProject) return defaultProject;

  return candidateProjects[0] || null;
}

export async function fetchOrganizationContext({ organizationId, userId, membershipHint = null }) {
  const [organization, lastUsedContext, freshMembership, brandProjects] = await Promise.all([
    fetchOrganizationById(organizationId),
    fetchContextLastUsed(userId),
    fetchOrganizationMembership({ organizationId, userId }),
    fetchBrandProjects({ organizationId }),
  ]);

  const membership = freshMembership || membershipHint;
  const role = normalizeOrgRole(membership);
  const roleTemplate = await fetchOrgRoleTemplateByRoleKey(organizationId, role);
  const permissions = resolveOrgPermissions({
    role,
    templatePermissions: roleTemplate?.permissions,
    overrides: membership?.permissions,
  });
  const activeBrandProject = pickActiveBrandProject({
    brandProjects,
    membership,
    lastUsedContext,
  });

  return {
    organization,
    membership,
    role,
    permissions,
    brandProjects,
    activeBrandProject,
    lastUsedContext,
    isMember: Boolean(membership?.organizationId),
    isOrgAdmin: isOrgAdminRole(role),
    isOrgOwner: role === 'org_owner',
    isAgency: (organization?.planKey || '').toLowerCase() === 'agency',
  };
}

export async function recordOrgMemberActivity({ organizationId, userId }) {
  if (!organizationId || !userId) return;

  const { error } = await supabase
    .from('organization_members')
    .update({ last_active_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error && !isMissingRelationError(error)) {
    console.warn('[orgService] failed to update organization_members.last_active_at:', error.message);
  }
}

export async function fetchOrganizationMembers(organizationId) {
  if (!organizationId) return [];

  const membershipResult = await selectWithFallback(
    'organization_members',
    MEMBERSHIP_SELECT_VARIANTS,
    (query) => query
      .eq('organization_id', organizationId)
      .neq('status', 'removed')
      .order('joined_at', { ascending: true }),
  );

  if (membershipResult.error) {
    if (!isMissingRelationError(membershipResult.error)) {
      console.warn('[orgService] failed to fetch organization members:', membershipResult.error.message);
    }
    return [];
  }

  const memberships = safeArray(membershipResult.data).map(mapMembershipRow).filter(Boolean);
  const userIds = memberships.map((item) => item.userId).filter(Boolean);

  if (!userIds.length) return memberships;

  const profilesResult = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email')
    .in('id', userIds);

  if (profilesResult.error) {
    if (!isMissingRelationError(profilesResult.error)) {
      console.warn('[orgService] failed to fetch member profiles:', profilesResult.error.message);
    }
    return memberships;
  }

  const profileMap = new Map(safeArray(profilesResult.data).map((profile) => [profile.id, profile]));
  return memberships.map((membership) => ({
    ...membership,
    profile: profileMap.get(membership.userId) || null,
  }));
}

export async function fetchOrgDrafts({ organizationId, userId, brandProjectId = null }) {
  if (!organizationId || !userId) return [];

  let query = supabase
    .from('posts')
    .select(`
      id,
      user_id,
      generation_id,
      organization_id,
      brand_project_id,
      title,
      caption,
      hashtags,
      status,
      platform,
      account_id,
      scheduled_at,
      created_at,
      updated_at,
      pipeline_item_id,
      seo_state,
      workflow_state,
      generations (
        id,
        prompt,
        storage_path,
        media_type,
        organization_id,
        brand_project_id
      )
    `)
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false });

  if (brandProjectId) {
    query = query.eq('brand_project_id', brandProjectId);
  }

  const { data, error } = await query;

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[orgService] failed to fetch org drafts:', error.message);
    }
    return [];
  }

  return safeArray(data);
}

export async function deleteOrgDraft(postId) {
  if (!postId) {
    throw new Error('A draft id is required.');
  }

  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('status', 'draft');

  if (error) throw error;
  return true;
}

export async function fetchOrgRoleTemplates(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('org_role_templates')
    .select('*')
    .eq('organization_id', organizationId)
    .order('role_key', { ascending: true });

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[orgService] failed to fetch org role templates:', error.message);
    }
    return [];
  }

  return safeArray(data);
}

export async function fetchOrgRoleTemplateByRoleKey(organizationId, roleKey) {
  if (!organizationId || !roleKey) return null;

  const { data, error } = await supabase
    .from('org_role_templates')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('role_key', roleKey)
    .maybeSingle();

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[orgService] failed to fetch org role template by key:', error.message);
    }
    return null;
  }

  return data || null;
}

export function buildUniqueOrgRoleKey(displayName, existingTemplates = [], currentTemplateId = null) {
  const usedKeys = new Set(
    safeArray(existingTemplates)
      .filter((template) => template?.id !== currentTemplateId)
      .map((template) => String(template?.role_key || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const base = slugifyRoleKey(displayName) || 'custom_role';
  let nextKey = base;
  let suffix = 2;

  while (usedKeys.has(nextKey)) {
    nextKey = `${base}_${suffix}`;
    suffix += 1;
  }

  return nextKey;
}

function sanitizePermissionsPayload(permissions = {}) {
  const next = { ...(permissions && typeof permissions === 'object' ? permissions : {}) };
  const hasCanPublish = Object.prototype.hasOwnProperty.call(next, 'can_publish');

  Object.keys(next).forEach((key) => {
    const value = next[key];
    if (value === undefined || value === '') {
      delete next[key];
    }
  });

  if (hasCanPublish && !next.can_publish) {
    next.publish_requires_final_approval = false;
  }

  if (
    next.monthly_credit_limit === null
    || next.monthly_credit_limit === undefined
    || next.monthly_credit_limit === ''
  ) {
    delete next.monthly_credit_limit;
  } else {
    next.monthly_credit_limit = Number(next.monthly_credit_limit);
  }

  return next;
}

export async function createOrgRoleTemplate({
  organizationId,
  roleKey,
  displayName,
  permissions = {},
  isSystem = false,
}) {
  const payload = {
    organization_id: organizationId,
    role_key: String(roleKey || '').trim().toLowerCase(),
    display_name: String(displayName || '').trim(),
    permissions: sanitizePermissionsPayload(permissions),
    is_system: Boolean(isSystem),
  };

  const { data, error } = await supabase
    .from('org_role_templates')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateOrgRoleTemplate(roleTemplateId, updates = {}) {
  if (!roleTemplateId) {
    throw new Error('A role template id is required.');
  }

  const payload = { ...updates };
  if (payload.permissions) {
    payload.permissions = sanitizePermissionsPayload(payload.permissions);
  }

  const { data, error } = await supabase
    .from('org_role_templates')
    .update(payload)
    .eq('id', roleTemplateId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteOrgRoleTemplate(roleTemplateId) {
  if (!roleTemplateId) {
    throw new Error('A role template id is required.');
  }

  const { error } = await supabase
    .from('org_role_templates')
    .delete()
    .eq('id', roleTemplateId);

  if (error) throw error;
  return true;
}

export async function duplicateOrgRoleTemplate({
  organizationId,
  template,
  existingTemplates = [],
}) {
  if (!template?.id) {
    throw new Error('Choose a role template to duplicate.');
  }

  const displayName = `${template.display_name || template.role_key || 'Role'} Copy`;
  return createOrgRoleTemplate({
    organizationId,
    roleKey: buildUniqueOrgRoleKey(displayName, existingTemplates),
    displayName,
    permissions: template.permissions || {},
    isSystem: false,
  });
}

export async function updateOrganizationMember(memberId, updates = {}) {
  if (!memberId) {
    throw new Error('A member id is required.');
  }

  const payload = { ...updates };

  if (payload.permissions) {
    payload.permissions = sanitizePermissionsPayload(payload.permissions);
  }

  if (payload.org_role_key) {
    payload.org_role_key = String(payload.org_role_key).trim().toLowerCase();
    payload.role = toLegacyMembershipRole(payload.org_role_key);
  }

  if (payload.brand_project_ids === undefined) {
    delete payload.brand_project_ids;
  }

  const { data, error } = await supabase
    .from('organization_members')
    .update(payload)
    .eq('id', memberId)
    .select('*')
    .single();

  if (error) throw error;
  return mapMembershipRow(data);
}

export async function fetchOrganizationMembershipsForSelector(userId) {
  return getUserOrgMemberships(userId);
}

export async function inviteOrganizationMember(payload) {
  const normalizedPayload = {
    ...payload,
  };

  if (
    !normalizedPayload.app_url
    && typeof window !== 'undefined'
    && window.location?.origin
  ) {
    normalizedPayload.app_url = window.location.origin;
  }

  const { data, error } = await supabase.functions.invoke('org-invite-member', {
    body: normalizedPayload,
  });

  if (error) throw error;
  const onboardingUrl = data?.onboarding_url
    || data?.invitation_url
    || data?.password_setup_url
    || '';

  return {
    ...data,
    onboarding_url: onboardingUrl,
    invitation_url: data?.invitation_url || onboardingUrl,
    password_setup_url: data?.password_setup_url || (data?.requires_password_setup ? onboardingUrl : null),
    delivery_status: data?.delivery_status || (data?.email_dispatched ? 'sent' : 'manual_link_only'),
    delivery_reason: data?.delivery_reason || null,
  };
}

export async function previewOrganizationInvitation(invitationToken) {
  const { data, error } = await supabase.functions.invoke('org-accept-invitation', {
    body: {
      invitation_token: invitationToken,
      preview: true,
    },
  });

  if (error) throw error;
  return data;
}

export async function completeOrganizationInvitationSignup(invitationToken, password, passwordConfirm) {
  const { data, error } = await supabase.functions.invoke('org-complete-invitation-signup', {
    body: {
      invitation_token: invitationToken,
      password,
      password_confirm: passwordConfirm,
    },
  });

  if (error) throw error;
  return data;
}

export async function acceptOrganizationInvitation(invitationToken, options = {}) {
  const { data, error } = await supabase.functions.invoke('org-accept-invitation', {
    body: {
      invitation_token: invitationToken,
      preview: Boolean(options.preview),
    },
  });

  if (error) throw error;
  return data;
}

function mapOrganizationInvitationRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email || '',
    role: normalizeOrgRole({ org_role_key: row.role }),
    brandProjectIds: Array.isArray(row.brand_project_ids) ? row.brand_project_ids : null,
    invitedBy: row.invited_by || null,
    invitationToken: row.invitation_token || '',
    onboardingUrl: buildOrganizationInvitationUrl(row.invitation_token),
    status: getOrganizationInvitationStatus(row),
    rawStatus: row.status || 'pending',
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    acceptedAt: row.accepted_at || null,
    invitedUserId: row.invited_user_id || null,
    requiresPasswordSetup: Boolean(row.requires_password_setup),
  };
}

export async function fetchOrganizationInvitations(organizationId, { includeAccepted = false } = {}) {
  if (!organizationId) return [];

  let query = supabase
    .from('org_invitations')
    .select(`
      id,
      organization_id,
      email,
      role,
      brand_project_ids,
      invited_by,
      invitation_token,
      status,
      expires_at,
      created_at,
      accepted_at,
      invited_user_id,
      requires_password_setup
    `)
    .eq('organization_id', organizationId)
    .neq('role', 'org_owner')
    .order('created_at', { ascending: false });

  if (!includeAccepted) {
    query = query.neq('status', 'accepted');
  }

  const { data, error } = await query;

  if (error) {
    if (!isMissingRelationError(error)) {
      console.warn('[orgService] failed to fetch organization invitations:', error.message);
    }
    return [];
  }

  return safeArray(data).map(mapOrganizationInvitationRow).filter(Boolean);
}

export async function revokeOrganizationInvitation(invitationId) {
  if (!invitationId) {
    throw new Error('An invitation id is required.');
  }

  const { data, error } = await supabase.functions.invoke('org-revoke-invitation', {
    body: {
      invitation_id: invitationId,
    },
  });

  if (error) throw error;
  return data;
}

export async function deleteOrganizationInvitation(invitationId) {
  if (!invitationId) {
    throw new Error('An invitation id is required.');
  }

  const { data, error } = await supabase.functions.invoke('org-delete-invitation', {
    body: {
      invitation_id: invitationId,
    },
  });

  if (error) throw error;
  return data;
}
