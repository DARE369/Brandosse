// app/api/video/jobs/[id]/rerun/route.ts
// Run a previous job again, with the same source and the same settings.
//
// ── What this replaces ──────────────────────────────────────────────────────
// "Try again" used to navigate to the submission form with `?url=` prefilled
// (src/components/video-engine/JobStatusPipeline.jsx). That threw away every
// other choice the person had made — aspect ratio, caption style, clip count,
// duration bounds, the free-text steer — and made them re-enter a decision they
// had already made, at the exact moment they were least pleased with us.
//
// ── Why it is a NEW job, not a resurrection ─────────────────────────────────
// A rerun costs credits again, because it does the work again: fetch,
// transcribe, analyse, render. Framing it as "retrying" the old job would imply
// the first one's charge carries over. It does not — the first one was refunded
// when it failed (video-worker/job_runner.py:165). So this creates a new row and
// the button that calls it must state the price.
//
// ── The one case that cannot work ───────────────────────────────────────────
// Uploaded sources live on the worker's volume for 24 hours and are cleared on
// redeploy (video-worker/stages/download.py:_resolve_worker_upload). After that
// there is nothing to re-run. This route cannot see the worker's disk, so it
// reports `source_may_be_expired` and lets the caller decide whether to offer
// the action at all — rather than cheerfully creating a job that is already
// doomed.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { notifyJobSubmitted } from '@/lib/video-engine/worker-client';
import { checkSubmissionRateLimit } from '@/lib/video-engine/rate-limiter';
import { MIN_CREDITS_TO_SUBMIT } from '@/lib/video-engine/credit-packages';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Every setting that shapes the output. Copied forward verbatim so a rerun is
 *  genuinely the same request, not a similar one. */
const CARRIED_SETTINGS = [
  'aspect_ratio',
  'caption_style',
  'clip_count_target',
  'min_duration_secs',
  'max_duration_secs',
  'specific_moments',
] as const;

type RerunSource = {
  id: string;
  source_url: string | null;
  source_platform: string | null;
  source_duration_secs: number | null;
} & { [K in (typeof CARRIED_SETTINGS)[number]]: string | number | null };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { id: jobId } = await context.params;

  // The column list is a literal, not CARRIED_SETTINGS.join(', '). Building it
  // at runtime leaves the client unable to infer a row shape, so `data` came
  // back as GenericStringError and every field access failed to type check.
  // The guard against the two drifting apart is the assertion below.
  const { data: original, error: readError } = await supabaseAdmin
    .from('video_jobs')
    .select(
      'id, source_url, source_platform, source_duration_secs, '
        + 'aspect_ratio, caption_style, clip_count_target, min_duration_secs, '
        + 'max_duration_secs, specific_moments',
    )
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single<RerunSource>();

  if (readError || !original) return errorResponse('Job not found.', 'JOB_NOT_FOUND', 404);

  if (!original.source_url || !original.source_platform) {
    return errorResponse(
      'This job has no source recorded, so it cannot be run again.',
      'NO_SOURCE',
      422,
    );
  }

  // ── The same gates the original submission passed ─────────────────────────
  // Deliberately re-checked rather than assumed: the balance and the slot count
  // are both different now from when the first job was created.
  const { data: credits, error: creditsError } = await supabaseAdmin
    .from('user_credits')
    .select('balance')
    .eq('user_id', user.id)
    .single();

  if (creditsError || !credits) {
    console.error('[VideoRerun] Credits fetch failed:', creditsError);
    return errorResponse(
      'Could not retrieve your credit balance. Please refresh and try again.',
      'CREDITS_FETCH_FAILED',
      500,
    );
  }

  if (credits.balance < MIN_CREDITS_TO_SUBMIT) {
    return errorResponse(
      `You need at least ${MIN_CREDITS_TO_SUBMIT} credits to run a video again. Your current balance is `
        + `${credits.balance}. Purchase more credits to continue.`,
      'INSUFFICIENT_CREDITS',
      402,
    );
  }

  const rateCheck = await checkSubmissionRateLimit(user.id);
  if (!rateCheck.allowed) return errorResponse(rateCheck.message!, rateCheck.code!, 429);

  const carried: Record<string, unknown> = {};
  for (const key of CARRIED_SETTINGS) {
    const value = (original as Record<string, unknown>)[key];
    // Spread-if-present, matching submit/route.ts: an absent key lets the column
    // DEFAULT apply, while an explicit null would override it.
    if (value !== null && value !== undefined && value !== '') carried[key] = value;
  }

  const { data: newJob, error: insertError } = await supabaseAdmin
    .from('video_jobs')
    .insert({
      user_id: user.id,
      source_url: original.source_url,
      source_platform: original.source_platform,
      status: 'queued',
      ...carried,
    })
    .select('id, status, created_at')
    .single();

  if (insertError || !newJob) {
    console.error('[VideoRerun] Job insert failed:', insertError);
    return errorResponse('Failed to start the job again. Please try again.', 'JOB_CREATE_FAILED', 500);
  }

  const workerNotified = await notifyJobSubmitted(newJob.id);
  if (!workerNotified) console.warn('[VideoRerun] Worker notification failed for job:', newJob.id);

  return successResponse(
    {
      job_id: newJob.id,
      status: newJob.status,
      created_at: newJob.created_at,
      rerun_of: original.id,
      credits_remaining: credits.balance,
      worker_notified: workerNotified,
      // Uploads are held for 24 hours and cleared on redeploy. We cannot see the
      // worker's disk from here, so this is a warning, not a verdict.
      source_may_be_expired: String(original.source_url).startsWith('worker://'),
      // The rate is fixed; the true charge is only known once the source has
      // been fetched and measured. Passing the previous duration lets the caller
      // state an estimate without inventing one.
      estimated_credits: original.source_duration_secs
        ? Math.max(1, Math.ceil(original.source_duration_secs / 60))
        : null,
    },
    201,
  );
}
