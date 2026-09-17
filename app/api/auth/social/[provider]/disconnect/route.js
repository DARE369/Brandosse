/**
 * POST /api/auth/social/[provider]/disconnect
 *
 * Body: { accountId: "<connected_accounts.id>" }
 *
 * ── This is a HARD delete, deliberately ─────────────────────────────────────
 * LinkedIn API Terms §4.4: "You must immediately delete all Content collected
 * through the APIs on behalf of a User ... upon request by that User, or when
 * the User closes their account with you."
 *
 * A `deleted_at` soft delete does not satisfy that — the token and the profile
 * data would still exist. So the secret row and the account row are removed
 * outright.
 *
 * ── And it revokes at the platform, not just locally ────────────────────────
 * Deleting only our row leaves a live grant the user believes they cancelled.
 * That is a privacy claim we would be breaking, and it is invisible to them:
 * the app says "disconnected" while the authorization sits in their LinkedIn
 * settings indefinitely.
 *
 * Revocation is best-effort. If LinkedIn refuses or times out, local deletion
 * still proceeds and the response says so — refusing to disconnect because a
 * third party is unreachable would be the worse failure, and would also breach
 * the "immediately delete" obligation above.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * Revoke first, then delete. If we deleted first and the revoke then failed,
 * we would have destroyed the only copy of the token needed to revoke it —
 * leaving a live grant nobody can ever withdraw.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { providerForPlatform, PROVIDERS } from '../../../../_lib/socialProviders';
import { decryptToken } from '../../../../_lib/tokenCrypto';

const REVOKE_TIMEOUT_MS = 10_000;

/**
 * How each platform withdraws a grant. They do not agree on any of it — the
 * endpoint, the credentials, or even WHICH token to send — so the differences
 * live here rather than in branches inside the caller.
 *
 * `prefers` says which token actually ends the grant:
 *   'refresh' — Google. Revoking a refresh token kills the whole grant. The
 *               access token would work too, but it lives one hour, so on any
 *               account not used in the last hour it is already expired and
 *               revocation returns 400 invalid_token — a silent no-op that
 *               would leave the user's Google account still authorized while
 *               our UI said "disconnected".
 *   'access'  — LinkedIn, whose revoke endpoint takes the access token and the
 *               client credentials.
 *
 * Meta is a DELETE on /{user-id}/permissions rather than a token endpoint, and
 * is added with its adapter. An unlisted provider degrades to local-delete-only
 * rather than pretending it revoked anything.
 */
const REVOKE_ENDPOINTS = {
  linkedin: {
    url: 'https://www.linkedin.com/oauth/v2/revoke',
    prefers: 'access',
    body: (token, config) => ({
      token,
      client_id: config.clientId(),
      client_secret: config.clientSecret(),
    }),
  },
  youtube: {
    url: 'https://oauth2.googleapis.com/revoke',
    prefers: 'refresh',
    // Google identifies the grant from the token alone. Sending client
    // credentials it does not ask for is a secret transmitted for no reason.
    body: (token) => ({ token }),
  },
  tiktok: {
    // UNVERIFIED: taken from TikTok's documented revoke endpoint and never yet
    // exercised against a live account. It is wired anyway because the
    // alternative — no revocation at all — is the outcome we know is wrong, and
    // a rejected call is now logged with its status rather than swallowed.
    url: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    prefers: 'access',
    // client_key, not client_id. Same parameter-name difference that broke
    // every TikTok token exchange before it was found (registry: clientIdParam).
    body: (token, config) => ({
      client_key: config.clientId(),
      client_secret: config.clientSecret(),
      token,
    }),
  },
};

function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('missing_service_role_key');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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

/**
 * @param {{ access: string|null, refresh: string|null }} tokens
 */
