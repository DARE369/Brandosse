// app/api/video/upload-ticket/route.ts
//
// LOCK L7.4 — mint a short-lived, signed permission slip so a browser can
// upload source video straight to the worker.
//
// ── Why the browser cannot just call the worker ─────────────────────────────
// Every worker endpoint authenticates with WORKER_WEBHOOK_SECRET in a header.
// That secret must never reach a browser: anyone holding it could submit and
// cancel any user's jobs. So the client gets a ticket instead — an HMAC over
// (user_id, upload_id, expiry), signed here with the shared secret after the
// user has been authenticated.
//
// The worker verifies the signature and expiry with no callback to this app and
// no user state of its own. The secret stays server-side, the ticket dies in an
// hour, and it is bound to one user and one upload so it cannot be replayed
// against another account.
//
// ── Why not Supabase Storage ────────────────────────────────────────────────
// This project's Storage refuses any bucket limit above 50MB — the free-plan
// ceiling, measured 2026-08-22. A 60-minute 1080p podcast is 1-3GB, so that
// path works only for the wrong size of video. The worker already has a paid-for
// 25GB volume, and uploading to it costs nothing extra and removes a download
// hop.

import { NextRequest } from 'next/server';
import { createHmac, randomUUID } from 'node:crypto';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '@/lib/video-engine/auth-helpers';

// Must match TICKET_TTL_SECONDS in video-worker/uploads.py. Long enough for a
// large file on a slow connection; short enough that a leaked ticket is not a
// standing invitation.
const TICKET_TTL_SECONDS = 60 * 60;

/**
 * Kept byte-identical to sign_ticket() in video-worker/uploads.py. If either
 * side changes the payload shape, every upload fails closed — which is the
 * correct direction for a signature mismatch to fail.
 */
function signTicket(userId: string, uploadId: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}:${uploadId}:${expiresAt}`).digest('hex');
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const secret = process.env.VIDEO_WORKER_WEBHOOK_SECRET;
  const workerUrl = process.env.WORKER_WEBHOOK_URL;

  // Refuse clearly rather than mint a ticket nothing can verify. A ticket
  // signed with an empty secret would be accepted by a worker whose secret is
  // also empty, which is the worst possible version of this.
  if (!secret) {
    return errorResponse(
      'Uploads are not configured on this environment (VIDEO_WORKER_WEBHOOK_SECRET is unset).',
      'UPLOAD_NOT_CONFIGURED',
      503,
    );
  }
  if (!workerUrl) {
    return errorResponse(
      'Uploads are not configured on this environment (WORKER_WEBHOOK_URL is unset).',
      'UPLOAD_NOT_CONFIGURED',
      503,
    );
  }

  // The browser POSTs to this URL from an HTTPS page. If WORKER_WEBHOOK_URL is
  // http://, the browser blocks it as mixed content before a request is ever
  // made, and the only symptom is "Failed to fetch" — no status, no CORS error,
  // nothing that names the cause.
  //
  // This bites ONLY the browser. Server-side callers (notifyJobSubmitted) follow
  // the worker's 301 http->https quietly, so an http:// value looks completely
  // healthy from the backend while every upload fails. Upgrade it here rather
  // than depending on an environment variable being written correctly.
  const secureWorkerUrl = workerUrl.replace(/^http:\/\//i, 'https://');
  if (secureWorkerUrl !== workerUrl) {
    console.warn(
      '[upload-ticket] WORKER_WEBHOOK_URL is http:// — upgraded to https:// for the browser. '
        + 'Fix the environment variable: an http value blocks every upload as mixed content.',
    );
  }

  const uploadId = randomUUID().replace(/-/g, '');
  const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
  const signature = signTicket(user.id, uploadId, expiresAt, secret);

  return successResponse({
    upload_url: `${secureWorkerUrl.replace(/\/$/, '')}/upload`,
    upload_id: uploadId,
    user_id: user.id,
    expires_at: expiresAt,
    signature,
    // What the client should put in source_url when it submits the job.
    // download.py recognises this scheme and skips fetching entirely.
    source_url: `worker://${user.id}/${uploadId}`,
  });
}
