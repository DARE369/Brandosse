/**
 * GET /api/auth/zernio/connect?platform=instagram&scope=personal
 *
 * Ensures the user has a Zernio profile, then asks Zernio for the OAuth
 * authorization URL for the requested platform and redirects the browser
 * there. Zernio then redirects back to /api/auth/zernio/callback.
 *
 * Mirrors app/api/auth/oauth/route.js's request/auth pattern, but there's no
 * signed state to build — Zernio owns the OAuth exchange itself, we only need
 * to know which of our users initiated the connect (carried via redirect_url).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const ZERNIO_BASE = 'https://zernio.com/api/v1';

function getAppUrl(request) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

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

async function ensureZernioProfile(supabase, userId) {
  const { data: profileRow, error: readErr } = await supabase
    .from('profiles')
    .select('zernio_profile_id')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) throw readErr;

  if (profileRow?.zernio_profile_id) return profileRow.zernio_profile_id;

  const res = await fetch(`${ZERNIO_BASE}/profiles`, {
    method: 'POST',
    headers: zernioHeaders(),
    body: JSON.stringify({ name: `brandosse-user-${userId}` }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Zernio create profile failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const profileId = data?.profile?._id;
  if (!profileId) throw new Error('Zernio did not return a profile id');

  const { error: writeErr } = await supabase
    .from('profiles')
    .update({ zernio_profile_id: profileId })
    .eq('id', userId);
  if (writeErr) throw writeErr;

  return profileId;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform')?.toLowerCase();

  if (!platform) {
    return NextResponse.json({ error: 'platform is required' }, { status: 400 });
  }
  if (!process.env.ZERNIO_API_KEY) {
    return NextResponse.json({ error: 'Zernio is not configured' }, { status: 503 });
  }

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = createServiceClient();
    const profileId = await ensureZernioProfile(supabase, user.id);

    // profileId is carried in our own redirect_url (rather than relying on
    // Zernio echoing it back on every platform's callback) so the callback
    // always knows which Brandosse user/profile this connection belongs to.
    const redirectUrl = `${getAppUrl(request)}/api/auth/zernio/callback` +
      `?platform=${encodeURIComponent(platform)}&profileId=${encodeURIComponent(profileId)}`;
    const connectUrl = `${ZERNIO_BASE}/connect/${encodeURIComponent(platform)}` +
      `?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;

    const res = await fetch(connectUrl, { headers: zernioHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`Zernio connect failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    if (!data?.authUrl) throw new Error('Zernio did not return an authUrl');

    return wantsJson(request, searchParams)
      ? NextResponse.json({ url: data.authUrl })
      : NextResponse.redirect(data.authUrl);
  } catch (error) {
    console.error('[zernio/connect] error:', error);
    return NextResponse.json({ error: error?.message || 'Could not start the Zernio connect flow' }, { status: 500 });
  }
}
