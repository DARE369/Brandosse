import { supabase } from '../../services/supabaseClient';
import { insertAuditLog } from '../utils/adminClient';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'organization';
}

function normalizeInvitationStatus(invitation) {
  if (!invitation) return 'none';
  if (invitation.status !== 'pending') return invitation.status;
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    return 'expired';
  }
  return 'pending';
}

function getOrganizationSettings(settings) {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

function getProvisionSource(settings) {
  return settings?.provision_source === 'self_signup' ? 'self_signup' : 'admin_invite';
}

function buildJoinUrl(invitationToken) {
  const normalizedToken = String(invitationToken || '').trim();
  if (!normalizedToken) return '';

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/+$/, '')}/join?token=${normalizedToken}`;
  }

  return `/join?token=${normalizedToken}`;
}

async function normalizeInviteErrorMessage(error) {
  const context = error?.context;

  if (context && typeof context.text === 'function') {
    try {
      const payload = await context.clone().json();
      if (payload?.error) {
        return String(payload.error);
      }
    } catch (_jsonError) {
      try {
        const responseText = await context.clone().text();
        if (responseText) {
          return responseText;
        }
      } catch (_textError) {
        // Ignore response parsing failures and fall back to the generic error message.
      }
    }
  }

  const message = String(error?.message || '').trim();

  if (!message) {
    return 'Could not create the owner onboarding link.';
  }

  if (/failed to send a request to the edge function/i.test(message)) {
    return 'Could not reach the `org-invite-member` edge function. Deploy or redeploy it in Supabase, then try again.';
  }

  if (/non-2xx status code|edge function returned/i.test(message)) {
    return 'The `org-invite-member` edge function returned an error. Check the function logs and try again.';
  }

  return message;
}

async function updateOrganizationInviteState(organizationId, patch) {
  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;

  const { error: updateError } = await supabase
    .from('organizations')
    .update({
      settings: {
        ...getOrganizationSettings(organization?.settings),
        ...patch,
      },
    })
    .eq('id', organizationId);

  if (updateError) throw updateError;
}

async function writeInviteAuditLog({
  organizationId,
  eventType,
  summary,
  metadata = {},
  riskLevel = 'medium',
}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) return;

    const { data: adminRoleRow } = await supabase
      .from('admin_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    await insertAuditLog({
      actor_id: user.id,
      actor_type: 'admin',
      actor_role: adminRoleRow?.role || null,
      organization_id: organizationId,
      event_category: 'admin_action',
      event_type: eventType,
      entity_type: 'organization',
      entity_id: organizationId,
      summary,
      metadata,
      risk_level: riskLevel,
    });
  } catch (error) {
    console.warn('[orgAdminService] failed to write audit log:', error?.message || error);
  }
}

async function invokeOwnerInvite({
  organization,
  ownerEmail,
  source,
}) {
  const ownerAddress = String(ownerEmail || '').trim().toLowerCase();
  const appUrl = typeof window !== 'undefined' ? window.location.origin : null;

  if (!ownerAddress) {
    throw new Error('Owner email is required before creating the onboarding link.');
  }

  const { data, error } = await supabase.functions.invoke('org-invite-member', {
    body: {
      organization_id: organization.id,
      email: ownerAddress,
      role: 'org_owner',
      delivery_mode: 'manual_link',
      bootstrap_organization: true,
      plan_key: organization.plan_key || organization.plan || 'organization',
      org_name: organization.name,
      app_url: appUrl,
    },
  });

  if (error) {
    const normalizedMessage = await normalizeInviteErrorMessage(error);

    await updateOrganizationInviteState(organization.id, {
      pending_owner_email: ownerAddress,
      owner_invitation_status: 'failed',
      owner_invitation_last_error: normalizedMessage,
      owner_invitation_last_attempt_at: new Date().toISOString(),
    });

    await writeInviteAuditLog({
      organizationId: organization.id,
      eventType: 'org_invitation_failed_client',
      summary: `${source === 'create' ? 'Organization invitation failed' : 'Organization invitation resend failed'} for ${ownerAddress}`,
      metadata: {
        owner_email: ownerAddress,
        source,
        error: normalizedMessage,
      },
    });

    throw new Error(normalizedMessage);
  }

  return data;
}

async function getPlanAllocation(planKey) {
  const { data, error } = await supabase
    .from('organization_plans')
    .select('monthly_credit_allocation')
    .eq('plan_key', planKey)
    .maybeSingle();

  if (error) {
    if (!/permission denied|does not exist/i.test(error.message || '')) {
      console.warn('[orgAdminService] plan allocation lookup failed:', error.message);
    }
    return planKey === 'agency' ? 10000 : 2000;
  }

  return Number(data?.monthly_credit_allocation || (planKey === 'agency' ? 10000 : 2000));
}

async function ensureUniqueOrgSlug(preferredSlug) {
  const baseSlug = slugify(preferredSlug);
  const { data, error } = await supabase
    .from('organizations')
    .select('slug')
    .ilike('slug', `${baseSlug}%`);

  if (error) throw error;

  const existingSlugs = new Set((data || []).map((row) => row.slug).filter(Boolean));
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let attempt = 2;
  while (existingSlugs.has(`${baseSlug}-${attempt}`)) {
    attempt += 1;
  }

  return `${baseSlug}-${attempt}`;
}

async function fetchLatestOwnerInvitations(organizationIds = []) {
  if (!organizationIds.length) return new Map();

  const { data, error } = await supabase
    .from('org_invitations')
    .select(`
      id,
      organization_id,
      email,
      role,
      status,
      invitation_token,
      expires_at,
      created_at,
      accepted_at,
      requires_password_setup,
      invited_user_id
    `)
    .eq('role', 'org_owner')
    .in('organization_id', organizationIds)
    .order('created_at', { ascending: false });

  if (error) {
    if (!/permission denied|does not exist|column|relation/i.test(error.message || '')) {
      throw error;
    }
    return new Map();
  }

  const latestByOrg = new Map();
  for (const invitation of data || []) {
    if (!latestByOrg.has(invitation.organization_id)) {
      latestByOrg.set(invitation.organization_id, invitation);
    }
  }

  return latestByOrg;
}

export async function fetchAdminOrgs() {
  const { data: organizations, error: organizationsError } = await supabase
    .from('organizations')
    .select('id, name, slug, plan, plan_key, status, settings, created_at, owner_id, owner_user_id')
    .order('created_at', { ascending: false });

  if (organizationsError) throw organizationsError;

  const organizationRows = organizations || [];
  const organizationIds = organizationRows.map((row) => row.id);
  const ownerInvitationMap = await fetchLatestOwnerInvitations(organizationIds);

  const ownerIds = Array.from(
    new Set(
      organizationRows
        .map((row) => row.owner_id || row.owner_user_id || ownerInvitationMap.get(row.id)?.invited_user_id || null)
        .filter(Boolean),
    ),
  );

  let profileMap = new Map();
  if (ownerIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ownerIds);

    if (!profilesError) {
      profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }
  }

  return organizationRows.map((organization) => {
    const invitation = ownerInvitationMap.get(organization.id) || null;
    const settings = getOrganizationSettings(organization.settings);
    const ownerId = organization.owner_id || organization.owner_user_id || invitation?.invited_user_id || null;
    const ownerProfile = ownerId ? profileMap.get(ownerId) || null : null;
    const baseInvitationStatus = normalizeInvitationStatus(invitation);
    const invitationStatus = settings.owner_invitation_status === 'failed'
      ? 'failed'
      : baseInvitationStatus;
    const provisionSource = getProvisionSource(settings);

    return {
      ...organization,
      planKey: organization.plan_key || organization.plan || 'organization',
      ownerId,
      ownerEmail: invitation?.email || settings.pending_owner_email || ownerProfile?.email || null,
      ownerName: ownerProfile?.full_name || null,
      invitationId: invitation?.id || null,
      onboardingUrl: invitation?.invitation_token ? buildJoinUrl(invitation.invitation_token) : '',
      invitationStatus,
      invitationRequiresPasswordSetup: Boolean(invitation?.requires_password_setup),
      invitationExpiresAt: invitation?.expires_at || null,
      invitationAcceptedAt: invitation?.accepted_at || null,
      invitationLastError: settings.owner_invitation_last_error || null,
      provisionSource,
      provisioningStatus: settings.provisioning_status || null,
      provisioningLastError: settings.provisioning_last_error || null,
      signupRequestId: settings.signup_request_id || null,
    };
  });
}

export async function createOrganization({
  name,
  slug,
  planKey,
  ownerEmail,
}) {
  const organizationName = String(name || '').trim();
  const ownerAddress = String(ownerEmail || '').trim().toLowerCase();
  const normalizedPlanKey = String(planKey || 'organization').trim().toLowerCase();

  if (!organizationName) {
    throw new Error('Organization name is required.');
  }

  if (!ownerAddress) {
    throw new Error('Owner email is required.');
  }

  if (!['organization', 'agency'].includes(normalizedPlanKey)) {
    throw new Error('Select a valid organization plan.');
  }

  const uniqueSlug = await ensureUniqueOrgSlug(slug || organizationName);
  const monthlyCreditPool = await getPlanAllocation(normalizedPlanKey);

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .insert({
      name: organizationName,
      slug: uniqueSlug,
      plan: normalizedPlanKey,
      plan_key: normalizedPlanKey,
      status: 'active',
      monthly_credit_pool: monthlyCreditPool,
      credits_used_this_period: 0,
      settings: {
        pending_owner_email: ownerAddress,
        owner_invitation_status: 'creating',
        owner_invitation_last_error: null,
        owner_invitation_last_attempt_at: new Date().toISOString(),
      },
    })
    .select('id, name, slug, plan, plan_key, settings, status, created_at')
    .single();

  if (organizationError) throw organizationError;

  try {
    const invitation = await invokeOwnerInvite({
      organization: {
        ...organization,
        plan_key: normalizedPlanKey,
        plan: normalizedPlanKey,
      },
      ownerEmail: ownerAddress,
      source: 'create',
    });

    return {
      organizationId: organization.id,
      orgName: organization.name,
      slug: organization.slug,
      invitation,
    };
  } catch (inviteError) {
    return {
      organizationId: organization.id,
      orgName: organization.name,
      slug: organization.slug,
      invitation: null,
      warning: inviteError.message || 'Organization created, but the owner onboarding link could not be created.',
    };
  }
}

export async function sendOwnerInvitation({
  organizationId,
  ownerEmail = null,
}) {
  if (!organizationId) {
    throw new Error('Organization id is required.');
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name, slug, plan, plan_key, settings')
    .eq('id', organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) throw new Error('Organization not found.');

  const invitationMap = await fetchLatestOwnerInvitations([organizationId]);
  const latestInvitation = invitationMap.get(organizationId) || null;
  const organizationSettings = getOrganizationSettings(organization.settings);
  const nextOwnerEmail = String(
    ownerEmail
    || latestInvitation?.email
    || organizationSettings.pending_owner_email
    || '',
  ).trim().toLowerCase();

  if (!nextOwnerEmail) {
    throw new Error('No owner email is recorded for this organization.');
  }

  return invokeOwnerInvite({
    organization,
    ownerEmail: nextOwnerEmail,
    source: 'resend',
  });
}

export async function resendInvitation(organizationId) {
  return sendOwnerInvitation({ organizationId });
}
