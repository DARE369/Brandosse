/**
 * GET /api/auth/zernio/callback?platform=...&profileId=...
 *
 * Zernio owns the OAuth exchange itself (we never see platform access
 * tokens), so this route doesn't exchange a code — it just needs to find out
 * which account Zernio just connected.
 *
 * Zernio has (at least) two connect-redirect shapes, confirmed inconsistently
 * across its docs — treat both as possible and don't assume either is wrong:
 *   1. "Standard mode" (most platforms, incl. TikTok/X/Bluesky/etc — anything
 *      that doesn't need a secondary page/company pick): the redirect_url
 *      gets `?connected=<platform>&profileId=...&accountId=...&username=...`
 *      appended directly. No extra API call needed — fast path below.
 *   2. Page-selection platforms (Facebook/LinkedIn/Pinterest): the redirect
 *      carries `step=select_page&tempToken=...&userProfile=...` instead — the
 *      connection ISN'T finished yet, a follow-up call is needed to finalize
 *      the page choice. That finalize step isn't built yet (out of scope —
 *      this pass targets TikTok/personal single-account platforms). Surfaced
 *      as a distinct, clear error rather than silently mis-handled.
 * If neither shape shows up (e.g. Zernio changes its params), falls back to
 * listing all accounts under the profile (GET /accounts) and upserting
 * whatever's new for the requested platform — a defensive catch-all so a
 * doc/behavior mismatch doesn't hard-fail the connect.
 *
 * platform/profileId are read from our OWN redirect_url (see connect/route.js)
 * as the source of truth for which Brandosse user this belongs to; accountId/
 * username, when present, come from Zernio's redirect.
 *
 * On success: redirects to /app/settings?connected=<platform>
 * On failure:  redirects to /app/settings?error=oauth_failed&platform=<platform>
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const SUCCESS_URL = (platform) => `/app/settings?connected=${platform}`;
const FAILURE_URL = (platform, msg) => `/app/settings?error=oauth_failed&platform=${platform}&reason=${encodeURIComponent(msg)}`;

function zernioHeaders() {
  return {
    Authorization: `Bearer ${process.env.ZERNIO_API_KEY || ''}`,
    'Content-Type': 'application/json',
  };
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

async function listZernioAccounts(profileId) {
  const res = await fetch(`${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Zernio list accounts failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

async function upsertZernioAccount(supabase, { userId, platform, account }) {
  const displayName = account.displayName || account.username || platform;
  const payload = {
    user_id: userId,
    platform,
    scope: 'personal',
    organization_id: null,
    account_id: account._id,
    username: account.username || '',
    display_name: displayName,
    account_name: displayName,
    profile_picture_url: account.profilePicture || null,
    avatar_url: account.profilePicture || null,
    connection_status: 'active',
    is_mock: false,
    provider: 'zernio',
    health_score: 100,
    consecutive_failure_count: 0,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: lookupErr } = await supabase
    .from('connected_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('scope', 'personal')
    .eq('account_id', account._id)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  const { error: upsertErr } = existing?.id
    ? await supabase.from('connected_accounts').update(payload).eq('id', existing.id)
    : await supabase.from('connected_accounts').insert(payload);
  if (upsertErr) throw upsertErr;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform')?.toLowerCase();
  const profileId = searchParams.get('profileId');
  const zernioError = searchParams.get('error');
  const accountId = searchParams.get('accountId');
  const username = searchParams.get('username');
  const step = searchParams.get('step');

  if (zernioError) {
    return NextResponse.redirect(new URL(FAILURE_URL(platform || 'unknown', zernioError), request.url));
  }
  if (!platform || !profileId) {
    return NextResponse.redirect(new URL(FAILURE_URL(platform || 'unknown', 'missing_params'), request.url));
  }

  try {
    const supabase = createServiceClient();

    const { data: profileRow, error: profileErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('zernio_profile_id', profileId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profileRow?.id) throw new Error('unknown_zernio_profile');
    const userId = profileRow.id;

    if (step === 'select_page') {
      // Facebook/LinkedIn/Pinterest-style page-selection isn't wired yet —
      // fail loudly and specifically instead of pretending the account connected.
      throw new Error('page_selection_not_yet_supported');
    }

    if (accountId) {
      // Fast path — standard-mode redirect already told us which account.
      await upsertZernioAccount(supabase, {
        userId,
        platform,
        account: { _id: accountId, username: username || '' },
      });
      return NextResponse.redirect(new URL(SUCCESS_URL(platform), request.url));
    }

    // Fallback — list-and-diff against everything Zernio has for this profile.
    const zernioAccounts = (await listZernioAccounts(profileId))
      .filter((acc) => String(acc.platform || '').toLowerCase() === platform);
    if (zernioAccounts.length === 0) throw new Error('no_account_connected');

    const { data: existingRows, error: existingErr } = await supabase
      .from('connected_accounts')
      .select('account_id')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('scope', 'personal')
      .eq('provider', 'zernio');
    if (existingErr) throw existingErr;
    const existingIds = new Set((existingRows || []).map((row) => row.account_id));

    const newAccounts = zernioAccounts.filter((acc) => !existingIds.has(acc._id));
    // If nothing new showed up (e.g. the user re-authorized an account we
    // already track), treat it as success — reconnect, not a failure.
    const accountsToUpsert = newAccounts.length > 0 ? newAccounts : zernioAccounts;

    for (const account of accountsToUpsert) {
      await upsertZernioAccount(supabase, { userId, platform, account });
    }

    return NextResponse.redirect(new URL(SUCCESS_URL(platform), request.url));
  } catch (err) {
    console.error('[zernio/callback] error:', err);
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.redirect(new URL(FAILURE_URL(platform, msg), request.url));
  }
}
