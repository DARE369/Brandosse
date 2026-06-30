/**
 * GET /api/auth/oauth?platform=instagram&scope=personal
 *
 * Builds and returns the OAuth authorization URL for the requested platform.
 * The browser redirects the user there; the platform then redirects to /api/auth/oauth/callback.
 *
 * Required env vars per platform (set in .env.local + Supabase secrets):
 *   Instagram : INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET
 *   LinkedIn  : LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 *   X         : X_CLIENT_ID, X_CLIENT_SECRET
 *   TikTok    : TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const PLATFORM_CREDENTIAL_MAP = {
  instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook:  ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  linkedin:  ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  x:         ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  twitter:   ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok:    ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
};

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

function signState(payload) {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error('OAuth state signing secret is not configured');
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function hasPlatformCredentials(platform) {
  const requiredKeys = PLATFORM_CREDENTIAL_MAP[platform] || [];
  return requiredKeys.length > 0 && requiredKeys.every((key) => Boolean(process.env[key]));
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

function buildInstagramUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id:     process.env.INSTAGRAM_APP_ID || '',
    redirect_uri:  redirectUri,
    scope:         'instagram_basic,instagram_content_publish,pages_read_engagement',
    response_type: 'code',
    state,
  });
  return `https://api.instagram.com/oauth/authorize?${params}`;
}

function buildLinkedInUrl(state, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.LINKEDIN_CLIENT_ID || '',
    redirect_uri:  redirectUri,
    state,
    scope:         'r_liteprofile,w_member_social,r_emailaddress',
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

function buildXUrl(state, codeChallenge, redirectUri) {
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.X_CLIENT_ID || '',
    redirect_uri:          redirectUri,
    scope:                 'tweet.write tweet.read users.read offline.access',
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

function buildTikTokUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_key:    process.env.TIKTOK_CLIENT_KEY || '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'video.upload,video.publish,user.info.basic',
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize?${params}`;
}

async function getRequestUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authHeader } },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { get: (name) => cookieStore.get(name)?.value } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

function wantsJson(request, searchParams) {
  return searchParams.get('format') === 'json'
    || request.headers.get('accept')?.includes('application/json');
}

function authResponse(authUrl, request, searchParams) {
  if (wantsJson(request, searchParams)) {
    return NextResponse.json({ url: authUrl });
  }

  return NextResponse.redirect(authUrl);
}

async function requireActiveOrgMember(userId, orgId) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    const err = new Error('forbidden_org');
    err.statusCode = 403;
    throw err;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform')?.toLowerCase();
  const scope    = searchParams.get('scope') === 'organization' ? 'organization' : 'personal';
  const orgId    = searchParams.get('org_id') || null;

  if (!platform) {
    return NextResponse.json({ error: 'platform is required' }, { status: 400 });
  }
  if (!hasPlatformCredentials(platform)) {
    return NextResponse.json({ error: `Platform "${platform}" is not configured` }, { status: 503 });
  }

  // Auth guard
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (scope === 'organization') {
    if (!orgId) {
      return NextResponse.json({ error: 'org_id is required for organization OAuth' }, { status: 400 });
    }

    try {
      await requireActiveOrgMember(user.id, orgId);
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      return NextResponse.json(
        { error: status === 403 ? 'Forbidden' : error?.message || 'Could not verify organization access' },
        { status },
      );
    }
  }

  // CSRF state: encodes user_id + platform + scope + org_id
  const statePayload = signState({
    user_id:  user.id,
    platform,
    scope,
    org_id:   scope === 'organization' ? orgId : null,
    nonce:    crypto.randomBytes(16).toString('hex'),
    exp:      Date.now() + 10 * 60 * 1000,
  });
  const redirectUri = getRedirectUri(request);

  let authUrl;
  switch (platform) {
    case 'instagram':
    case 'facebook':
      authUrl = buildInstagramUrl(statePayload, redirectUri);
      break;
    case 'linkedin':
      authUrl = buildLinkedInUrl(statePayload, redirectUri);
      break;
    case 'x':
    case 'twitter': {
      // PKCE for X
      const verifier  = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      // Store verifier in a short-lived cookie
      const authUrlWithChallenge = buildXUrl(statePayload, challenge, redirectUri);
      const response = wantsJson(request, searchParams)
        ? NextResponse.json({ url: authUrlWithChallenge })
        : NextResponse.redirect(authUrlWithChallenge);
      response.cookies.set('x_pkce_verifier', verifier, { httpOnly: true, maxAge: 600, sameSite: 'lax' });
      return response;
    }
    case 'tiktok':
      authUrl = buildTikTokUrl(statePayload, redirectUri);
      break;
    default:
      return NextResponse.json({ error: `Platform "${platform}" is not supported` }, { status: 400 });
  }

  return authResponse(authUrl, request, searchParams);
}
