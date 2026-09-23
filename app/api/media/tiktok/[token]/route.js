/**
 * GET /api/media/tiktok/<token> — the ONE public media endpoint.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * TikTok photo posts accept PULL_FROM_URL only: TikTok's servers fetch the
 * images themselves, presenting no credential of ours, and TikTok's docs
 * require that the developer "verify the ownership of the URL prefix or
 * domain". Our media lives on <project>.supabase.co — a host we can never
 * verify — so for photo posts the bytes have to come from brandosse.com.
 *
 * ── What that costs, and how it is contained ────────────────────────────────
 * Everything else in this product is read behind a user's JWT. This is read by
 * a stranger. The containment is the token (app/api/_lib/mediaToken.js):
 * HMAC-signed, expiring in 30 minutes, naming ONE generation id.
 *
 * On top of the token:
 *   * The route resolves media through the generation ROW and the storage API —
 *     never by fetching a URL it was handed. A route that fetched a
 *     caller-supplied URL would be an SSRF proxy with our egress.
 *   * An `output_url` on the row is only fetched when it points at this
 *     project's own Supabase host. Rows are ours, but "ours" is not a security
 *     boundary once a single write path accepts a user-supplied URL.
 *   * IMAGES ONLY: TikTok's photo endpoint is the only consumer, and serving
 *     video here would turn a 30-minute token into a bandwidth bill.
 *   * A size cap, a timeout, and `redirect: 'manual'` so a redirect cannot walk
 *     us somewhere else.
 *   * No-store, no-index. This URL is meant to be fetched once by TikTok.
 *
 * It returns 403 for every token failure — malformed, forged, expired — so a
 * prober learns nothing about which part was wrong.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMediaToken } from '../../../_lib/mediaToken';

export const runtime = 'nodejs';
// Always fresh: the token is short-lived and the bytes must not be cached by
// the framework for a later, different token.
export const dynamic = 'force-dynamic';

/** TikTok documents photo posts; anything else does not belong on a public URL. */
const ALLOWED_TYPES = /^image\/(jpeg|jpg|png|webp)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

function deny(reason) {
  // One status, one body, whatever went wrong.
  return new NextResponse('Forbidden', {
    status: 403,
    headers: { 'Cache-Control': 'no-store', 'X-Media-Proxy-Reason': reason },
  });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing_supabase_service_credentials');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request, context) {
  const { token } = await context.params;

  const verified = verifyMediaToken(token);
  if (!verified.ok) {
    if (verified.reason === 'not_configured') {
      console.error('[media-proxy] MEDIA_PROXY_SECRET is not set; refusing every request');
      return new NextResponse('Media proxy is not configured', { status: 503 });
    }
    return deny(verified.reason);
  }

  let supabase;
  try {
    supabase = serviceClient();
  } catch {
    return new NextResponse('Media proxy is not configured', { status: 503 });
  }

  const { data: gen, error } = await supabase
    .from('generations')
    .select('id, media_type, output_url, storage_path, metadata')
    .eq('id', verified.generationId)
    .maybeSingle();

  if (error) {
    console.error('[media-proxy] generation lookup failed:', error.message);
    return new NextResponse('Temporarily unavailable', { status: 503 });
  }
  if (!gen) return deny('no_generation');

  // Images only. A video here would be both wrong for TikTok's photo endpoint
  // and an unmetered download of a large file from a public URL.
  const mediaType = String(gen.media_type || '').toLowerCase();
  if (mediaType && !['image', 'photo'].includes(mediaType)) return deny('not_an_image');

  // ── Resolve the bytes, without ever fetching a caller-supplied URL ─────────
  let body;
  let contentType;

  const storagePath = gen.storage_path || null;
  const declaredUrl = gen.output_url || null;

  if (storagePath) {
    const meta = gen.metadata && typeof gen.metadata === 'object' ? gen.metadata : {};
    const bucket = String(meta.storage_bucket || 'generations');
    const { data, error: dlErr } = await supabase.storage.from(bucket).download(storagePath);
    if (dlErr || !data) {
      console.error(`[media-proxy] could not read ${bucket}/${storagePath}:`, dlErr?.message);
      return new NextResponse('Temporarily unavailable', { status: 503 });
    }
    contentType = data.type || 'application/octet-stream';
    body = Buffer.from(await data.arrayBuffer());
  } else if (declaredUrl) {
    // Only this project's own storage host. The row is ours, but a single write
    // path that ever accepts a user-supplied output_url would otherwise turn
    // this into an open proxy.
    let target;
    try {
      target = new URL(declaredUrl);
    } catch {
      return deny('unreadable_url');
    }
    const allowedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
    if (target.protocol !== 'https:' || target.host !== allowedHost) return deny('foreign_host');

    const res = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => null);
    if (!res || !res.ok) return new NextResponse('Temporarily unavailable', { status: 503 });

    contentType = res.headers.get('content-type') || 'application/octet-stream';
    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (declaredLength > MAX_BYTES) return deny('too_large');
    body = Buffer.from(await res.arrayBuffer());
  } else {
    return deny('no_media');
  }

  if (body.length > MAX_BYTES) return deny('too_large');
  if (!ALLOWED_TYPES.test(contentType)) return deny('wrong_content_type');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      // TikTok fetches this once, within seconds of the post being created.
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Disposition': 'inline',
      // The bytes are an image; stop any browser sniffing them as something else.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
