/**
 * GET /api/auth/social/[provider]/connect
 *
 * Starts a direct per-platform OAuth flow. Replaces the Zernio connect path
 * for whichever platforms have been migrated (LinkedIn first; the rest follow
 * one at a time, so both paths coexist during the transition).
 *
 * Query:
 *   platform  required — the UI-level platform key (linkedin, facebook, ...).
 *                        Several platforms can share one provider: Instagram
 *                        and Facebook both authorize through Meta.
 *   returnTo  optional — where to land the user afterwards. Sanitised inside
 *                        createOAuthState; never trusted as given.
 *   scope     optional — 'personal' (default) or 'organization'.
 *   format    optional — 'json' returns { url } instead of a 302, so the SPA
 *                        can navigate itself. Mirrors the Zernio route's shape
 *                        because connectionService already speaks it.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * The user is authenticated HERE, and their verified id is baked into an
 * HMAC-signed state (LOCK L1.6). The callback derives identity from that state
 * and never from a query parameter. This is the defect that made the original
 * Zernio callback attachable to an arbitrary victim's workspace: because
 * connected_accounts is what the publisher dispatches to, an attacker who
 * could attach their own account to your workspace would receive your
 * scheduled content.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * A platform without credentials returns 503 with a machine-readable code.
 * It never falls through to a mock: a connect flow that appears to work and
 * yields an account that cannot publish is worse than a refusal, and this
 * codebase has shipped exactly that failure before (four `provider = 'direct'`
 * accounts rendering as green "Healthy" while being structurally incapable of
 * publishing — see 20260821220000).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createOAuthState } from '../../../../_lib/oauthState';
import {
  requireProvider,
  redirectUriFor,
  providerForPlatform,
} from '../../../../_lib/socialProviders';

function getAppUrl(request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

/**
 * Resolve the caller. Accepts a Bearer token (the SPA's fetch) or the session
 * cookie (a plain browser navigation) — both are real entry points here,
 * because the connect link is sometimes clicked and sometimes fetched.
 */
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
    || (request.headers.get('accept') || '').includes('application/json');
}

export async function GET(request, context) {
  const { searchParams } = new URL(request.url);
  const { provider: providerId } = await context.params;

  // The UI platform key drives scope selection; the provider in the path is
  // what the redirect URI was registered under. They differ for Meta, so both
  // are carried and cross-checked rather than assumed equal.
  const platform = (searchParams.get('platform') || providerId || '').toLowerCase();
  const scope = searchParams.get('scope') === 'organization' ? 'organization' : 'personal';
  const returnTo = searchParams.get('returnTo');

  const resolved = providerForPlatform(platform);
  if (!resolved) {
    return NextResponse.json(
      { error: 'unsupported_platform', platform },
      { status: 400 },
    );
  }
  if (resolved.id !== providerId) {
    // e.g. /api/auth/social/meta/connect?platform=linkedin — the redirect URI
    // registered for one provider would be used to authorize another. Refuse
    // rather than silently honouring whichever value happens to win.
    return NextResponse.json(
      { error: 'provider_platform_mismatch', provider: providerId, platform },
      { status: 400 },
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let providerConfig;
  try {
    providerConfig = requireProvider(platform);
  } catch (err) {
    return NextResponse.json(
      { error: 'app_not_configured', platform, detail: err.message },
      { status: 503 },
    );
  }

  try {
    const redirectUri = redirectUriFor(providerConfig.id, getAppUrl(request));

    const state = createOAuthState({
      userId: user.id,
      platform,
      scope,
      returnTo,
    });

    const params = new URLSearchParams({
      response_type: 'code',
      [providerConfig.clientIdParam || 'client_id']: providerConfig.clientId(),
      redirect_uri: redirectUri,
      state,
      scope: providerConfig.scopes.join(' '),
      ...(providerConfig.extraAuthParams || {}),
    });

    const authorizeUrl = `${providerConfig.authorizeUrl}?${params.toString()}`;

    return wantsJson(request, searchParams)
      ? NextResponse.json({ url: authorizeUrl, provider: providerConfig.id, platform })
      : NextResponse.redirect(authorizeUrl);
  } catch (err) {
    console.error(`[social/${providerId}/connect] error:`, err);
    return NextResponse.json(
      { error: 'connect_failed', detail: err?.message || 'Could not start the connect flow' },
      { status: 500 },
    );
  }
}
