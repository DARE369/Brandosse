// app/api/video/health/route.ts
// Reports whether the processing worker is awake.
//
// ── The defect this closes ──────────────────────────────────────────────────
// src/hooks/video-engine/useWorkerHealth.js has polled `/api/video/health`
// every 30 seconds since it was written, and this route did not exist. Every
// poll 404'd, `res.ok` was false, and the hook resolved to "unhealthy"
// permanently — so the submission screen showed "The processor is asleep, this
// adds about half a minute" on EVERY visit, regardless of the worker's actual
// state.
//
// checkWorkerHealth() was already written and correct
// (src/lib/video-engine/worker-client.ts:77). Nothing ever called it. This is
// the repo's dominant defect class — disconnection, not absence — so the fix is
// a route, not a rewrite.
//
// A warning that is always on is not information; people learn to read past it,
// and then they read past the one time it was true.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
} from '@/lib/video-engine/auth-helpers';
import { checkWorkerHealth } from '@/lib/video-engine/worker-client';

// The worker sleeps when idle and checkWorkerHealth allows 35s for it to
// answer, so this must never be cached or statically evaluated.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { healthy, details } = await checkWorkerHealth();

  // 200 with a body either way. A non-2xx here would put the caller back where
  // it started — unable to tell "the worker is asleep" from "this endpoint is
  // broken" — which is the exact confusion being fixed.
  return Response.json(
    {
      success: true,
      healthy,
      details,
      // "unknown" is deliberately absent: this route always reaches a verdict.
      // The hook treats a transport failure as unknown on its own side.
      status: healthy ? 'healthy' : 'asleep',
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