async function revokeAtPlatform(providerId, tokens) {
  const spec = REVOKE_ENDPOINTS[providerId];
  if (!spec) return { attempted: false, revoked: false };

  // Fall back to the other token rather than skipping: a grant half-withdrawn
  // is the outcome this whole function exists to prevent.
  const token = spec.prefers === 'refresh'
    ? (tokens.refresh || tokens.access)
    : (tokens.access || tokens.refresh);

  if (!token) return { attempted: false, revoked: false };

  const config = PROVIDERS[providerId];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  try {
    const res = await fetch(spec.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(spec.body(token, config)).toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The status alone is the difference between "the platform refused" and
      // "we sent the wrong token", and without it a failed revoke is
      // indistinguishable from a network blip in the logs.
      const detail = await res.text().catch(() => '');
      console.error('[social/disconnect] revoke rejected:', providerId, res.status, detail.slice(0, 200));
    }
    return { attempted: true, revoked: res.ok };
  } catch (err) {
    console.error('[social/disconnect] revoke failed:', providerId, err?.message);
    return { attempted: true, revoked: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request, context) {
  const { provider: providerId } = await context.params;

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let accountId;
  try {
    ({ accountId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

  try {
    const supabase = createServiceClient();

    // Ownership is checked explicitly. This runs as service-role, which
    // bypasses RLS entirely — so the row-level protection that would normally
    // apply is simply absent here and has to be re-imposed by hand.
    const { data: account, error: readErr } = await supabase
      .from('connected_accounts')
      .select('id, user_id, platform, display_name, account_name')
      .eq('id', accountId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!account) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (account.user_id !== user.id) {
      // 404 rather than 403: confirming the row exists would tell a caller
      // they had found somebody else's account id.
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const resolved = providerForPlatform(account.platform);

    // ── 1. Revoke at the platform, while we still hold the token ────────────
    let revocation = { attempted: false, revoked: false };
    const { data: secret } = await supabase
      .from('connected_account_secrets')
      .select('access_token_ciphertext, refresh_token_ciphertext')
      .eq('connected_account_id', accountId)
      .maybeSingle();

    if (resolved && (secret?.access_token_ciphertext || secret?.refresh_token_ciphertext)) {
      // Each token is decrypted independently: one being unreadable must not
      // cost us the other, which may be the one that actually ends the grant.
      const tokens = { access: null, refresh: null };
      for (const [field, column] of [['access', 'access_token_ciphertext'], ['refresh', 'refresh_token_ciphertext']]) {
        if (!secret[column]) continue;
        try {
          tokens[field] = await decryptToken(secret[column]);
        } catch (err) {
          // An undecryptable token cannot be revoked, but must still be deleted.
          console.error(`[social/disconnect] could not decrypt ${field} token for revoke:`, err.message);
        }
      }
      revocation = await revokeAtPlatform(resolved.id, tokens);
    }

    // ── 2. Delete the secret ────────────────────────────────────────────────
    // Explicit, even though the FK cascades, so that a failure here surfaces
    // rather than being assumed. This row is the whole point of the deletion.
    const { error: secretDelErr } = await supabase
      .from('connected_account_secrets')
      .delete()
      .eq('connected_account_id', accountId);
    if (secretDelErr) throw secretDelErr;

    // ── 3. Delete the account row ───────────────────────────────────────────
    const { error: accountDelErr } = await supabase
      .from('connected_accounts')
      .delete()
      .eq('id', accountId)
      .eq('user_id', user.id);
    if (accountDelErr) throw accountDelErr;

    // ── 4. Leave an audit trail that names no secret ────────────────────────
    // connection_events cascades from connected_accounts, so the history is
    // gone with the row. That is the correct outcome under §4.4 — it is the
    // user's data — and it is why this log line exists instead.
    console.info('[social/disconnect]', JSON.stringify({
      platform: account.platform,
      revoke_attempted: revocation.attempted,
      revoke_succeeded: revocation.revoked,
    }));

    return NextResponse.json({
      success: true,
      platform: account.platform,
      revokedAtPlatform: revocation.revoked,
      // Surfaced honestly, and it has to name the two cases separately:
      // "we tried and it refused" leaves a live grant the user should go and
      // remove themselves, while "we never tried" (no revoke endpoint for this
      // provider yet) is our gap, not theirs.
      note: revocation.attempted && !revocation.revoked
        ? 'Disconnected here. We could not confirm revocation with the platform — '
          + 'you can remove the app in your platform settings to be certain.'
        : null,
    });
  } catch (err) {
    console.error(`[social/${providerId}/disconnect] error:`, err?.message);
    return NextResponse.json(
      { error: 'disconnect_failed', detail: err?.message || 'Could not disconnect' },
      { status: 500 },
    );
  }
}
