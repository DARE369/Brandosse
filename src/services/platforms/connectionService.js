import { supabase } from '../supabaseClient';
import { getUserOrgMemberships } from '../authService';
import { getPlatform } from './platformRegistry';
import {
  getConnectedAccountDisplayName,
  isConnectedAccountTerminal,
  normalizeConnectedAccountRow,
} from './platformUtils';

let providerPromise = null;

const CONNECTED_ACCOUNT_SAFE_SELECT = [
  'id',
  'user_id',
  'platform',
  'account_name',
  'account_id',
  'avatar_url',
  'created_at',
  'connection_status',
  'username',
  'profile_picture_url',
  'token_expires_at',
  'last_token_refresh',
  'scopes',
  'updated_at',
  'deleted_at',
  'scope',
  'organization_id',
  'brand_project_id',
  'display_name',
  'profile_type',
  'follower_count',
  'account_category',
  'is_mock',
  'provider',
  'last_token_refresh_at',
  'health_score',
  'consecutive_failure_count',
  'last_failure_at',
  'last_failure_reason',
  'last_successful_publish_at',
  'total_posts_published',
  'total_posts_scheduled',
  'granted_member_ids',
].join(', ');

async function getProvider() {
  if (!providerPromise) {
    providerPromise = import('./mockOAuthProvider.js');
  }
  return providerPromise;
}

