// app/api/video/jobs/route.ts
// Lists the authenticated user's video jobs, and reports whether they have the
// capacity to start another one.
//
// ── Why capacity ships with the list ────────────────────────────────────────
// Concurrency (2), the hourly submission cap (10), and the credit balance are
// all enforced server-side at submit time (src/lib/video-engine/rate-limiter.ts,
// app/api/video/submit/route.ts). Until now the UI could only discover them by
// being refused — and for an upload that meant discovering it AFTER pushing
// gigabytes. Returning them alongside the list lets the interface say "2 of 2
// slots in use" before the person commits, from the same numbers the server
// will judge them by. A limit the user learns by hitting it is a limit the
// product never told them about.
//
// ── Why clip rows come back with each job ───────────────────────────────────
// The list needs two counts, not one: total clips and how many have finished
// rendering ("4 of 7"). Clips land one at a time, so a single count cannot
// express a job that is halfway done. The projection is deliberately two
// columns wide and bounded by the page size.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  successResponse,
  errorResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { VIDEO_ENGINE_CONSTANTS } from '@/lib/video-engine/constants';
import { MIN_CREDITS_TO_SUBMIT } from '@/lib/video-engine/credit-packages';
import type { JobStatus } from '@/lib/video-engine/types';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: JobStatus[] = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'complete',
  'failed',
];

/** Mirrors rate-limiter.ts. Kept in sync deliberately, not imported, because
 *  the limiter's copy is the one that ENFORCES and this one only DESCRIBES —
 *  they must never silently diverge, so both name the same literals. */
const ACTIVE_STATUSES: JobStatus[] = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
];
const MAX_CONCURRENT_JOBS = 2;
const HOURLY_SUBMISSION_LIMIT = 10;

/** Named groups the UI filters by, expanded to real statuses here so the
 *  client never has to know that "working" is five different rows. */
const STATUS_GROUPS: Record<string, JobStatus[]> = {
  working: ACTIVE_STATUSES,
  done: ['complete'],
  failed: ['failed'],
};

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** PostgREST `or=` values are comma-separated, so a comma or a parenthesis in
 *  user input would change the shape of the filter rather than be matched by
 *  it. Strip them, and the `%`/`_` wildcards, before interpolating. */
function sanitiseSearch(raw: string): string {
  return raw.replace(/[,()%_*\\]/g, ' ').trim().slice(0, 120);
}

type ClipProjection = { id: string; render_status: string | null };

async function readCapacity(userId: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [activeResult, recentResult, creditsResult] = await Promise.all([
    supabaseAdmin
      .from('video_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ACTIVE_STATUSES),
    // Not head-only: the reset time is the OLDEST submission in the window plus
    // an hour, which needs the row, not just the count. "Resets at 4:12 pm" is
    // a materially more useful sentence than "try again later".
    supabaseAdmin
      .from('video_jobs')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('user_credits').select('balance').eq('user_id', userId).maybeSingle(),
  ]);

  const recentRows = recentResult.data ?? [];
  const oldestInWindow = recentRows[0]?.created_at ?? null;

  return {
    slots_used: activeResult.count ?? 0,
    slots_total: MAX_CONCURRENT_JOBS,
    submitted_this_hour: recentRows.length,
    hourly_limit: HOURLY_SUBMISSION_LIMIT,
    // null when nothing was submitted this hour — there is no reset pending, and
    // rendering a clock time for one would be an invention.
    hour_resets_at: oldestInWindow
      ? new Date(Date.parse(oldestInWindow) + 60 * 60 * 1000).toISOString()
      : null,
    // A failed read is reported as unknown rather than 0. A real-looking zero on
    // an account that has credits is the same class of lie as the balance bug
    // fixed in CreditsPage — it tells someone they cannot afford something they
    // can.
    balance: creditsResult.error ? null : creditsResult.data?.balance ?? 0,
    min_credits_to_submit: MIN_CREDITS_TO_SUBMIT,
    credits_per_source_minute: VIDEO_ENGINE_CONSTANTS.CREDITS_PER_MINUTE_OF_SOURCE,
  };
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const searchParam = sanitiseSearch(searchParams.get('q') ?? '');
  const sortParam = searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const limitParam = Math.min(parsePositiveInt(searchParams.get('limit'), 25), 50);
  const pageParam = parsePositiveInt(searchParams.get('page'), 1);
  const offset = (pageParam - 1) * limitParam;

  let statusFilter: JobStatus[] | null = null;

  if (statusParam && statusParam !== 'all') {
    if (STATUS_GROUPS[statusParam]) {
      statusFilter = STATUS_GROUPS[statusParam];
    } else if (VALID_STATUSES.includes(statusParam as JobStatus)) {
      statusFilter = [statusParam as JobStatus];
    } else {
      return errorResponse(
        `Unknown status filter "${statusParam}". Use all, working, done, failed, or one of: ${VALID_STATUSES.join(', ')}`,
        'INVALID_STATUS_FILTER',
        400,
      );
    }
  }

  let query = supabaseAdmin
    .from('video_jobs')
    .select('*, video_clips(id, render_status)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: sortParam === 'oldest' })
    .range(offset, offset + limitParam - 1);

  if (statusFilter) query = query.in('status', statusFilter);

  if (searchParam) {
    // Both columns, because a link job has no title until the download stage
    // resolves one — searching only source_title would make every queued or
    // failed link job unfindable.
    query = query.or(`source_title.ilike.%${searchParam}%,source_url.ilike.%${searchParam}%`);
  }

  const [listResult, capacity] = await Promise.all([query, readCapacity(user.id)]);

  const { data: jobs, error, count } = listResult;

  if (error) {
    console.error('[VideoJobs] List failed:', error);
    return errorResponse('Failed to fetch your jobs. Please try again.', 'FETCH_FAILED', 500);
  }

  const shaped = (jobs ?? []).map((job) => {
    const clips: ClipProjection[] = Array.isArray(job.video_clips) ? job.video_clips : [];
    const rendered = clips.filter((clip) => clip.render_status === 'complete').length;
    const failedClips = clips.filter((clip) => clip.render_status === 'failed').length;
    const { video_clips: _dropped, ...rest } = job;

    return {
      ...rest,
      clip_count: clips.length,
      clips_rendered: rendered,
      clips_failed: failedClips,
    };
  });

  const total = count ?? 0;

  return successResponse({
    jobs: shaped,
    total,
    page: pageParam,
    limit: limitParam,
    has_more: offset + shaped.length < total,
    capacity,
  });
}
