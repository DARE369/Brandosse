/**
 * GET /api/social/tiktok/creator-info?accountId=<connected_accounts.id>
 *
 * Fetches the live creator settings that the TikTok compose panel renders from.
 *
 * ── Why this is a server route and not a client fetch ───────────────────────
 * It needs the decrypted access token, which lives in connected_account_secrets
 * — a table with no grant to `authenticated` at all (defect D1, migration
 * 20260904120000). The browser cannot reach it and must not.
 *
 * ── Why it is called on every panel open, never cached ──────────────────────
 * TikTok's Content Sharing Guidelines require the app to "retrieve the latest
 * creator info when rendering the Post to TikTok page". The creator can change
 * their account to private, or switch off Duet/Stitch, between one compose
 * session and the next. Rendering stale options would offer a privacy level
 * the account no longer permits, and the post would be rejected at publish.
 *
 * A verbatim TikTok rejection for a comparable integration cited exactly this
 * class of fault, so this is an audit requirement, not an optimisation.
 *
 * Rate limit is 20/min per token, which is far above any realistic rate of a
 * human opening a compose panel.
 *
 * ── The response shape trap ─────────────────────────────────────────────────
 * TikTok returns HTTP 200 for several REAL failures — spam_risk_too_many_posts,
 * reached_active_user_cap, spam_risk_user_banned_from_posting. Checking
 * `res.ok` alone would treat a banned account as a healthy one and render a
 * compose form that can never succeed. The body's error.code is authoritative.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { decryptToken } from '../../../_lib/tokenCrypto';

const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const TIMEOUT_MS = 15_000;

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
 * Turn a TikTok error code into something a person can act on.
 *
 * Each of these has a different remedy, and several are temporary states of
 * the user's own account rather than faults in our integration — saying
 * "something went wrong" would send them looking in the wrong place.
 */
const ERROR_COPY = {
  spam_risk_too_many_posts: 'You have hit TikTok\'s daily posting limit for this account. Try again tomorrow.',
  spam_risk_user_banned_from_posting: 'TikTok has restricted posting on this account.',
  reached_active_user_cap: 'TikTok\'s daily quota for this app is used up. Try again tomorrow.',
  access_token_invalid: 'TikTok signed you out. Reconnect the account to keep posting.',
  scope_not_authorized: 'This account did not grant permission to post. Reconnect and approve posting.',
  rate_limit_exceeded: 'Too many requests to TikTok just now. Try again in a moment.',
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = createServiceClient();

    // Service-role bypasses RLS entirely, so ownership is re-imposed by hand.
    const { data: account, error: acctErr } = await supabase
      .from('connected_accounts')
      .select('id, user_id, platform, display_name')
      .eq('id', accountId)
      .maybeSingle();
    if (acctErr) throw acctErr;

    // 404 rather than 403 for a foreign account: confirming the row exists
    // would tell a caller they had guessed somebody else's account id.
    if (!account || account.user_id !== user.id || account.platform !== 'tiktok') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const { data: secret } = await supabase
      .from('connected_account_secrets')
      .select('access_token_ciphertext')
      .eq('connected_account_id', accountId)
      .maybeSingle();

    if (!secret?.access_token_ciphertext) {
      return NextResponse.json(
        { error: 'credential_missing', message: 'Reconnect this TikTok account to post.' },
        { status: 409 },
      );
    }

    let token;
    try {
      token = await decryptToken(secret.access_token_ciphertext);
    } catch {
      return NextResponse.json(
        { error: 'credential_unreadable', message: 'Reconnect this TikTok account to post.' },
        { status: 409 },
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(CREATOR_INFO_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return NextResponse.json(
        {
          error: timedOut ? 'tiktok_timeout' : 'tiktok_unreachable',
          message: 'TikTok is not responding right now. This is on their side.',
        },
        { status: 504 },
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await res.json().catch(() => null);

    // HTTP 200 does NOT mean success here — see the header note.
    const code = body?.error?.code;
    if (!res.ok || (code && code !== 'ok')) {
      return NextResponse.json(
        {
          error: code || `http_${res.status}`,
          message: ERROR_COPY[code] || 'TikTok would not return this account\'s posting settings.',
        },
        { status: code === 'access_token_invalid' || code === 'scope_not_authorized' ? 409 : 502 },
      );
    }

    const d = body?.data || {};

    // Only the fields the panel renders. Nothing else, and never the token.
    return NextResponse.json({
      creatorNickname: d.creator_nickname ?? null,
      creatorUsername: d.creator_username ?? null,
      // TTL of 2 hours per TikTok's docs, so it is fetched fresh each time
      // rather than stored — a stored URL would 404 on a later compose.
      creatorAvatarUrl: d.creator_avatar_url ?? null,
      // Rendered verbatim as the dropdown's options. NEVER substituted with a
      // hardcoded list: a private account returns a different set, and
      // offering a level the account does not permit fails at publish.
      privacyLevelOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
      commentDisabled: Boolean(d.comment_disabled),
      duetDisabled: Boolean(d.duet_disabled),
      stitchDisabled: Boolean(d.stitch_disabled),
      maxVideoPostDurationSec: Number.isFinite(d.max_video_post_duration_sec)
        ? d.max_video_post_duration_sec
        : null,
    });
  } catch (err) {
    console.error('[tiktok/creator-info] error:', err?.message || err);
    return NextResponse.json(
      { error: 'creator_info_failed', message: 'Could not load your TikTok posting settings.' },
      { status: 500 },
    );
  }
}
