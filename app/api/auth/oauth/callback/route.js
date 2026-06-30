/**
 * GET /api/auth/oauth/callback?code=...&state=...
 *
 * Receives the authorization code from every platform.
 * Exchanges it for access + refresh tokens, fetches the user's platform profile,
 * and upserts a row into connected_accounts.
 *
 * On success: redirects to /app/settings?connected=<platform>
 * On failure:  redirects to /app/settings?error=oauth_failed&platform=<platform>
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const SUCCESS_URL  = (platform) => `/app/settings?connected=${platform}`;
const FAILURE_URL  = (platform, msg) => `/app/settings?error=oauth_failed&platform=${platform}&reason=${encodeURIComponent(msg)}`;

function getAppUrl(request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function getRedirectUri(request) {
  return `${getAppUrl(request)}/api/auth/oauth/callback`;
}

function getStateSecret() {
  // OAUTH_STATE_SECRET is the only accepted signing secret. Never fall back to
  // SUPABASE_SERVICE_ROLE_KEY — that would let a service-role leak forge OAuth state.
  return process.env.OAUTH_STATE_SECRET || '';
}

function verifyState(state) {
  const secret = getStateSecret();
  if (!secret) throw new Error('missing_state_secret');

  const [encodedPayload, signature] = String(state || '').split('.');
  if (!encodedPayload || !signature) throw new Error('invalid_state');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('invalid_state_signature');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
  if (!payload?.user_id || !payload?.platform) throw new Error('invalid_state_payload');
  if (Number(payload.exp || 0) < Date.now()) throw new Error('expired_state');
  return payload;
}

function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('missing_service_role_key');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function requireActiveOrgMember(supabase, userId, orgId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('forbidden_org');
}

// ── Token exchange functions ────────────────────────────────────────────────

async function exchangeInstagram(code, redirectUri) {
  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.INSTAGRAM_APP_ID || '',
      client_secret: process.env.INSTAGRAM_APP_SECRET || '',
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Instagram token exchange failed: ${res.status}`);
  const data = await res.json();

  // Exchange short-lived for long-lived token
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${data.access_token}`,
  );
  const longData = longRes.ok ? await longRes.json() : data;

  // Get profile
  const profileRes = await fetch(
    `https://graph.instagram.com/me?fields=id,username,account_type,profile_picture_url&access_token=${longData.access_token || data.access_token}`,
  );
  const profile = profileRes.ok ? await profileRes.json() : {};

  return {
    accessToken:    longData.access_token || data.access_token,
    refreshToken:   null,
    expiresAt:      longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000).toISOString() : null,
    accountId:      String(data.user_id || profile.id || ''),
    username:       profile.username || '',
    profilePicture: profile.profile_picture_url || null,
    scopes:         ['instagram_basic', 'instagram_content_publish'],
  };
}

async function exchangeLinkedIn(code, redirectUri) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     process.env.LINKEDIN_CLIENT_ID || '',
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status}`);
  const data = await res.json();

  const profileRes = await fetch('https://api.linkedin.com/v2/me', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};
  const name = [profile.localizedFirstName, profile.localizedLastName].filter(Boolean).join(' ');

  return {
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token || null,
    expiresAt:      data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    accountId:      profile.id || '',
    username:       name || profile.id || '',
    profilePicture: null,
    scopes:         ['r_liteprofile', 'w_member_social'],
  };
}

async function exchangeX(code, verifier, redirectUri) {
  const credentials = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`X token exchange failed: ${res.status}`);
  const data = await res.json();

  const profileRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = profileRes.ok ? (await profileRes.json()).data : {};

  return {
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token || null,
    expiresAt:      data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    accountId:      profile.id || '',
    username:       profile.username || '',
    profilePicture: profile.profile_image_url || null,
    scopes:         (data.scope || '').split(' '),
  };
}

async function exchangeTikTok(code, redirectUri) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY || '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${res.status}`);
  const data = await res.json();

  return {
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token || null,
    expiresAt:      data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    accountId:      data.open_id || '',
    username:       '',
    profilePicture: null,
    scopes:         (data.scope || '').split(','),
  };
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(FAILURE_URL('unknown', error), request.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(FAILURE_URL('unknown', 'missing_params'), request.url));
  }

  // Decode state
  let stateData;
  try {
    stateData = verifyState(state);
  } catch (stateError) {
    return NextResponse.redirect(new URL(FAILURE_URL('unknown', stateError?.message || 'invalid_state'), request.url));
  }

  const { user_id, platform } = stateData;
  const scope = stateData.scope === 'organization' ? 'organization' : 'personal';
  const org_id = scope === 'organization' ? stateData.org_id : null;

  const cookieStore = await cookies();
  const supabase = createServiceClient();
  const redirectUri = getRedirectUri(request);

  try {
    if (scope === 'organization') {
      if (!org_id) throw new Error('missing_org_id');
      await requireActiveOrgMember(supabase, user_id, org_id);
    }

    let tokenData;
    switch (platform) {
      case 'instagram':
      case 'facebook':
        tokenData = await exchangeInstagram(code, redirectUri);
        break;
      case 'linkedin':
        tokenData = await exchangeLinkedIn(code, redirectUri);
        break;
      case 'x':
      case 'twitter': {
        const verifier = cookieStore.get('x_pkce_verifier')?.value || '';
        tokenData = await exchangeX(code, verifier, redirectUri);
        break;
      }
      case 'tiktok':
        tokenData = await exchangeTikTok(code, redirectUri);
        break;
      default:
        return NextResponse.redirect(new URL(FAILURE_URL(platform, 'unsupported_platform'), request.url));
    }

    const accountPayload = {
      user_id,
      platform,
      scope,
      organization_id:    org_id,
      account_id:         tokenData.accountId,
      username:           tokenData.username,
      display_name:       tokenData.username,
      account_name:       tokenData.username,
      profile_picture_url: tokenData.profilePicture,
      avatar_url:         tokenData.profilePicture,
      access_token:       tokenData.accessToken,
      refresh_token:      tokenData.refreshToken,
      token_expires_at:   tokenData.expiresAt,
      scopes:             tokenData.scopes,
      connection_status:  'active',
      is_mock:            false,
      health_score:       100,
      consecutive_failure_count: 0,
      updated_at:         new Date().toISOString(),
    };

    let existingQuery = supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', user_id)
      .eq('platform', platform)
      .eq('scope', scope);

    existingQuery = org_id
      ? existingQuery.eq('organization_id', org_id)
      : existingQuery.is('organization_id', null);

    const { data: existingAccount, error: lookupErr } = await existingQuery.maybeSingle();
    if (lookupErr) throw lookupErr;

    const { error: upsertErr } = existingAccount?.id
      ? await supabase
        .from('connected_accounts')
        .update(accountPayload)
        .eq('id', existingAccount.id)
      : await supabase
        .from('connected_accounts')
        .insert(accountPayload);

    if (upsertErr) {
      console.error('[oauth/callback] upsert error:', upsertErr);
      return NextResponse.redirect(new URL(FAILURE_URL(platform, 'db_error'), request.url));
    }

    const response = NextResponse.redirect(new URL(SUCCESS_URL(platform), request.url));
    // Clear PKCE verifier cookie
    response.cookies.delete('x_pkce_verifier');
    return response;

  } catch (err) {
    console.error('[oauth/callback] error:', err);
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.redirect(new URL(FAILURE_URL(platform, msg), request.url));
  }
}
