/**
 * GET /api/auth/social/[provider]/callback
 *
 * Completes a direct OAuth flow: verify state → exchange code → discover the
 * account → store an ENCRYPTED token → bounce the user back where they started.
 *
 * ── Identity comes from the signed state, never the query ───────────────────
 * LOCK L1.6. The Zernio callback used to decide WHICH user an incoming account
 * belonged to by reading an unsigned query parameter, with no session check.
 * Because connected_accounts is what the publisher dispatches to, anyone who
 * could induce a victim to load that URL could attach an account they control
 * to the victim's workspace — and then receive the victim's scheduled content.
 *
 * ── No half-connected rows, ever ────────────────────────────────────────────
 * "My account shows as connected but nothing publishes" is this repository's
 * signature defect (four `provider='direct'` rows rendering green "Healthy"
 * while structurally unable to publish — 20260821220000). So the account row
 * and its secret are written as a pair, and a failure on the second deletes
 * the first. A user who fails here has exactly nothing left behind.
 *
 * ── Every outbound call has a timeout ───────────────────────────────────────
 * Non-negotiable in CLAUDE.md, and earned: zernio.service.ts shipped four
 * outbound calls with zero timeouts, and 20 posts sat frozen in `publishing`
 * for four months as a direct result (20260821160000).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyOAuthState, DEFAULT_RETURN_TO } from '../../../../_lib/oauthState';
import { requireProvider, redirectUriFor } from '../../../../_lib/socialProviders';
import { encryptToken } from '../../../../_lib/tokenCrypto';

const OUTBOUND_TIMEOUT_MS = 15_000;

function getAppUrl(request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('missing_service_role_key');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** fetch with a hard deadline. A hung provider must fail, not hang the request. */
async function fetchWithTimeout(url, init = {}, ms = OUTBOUND_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('platform_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a usable message from anything that gets thrown.
 *
 * Supabase does NOT throw Error instances. A PostgrestError is a plain object
 * — { code, message, details, hint } — so `err instanceof Error` is false for
 * every database failure in this file.
 *
 * That mattered: a constraint violation on the final insert produced
 * "unknown_error" in the log and a bare `connect_failed` in the URL, with the
 * actual cause ("violates check constraint
 * connected_accounts_provider_check") discarded. The bug was diagnosable only
 * by reproducing the insert by hand against the database.
 *
 * Anything that carries a `message` string is treated as reportable.
 */
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof err.message === 'string') return err.message;
  if (typeof err === 'string') return err;
  return 'unknown_error';
}

/** Land the user back where they started, with a machine-readable outcome. */
function bounce(request, returnTo, params) {
  const base = returnTo && returnTo.startsWith('/') ? returnTo : DEFAULT_RETURN_TO;
  const url = new URL(base, getAppUrl(request));
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  return NextResponse.redirect(url);
}

/**
 * Map a platform-side `error` parameter onto our own taxonomy, so the UI can
 * render a specific cause and a specific fix rather than "something went wrong".
 */
function mapProviderError(err, desc) {
  const e = String(err || '').toLowerCase();
  if (e === 'access_denied' || e === 'user_cancelled_login' || e === 'user_cancelled_authorize') {
    return 'user_denied';
  }
  if (e.includes('unauthorized_scope') || e.includes('invalid_scope')) return 'missing_scopes';
  if (e.includes('temporarily_unavailable') || e.includes('server_error')) return 'platform_unavailable';
  return desc ? `provider_error:${e}` : `provider_error:${e || 'unknown'}`;
}

// ── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCode(providerConfig, code, redirectUri) {
  // clientIdParam, not a hardcoded `client_id`. TikTok names the credential
  // `client_key` on the token endpoint as well as the authorize endpoint, and
  // sending the wrong parameter name yields an opaque error that reads like a
  // bad secret. connect/route.js already honours this; this side did not, so
  // TikTok cleared the consent screen and then failed the exchange every time.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    [providerConfig.clientIdParam || 'client_id']: providerConfig.clientId(),
    client_secret: providerConfig.clientSecret(),
  });

  const res = await fetchWithTimeout(providerConfig.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!res.ok || !json?.access_token) {
    // The response body can contain the client secret echoed back in some
    // error shapes, so only the provider's error CODE is surfaced.
    const code_ = json?.error || `http_${res.status}`;
    throw new Error(`token_exchange_failed:${code_}`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresInSeconds: Number(json.expires_in) || null,
    grantedScopes: typeof json.scope === 'string' ? json.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

// ── Per-provider account discovery ───────────────────────────────────────────

/**
 * LinkedIn: the member themself is the only postable account.
 *
 * Company Pages would need the Community Management API, which this app has
 * not been granted — so there is genuinely one account here and no picker step
 * is required. When Community Management lands, this returns several and the
 * sub-account selection screen becomes reachable.
 *
 * `sub` from the OIDC userinfo endpoint is the person id; the author URN the
 * Posts API expects is `urn:li:person:{sub}`.
 */
async function discoverLinkedIn(accessToken) {
  const res = await fetchWithTimeout('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('missing_scopes');
    throw new Error(`discovery_failed:http_${res.status}`);
  }
  const me = await res.json();
  if (!me?.sub) throw new Error('discovery_failed:no_subject');

  return [{
    accountId: me.sub,
    authorUrn: `urn:li:person:${me.sub}`,
    username: me.email || me.name || me.sub,
    displayName: me.name || me.email || 'LinkedIn member',
    avatarUrl: me.picture || null,
    profileType: 'Personal',
  }];
}

/**
 * TikTok: exactly one postable account per authorization — the creator
 * themself. No sub-account picker, and none possible.
 *
 * The open_id is the stable per-app identifier. It is deliberately NOT the
 * username: TikTok usernames are changeable, so keying on one would orphan the
 * connection the first time a user renames themself.
 */
async function discoverTikTok(accessToken) {
  const res = await fetchWithTimeout(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  const body = await res.json().catch(() => null);

  // TikTok returns HTTP 200 for real failures, with the code in the body —
  // checking res.ok alone would treat a scope refusal as a healthy response.
  const code = body?.error?.code;
  if (!res.ok || (code && code !== 'ok')) {
    if (code === 'scope_not_authorized' || res.status === 401) throw new Error('missing_scopes');
    throw new Error(`discovery_failed:${code || `http_${res.status}`}`);
  }

  const u = body?.data?.user || {};
  if (!u.open_id) throw new Error('discovery_failed:no_open_id');

  return [{
    accountId: u.open_id,
    authorUrn: null,          // TikTok addresses the creator by token, not URN
    username: u.display_name || u.open_id,
    displayName: u.display_name || 'TikTok account',
    avatarUrl: u.avatar_url || null,
    profileType: 'Creator',
  }];
}

const DISCOVERY = { linkedin: discoverLinkedIn, tiktok: discoverTikTok };

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Write the account and its secret as a pair, rolling back the account if the
 * secret cannot be stored. Postgres has no cross-statement transaction over
 * PostgREST, so the compensation is explicit.
 */
async function persistAccount(supabase, { userId, platform, scope, account, token }) {
  const now = new Date().toISOString();
  const expiresAt = token.expiresInSeconds
    ? new Date(Date.now() + token.expiresInSeconds * 1000).toISOString()
    : null;

  const row = {
    user_id: userId,
    platform,
    scope,
    organization_id: null,
    account_id: account.accountId,
    username: account.username || '',
    display_name: account.displayName,
    account_name: account.displayName,
    profile_picture_url: account.avatarUrl,
    avatar_url: account.avatarUrl,
    profile_type: account.profileType || 'Personal',
    connection_status: 'active',
    is_mock: false,
    provider: platform,
    health_score: 100,
    consecutive_failure_count: 0,
    last_failure_reason: null,
    token_expires_at: expiresAt,
    scopes: token.grantedScopes,
    platform_metadata: { author_urn: account.authorUrn },
    updated_at: now,
  };

  const { data: existing, error: lookupErr } = await supabase
    .from('connected_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('scope', scope)
    .eq('account_id', account.accountId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  let accountRowId = existing?.id || null;
  const isNew = !accountRowId;

  if (accountRowId) {
    const { error } = await supabase.from('connected_accounts').update(row).eq('id', accountRowId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('connected_accounts').insert(row).select('id').single();
    if (error) throw error;
    accountRowId = data.id;
  }

  try {
    const secret = {
      connected_account_id: accountRowId,
      access_token_ciphertext: await encryptToken(token.accessToken),
      refresh_token_ciphertext: token.refreshToken ? await encryptToken(token.refreshToken) : null,
      expires_at: expiresAt,
      // Refresh at 80% of life, so a failure still leaves room to retry before
      // the user is locked out. LinkedIn issues no refresh token on the standard
      // tier, so for LinkedIn this is when we start warning, not refreshing.
      refresh_after: token.expiresInSeconds
        ? new Date(Date.now() + token.expiresInSeconds * 800).toISOString()
        : null,
      granted_scopes: token.grantedScopes,
      refresh_failures: 0,
      last_refresh_error: null,
      updated_at: now,
    };

    const { error } = await supabase
      .from('connected_account_secrets')
      .upsert(secret, { onConflict: 'connected_account_id' });
    if (error) throw error;
  } catch (err) {
    // Compensate: an account row with no secret is an account that renders as
    // connected and can never publish. Only remove what THIS request created —
    // a pre-existing account keeps its working secret.
    if (isNew) {
      await supabase.from('connected_accounts').delete().eq('id', accountRowId);
    }
    throw err;
  }

  return { accountRowId, isNew };
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(request, context) {
  const { searchParams } = new URL(request.url);
  const { provider: providerId } = await context.params;

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerErr = searchParams.get('error');
  const providerErrDesc = searchParams.get('error_description');

  // A plain refusal is reported as a refusal, even when the state cannot be
  // verified.
  //
  // Ordering matters here. State is checked first for everything else, because
  // identity and the redirect target both come out of it. But if the provider
  // has told us the user declined, there is no account to attach, no token to
  // exchange, and nothing to protect — so answering "we couldn't verify that
  // request" would be both frightening and untrue. The realistic path to this
  // branch is a user who left the consent screen open past the 10-minute state
  // TTL and then pressed Cancel.
  //
  // Safe because it bounces to the DEFAULT path, never to an unverified
  // returnTo — an unsigned redirect target is the open-redirect this file's
  // whole design exists to prevent.
  if (providerErr && !state) {
    return bounce(request, DEFAULT_RETURN_TO, {
      social_error: mapProviderError(providerErr, providerErrDesc),
      platform: providerId,
    });
  }

  // Identity and destination both come out of the signed state. If it does not
  // verify we cannot know who this is, so there is nowhere safe to send them
  // except the default.
  let verified = null;
  try {
    verified = verifyOAuthState(state);
  } catch (err) {
    // Same reasoning as above: a declined authorization outranks an unusable
    // state, because the user's own action explains the outcome completely.
    if (providerErr) {
      return bounce(request, DEFAULT_RETURN_TO, {
        social_error: mapProviderError(providerErr, providerErrDesc),
        platform: providerId,
      });
    }
    console.error(`[social/${providerId}/callback] state rejected:`, err.message);
    return bounce(request, DEFAULT_RETURN_TO, {
      social_error: err.message === 'oauth_state_expired' ? 'oauth_state_expired' : 'oauth_state_bad_signature',
      platform: providerId,
    });
  }

  const { uid: userId, platform, scope, rt: returnTo } = verified;

  // The user declined, or the provider refused before we ever saw a code.
  if (providerErr) {
    return bounce(request, returnTo, {
      social_error: mapProviderError(providerErr, providerErrDesc),
      platform,
    });
  }
  if (!code) {
    return bounce(request, returnTo, { social_error: 'missing_code', platform });
  }

  try {
    const providerConfig = requireProvider(platform);
    const redirectUri = redirectUriFor(providerConfig.id, getAppUrl(request));

    const token = await exchangeCode(providerConfig, code, redirectUri);

    const discover = DISCOVERY[platform];
    if (!discover) throw new Error(`discovery_unimplemented:${platform}`);
    const accounts = await discover(token.accessToken);

    if (!accounts.length) {
      return bounce(request, returnTo, { social_error: 'no_eligible_targets', platform });
    }

    // Single-account providers complete here. Multi-account providers (Meta,
    // and LinkedIn once Community Management is granted) will stop at a
    // selection step instead — nothing is written until the user confirms.
    const supabase = createServiceClient();
    const { isNew } = await persistAccount(supabase, {
      userId, platform, scope, account: accounts[0], token,
    });

    return bounce(request, returnTo, {
      connected: platform,
      account: accounts[0].displayName,
      is_new: isNew ? '1' : '0',
    });
  } catch (err) {
    const message = errorMessage(err);
    // Log the whole object, not just the message: PostgrestError carries the
    // SQLSTATE code and constraint name on sibling fields, and those are what
    // actually identify a schema-level rejection.
    console.error(`[social/${providerId}/callback] error:`, message, {
      code: err?.code ?? null,
      hint: err?.hint ?? null,
    });

    // ── Classify the failure ─────────────────────────────────────────────────
    //
    // A database rejection gets its own code. It is OUR schema refusing the
    // write, not the platform failing and not the user doing anything wrong —
    // reporting it as a generic "connect failed" sends whoever is debugging to
    // look at LinkedIn, which is the wrong place entirely.
    //
    // The SQLSTATE also becomes a safe diagnostic that travels back in the URL
    // (see `detail` below), so the same value is read once here and used for
    // both purposes.
    const pgCode = typeof err?.code === 'string' ? err.code : null;
    const isDbRejection = Boolean(pgCode)
      && ['23514', '23503', '23505', '23502', '42501'].includes(pgCode);

    const social_error =
      message === 'platform_timeout' ? 'connect_timed_out'
        : message === 'missing_scopes' ? 'missing_scopes'
          : message.startsWith('token_exchange_failed') ? 'token_exchange_failed'
            : message.startsWith('discovery_failed') ? 'discovery_failed'
              : message.startsWith('app_not_configured') ? 'app_not_configured'
                : isDbRejection ? 'account_save_rejected'
                  : 'connect_failed';

    // ── Carry a SAFE diagnostic back to the browser ──────────────────────────
    //
    // `connect_failed` on its own is nearly useless: it means "something we did
    // not anticipate", which is exactly the case where the detail matters most.
    // A real failure here — a schema constraint rejecting the insert — was
    // invisible to both the user and the developer, and could only be found by
    // reproducing the insert against the database by hand.
    //
    // Deliberately NOT included: PostgREST's `details`, which for a constraint
    // violation contains the ENTIRE failing row. That row holds account
    // identifiers and would end up in browser history, server access logs and
    // any error reporter. The SQLSTATE code and the constraint name identify
    // the fault completely and say nothing about the user.
    let detail = null;
    if (pgCode && /^[0-9A-Z]{5}$/.test(pgCode)) {
      const constraint = /constraint "([A-Za-z0-9_]+)"/.exec(errorMessage(err))?.[1];
      detail = constraint ? `${pgCode}:${constraint}` : pgCode;
    }

    return bounce(request, returnTo, { social_error, platform, detail });
  }
}