function dedupeById(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row?.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeGrantedMemberIds(memberIds = []) {
  return [...new Set(
    (Array.isArray(memberIds) ? memberIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

async function getActorUserId(explicitUserId) {
  if (explicitUserId) return explicitUserId;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user?.id) {
    throw new Error('Not authenticated');
  }
  return data.user.id;
}

async function fetchAccountRow(accountId) {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeConnectedAccountRow(data) : null;
}

async function insertConnectionEvent(payload) {
  const { error } = await supabase
    .from('connection_events')
    .insert({
      connected_account_id: payload.connectedAccountId,
      user_id: payload.userId,
      organization_id: payload.organizationId || null,
      event_type: payload.eventType,
      platform: payload.platform,
      severity: payload.severity || 'info',
      message: payload.message || null,
      metadata: payload.metadata || {},
      is_simulated_failure: Boolean(payload.isSimulatedFailure),
    });

  if (error) {
    throw error;
  }
}

async function upsertAccountRecord(params) {
  const {
    actorId,
    platform,
    scope,
    organizationId,
    brandProjectId,
    formData,
    providerResult,
  } = params;

  const basePayload = {
    user_id: actorId,
    platform,
    scope,
    organization_id: scope === 'organization' ? organizationId : null,
    brand_project_id: brandProjectId || null,
    account_name: providerResult.displayName,
    display_name: providerResult.displayName,
    account_id: providerResult.platformUserId,
    username: providerResult.username,
    avatar_url: providerResult.profilePictureUrl,
    profile_picture_url: providerResult.profilePictureUrl,
    access_token: providerResult.token,
    token_expires_at: providerResult.tokenExpiresAt,
    scopes: providerResult.scopes || [],
    connection_status: 'active',
    profile_type: providerResult.profileType || formData.profileType || 'Business',
    follower_count: Number(providerResult.followerCount || formData.followerCount || 0),
    account_category: providerResult.accountCategory || formData.accountCategory || null,
    is_mock: true,
    mock_token: providerResult.token,
    last_token_refresh: new Date().toISOString(),
    last_token_refresh_at: new Date().toISOString(),
    health_score: 100,
    consecutive_failure_count: 0,
    last_failure_at: null,
    last_failure_reason: null,
    platform_metadata: {
      ...(providerResult.metadata || {}),
      mock: true,
      source: 'mock_oauth_provider',
    },
  };

  let existingQuery = supabase
    .from('connected_accounts')
    .select('id, connection_status')
    .eq('user_id', actorId)
    .eq('platform', platform)
    .eq('scope', scope);

  if (scope === 'organization') {
    existingQuery = existingQuery.eq('organization_id', organizationId);
  } else {
    existingQuery = existingQuery.is('organization_id', null);
  }

  const { data: existingRows, error: existingError } = await existingQuery.order('created_at', { ascending: false }).limit(1);
  if (existingError) throw existingError;

  const existing = Array.isArray(existingRows) && existingRows[0] ? normalizeConnectedAccountRow(existingRows[0]) : null;

  if (existing && !isConnectedAccountTerminal(existing.connection_status)) {
    const { data, error } = await supabase
      .from('connected_accounts')
      .update(basePayload)
      .eq('id', existing.id)
      .select(CONNECTED_ACCOUNT_SAFE_SELECT)
      .single();

    if (error) throw error;
    return { row: normalizeConnectedAccountRow(data), eventType: 'reconnected' };
  }

  const { data, error } = await supabase
    .from('connected_accounts')
    .insert(basePayload)
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .single();

  if (error) throw error;
  return { row: normalizeConnectedAccountRow(data), eventType: 'connected' };
}

export async function connectAccount(params = {}) {
  const actorId = await getActorUserId(params.userId);
  const platform = String(params.platform || '').trim().toLowerCase();
  const scope = params.scope === 'organization' ? 'organization' : 'personal';
  const organizationId = params.organizationId || null;
  const brandProjectId = params.brandProjectId || null;
  const formData = params.formData || {};

  if (!platform) throw new Error('Platform is required');
  if (scope === 'organization' && !organizationId) {
    throw new Error('Organization accounts require an organization id');
  }

  const platformRecord = await getPlatform(platform);
  if (!platformRecord) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  if (platformRecord.is_active === false) {
    throw new Error(`${platformRecord.display_name} is coming soon`);
  }

  const provider = await getProvider();
  const providerResult = await provider.authenticate(platform, formData);
  if (!providerResult?.success) {
    throw new Error(providerResult?.message || 'Could not authenticate the account');
  }

  const { row, eventType } = await upsertAccountRecord({
    actorId,
    platform,
    scope,
    organizationId,
    brandProjectId,
    formData,
    providerResult,
  });

  await insertConnectionEvent({
    connectedAccountId: row.id,
    userId: actorId,
    organizationId: row.organization_id,
    platform,
    eventType,
    message: `${getConnectedAccountDisplayName(row)} connected to ${platformRecord.display_name}`,
    metadata: {
      scope,
      is_mock: true,
    },
  });

  return row;
}

export async function updateConnectedAccountDetails(accountId, updates = {}) {
  if (!accountId) throw new Error('Account id is required');

  const payload = {
    display_name: updates.displayName || updates.accountName || null,
    account_name: updates.displayName || updates.accountName || null,
    username: String(updates.username || '').trim().replace(/^@+/, '') || null,
    profile_type: updates.profileType || null,
    account_category: updates.accountCategory || null,
    profile_picture_url: updates.profilePictureUrl || null,
    avatar_url: updates.profilePictureUrl || null,
    follower_count: Number(updates.followerCount || 0),
  };

  const { data, error } = await supabase
    .from('connected_accounts')
    .update(payload)
    .eq('id', accountId)
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .single();

  if (error) throw error;
  return normalizeConnectedAccountRow(data);
}

export async function disconnectAccount(accountId, actorId) {
  const userId = await getActorUserId(actorId);
  const account = await fetchAccountRow(accountId);
  if (!account) throw new Error('Connected account not found');

  const { data, error } = await supabase
    .from('connected_accounts')
    .update({
      connection_status: 'revoked',
      access_token: null,
      mock_token: null,
      last_failure_reason: null,
    })
    .eq('id', accountId)
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .single();

  if (error) throw error;

  await insertConnectionEvent({
    connectedAccountId: accountId,
    userId,
    organizationId: account.organization_id,
    platform: account.platform,
    eventType: 'disconnected',
    severity: 'warning',
    message: `${getConnectedAccountDisplayName(account)} disconnected`,
    metadata: {
      scope: account.scope,
      is_mock: account.is_mock,
    },
  });

  return normalizeConnectedAccountRow(data);
}

export async function triggerReconnect(accountId, actorId) {
  const userId = await getActorUserId(actorId);
  const account = await fetchAccountRow(accountId);
  if (!account) throw new Error('Connected account not found');

  const { error: markError } = await supabase
    .from('connected_accounts')
    .update({ connection_status: 'reconnecting' })
    .eq('id', accountId);

  if (markError) throw markError;

  const provider = await getProvider();
  const refresh = await provider.refreshToken(account);
  if (!refresh?.success) {
    throw new Error(refresh?.message || 'Could not refresh this account');
  }

  const { data, error } = await supabase
    .from('connected_accounts')
    .update({
      access_token: refresh.token,
      mock_token: refresh.token,
      token_expires_at: refresh.tokenExpiresAt,
      connection_status: 'active',
      last_token_refresh: new Date().toISOString(),
      last_token_refresh_at: new Date().toISOString(),
      health_score: 100,
      consecutive_failure_count: 0,
      last_failure_at: null,
      last_failure_reason: null,
    })
    .eq('id', accountId)
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .single();

  if (error) throw error;

  await insertConnectionEvent({
    connectedAccountId: accountId,
    userId,
    organizationId: account.organization_id,
    platform: account.platform,
    eventType: 'reconnected',
    message: `${getConnectedAccountDisplayName(account)} reconnected`,
    metadata: {
      scope: account.scope,
      is_mock: account.is_mock,
    },
  });

  return normalizeConnectedAccountRow(data);
}

export async function getAccountsForUser(userId, scope = 'personal') {
  const activeUserId = await getActorUserId(userId);

  if (scope === 'organization') {
    const memberships = await getUserOrgMemberships(activeUserId);
    const organizationIds = memberships
      .map((membership) => membership.organizationId)
      .filter(Boolean);

    if (organizationIds.length === 0) return [];

    const { data, error } = await supabase
      .from('connected_accounts_health_summary')
      .select('*')
      .eq('scope', 'organization')
      .in('organization_id', organizationIds)
      .order('display_name', { ascending: true });

    if (error) throw error;
    return dedupeById((data || []).map(normalizeConnectedAccountRow).filter(Boolean));
  }

  if (scope === 'all') {
    const [personalRows, organizationRows] = await Promise.all([
      getAccountsForUser(activeUserId, 'personal'),
      getAccountsForUser(activeUserId, 'organization'),
    ]);

    return dedupeById([...personalRows, ...organizationRows]);
  }

  const { data, error } = await supabase
    .from('connected_accounts_health_summary')
    .select('*')
    .eq('scope', 'personal')
    .eq('user_id', activeUserId)
    .order('display_name', { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeConnectedAccountRow).filter(Boolean);
}

export async function getAccountsForOrganization(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('connected_accounts_health_summary')
    .select('*')
    .eq('scope', 'organization')
    .eq('organization_id', organizationId)
    .order('display_name', { ascending: true });

  if (error) throw error;
  return dedupeById((data || []).map(normalizeConnectedAccountRow).filter(Boolean));
}

export async function updateOrganizationAccountAccess(accountId, {
  grantAll = true,
  grantedMemberIds = [],
} = {}) {
  if (!accountId) throw new Error('Account id is required');

  const account = await fetchAccountRow(accountId);
  if (!account) throw new Error('Connected account not found');
  if (account.scope !== 'organization') {
    throw new Error('Only organization accounts support member access rules.');
  }

  const nextGrantedMemberIds = grantAll ? [] : normalizeGrantedMemberIds(grantedMemberIds);

  const { data, error } = await supabase
    .from('connected_accounts')
    .update({
      granted_member_ids: nextGrantedMemberIds,
    })
    .eq('id', accountId)
    .select(CONNECTED_ACCOUNT_SAFE_SELECT)
    .single();

  if (error) throw error;
  return normalizeConnectedAccountRow(data);
}

export async function getAccountHealth(accountId) {
  if (!accountId) throw new Error('Account id is required');

  const [{ data: account, error: accountError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from('connected_accounts_health_summary')
      .select('*')
      .eq('id', accountId)
      .maybeSingle(),
    supabase
      .from('connection_events')
      .select('*')
      .eq('connected_account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (accountError) throw accountError;
  if (eventsError) throw eventsError;
  if (!account) throw new Error('Connected account not found');

  return {
    account: normalizeConnectedAccountRow(account),
    events: Array.isArray(events) ? events : [],
  };
}

// =============================================================================
// Real OAuth flow (replaces mock when Zernio is configured)
// =============================================================================

/**
 * initiateOAuthConnection — smart OAuth router.
 *
 * If Zernio is configured (ZERNIO_API_KEY set):
 *   → redirects the browser to /api/auth/zernio/connect?platform=...
 *     (Zernio owns the OAuth exchange; browser returns to /api/auth/zernio/callback)
 *
 * If not (development, or org-scoped — Zernio is personal-only for now):
 *   → falls back to connectAccount() with mock data
 *
 * The Settings page calls this instead of MockOAuthService.connectMockAccount().
 */
export async function initiateOAuthConnection({
  platform,
  scope = 'personal',
  orgId = null,
  userId,
  formData = {},
  fallbackToMock = true,
} = {}) {
  // Org-scoped accounts aren't wired for Zernio yet (personal-only for this
  // pass), so those go straight to the mock fallback below.
  if (scope === 'personal') {
    const zernioCheckRes = await fetch('/api/auth/zernio/available').catch(() => null);
    const zernioAvailability = zernioCheckRes?.ok ? await zernioCheckRes.json().catch(() => ({})) : {};

    if (zernioAvailability?.available) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Sign in again before connecting a real platform account.');
      }

      const response = await fetch(`/api/auth/zernio/connect?platform=${encodeURIComponent(platform)}&format=json`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.url) {
        window.location.href = payload.url;
        return { redirecting: true };
      }
      // Fall through to direct-OAuth/mock if Zernio couldn't start the flow
      // (e.g. platform unsupported by Zernio) instead of hard-failing here.
    }
  }

  if (!fallbackToMock) {
    return {
      redirecting: false,
      realAvailable: false,
      reason: 'oauth_unavailable',
    };
  }

  // Fallback: use existing mock flow
  return connectAccount({ userId, platform, scope, organizationId: orgId, formData });
}
