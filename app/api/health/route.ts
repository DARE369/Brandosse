// app/api/health/route.ts
//
// Which commit the frontend is actually serving.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Until 2026-09-01 there was no way to ask a running deployment what code it
// was built from. Answering "is the latest code live?" required either the
// Vercel CLI with a token, or inferring it from deploy timestamps.
//
// Both are bad. The timestamp inference actively misled this project earlier
// the same day: it reported the `daily-analysis` edge function as two hours
// stale, and the commit it appeared to be missing contained a live security
// fix. Only a behavioural probe disproved it. And a Vercel token is not
// read-only — it can deploy and delete projects — so requiring one to answer a
// read-only question is the wrong trade.
//
// The worker got the same treatment (GET /health -> git_sha). This is the
// frontend half, so every surface can state its own version without anyone
// holding a credential.
//
// ── Deliberately public and unauthenticated ─────────────────────────────────
// It discloses a commit SHA of a private repository and nothing else: no user
// data, no configuration, no environment values, no counts. A SHA is not a
// secret — it is already visible to anyone with repository access, and it is
// worthless without it. Gating this behind auth would defeat the point, since
// the times you most need it are when something is broken and you want a
// straight answer from an unauthenticated curl.
//
// Anything beyond version and liveness does NOT belong here. The moment this
// starts reporting queue depths or database reachability it becomes a
// reconnaissance endpoint, and it stops being safe to leave open.

import { NextResponse } from 'next/server';

// Never prerendered or cached: a health check served from a stale cache is
// worse than none, because it reports the version of whenever it was cached
// and looks authoritative doing it.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  // Vercel injects these at build time. VERCEL_GIT_COMMIT_SHA is the commit the
  // build was produced from — the single fact this endpoint exists to report.
  // "unknown" means a local run or a build outside Vercel, and is deliberately
  // distinguishable from a real SHA rather than being faked or omitted.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';

  return NextResponse.json(
    {
      status: 'healthy',
      service: 'brandosse-web',
      git_sha: sha,
      git_ref: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
      environment: process.env.VERCEL_ENV ?? 'local',
    },
    {
      headers: {
        // Belt and braces alongside force-dynamic: no CDN, browser or proxy
        // may hold on to this response.
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
