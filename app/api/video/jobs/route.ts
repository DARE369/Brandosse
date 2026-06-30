// src/app/api/video/jobs/route.ts
// Lists the authenticated user's video jobs.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  successResponse,
  errorResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import type { JobStatus } from '@/lib/video-engine/types';

const VALID_STATUSES: JobStatus[] = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'complete',
  'failed',
];

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status') as JobStatus | null;
  const limitParam = Math.min(parsePositiveInt(searchParams.get('limit'), 20), 50);
  const pageParam = parsePositiveInt(searchParams.get('page'), 1);
  const offset = (pageParam - 1) * limitParam;

  if (statusParam && !VALID_STATUSES.includes(statusParam)) {
    return errorResponse(
      `Invalid status filter. Must be one of: ${VALID_STATUSES.join(', ')}`,
      'INVALID_STATUS_FILTER',
      400,
    );
  }

  let query = supabaseAdmin
    .from('video_jobs')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limitParam - 1);

  if (statusParam) {
    query = query.eq('status', statusParam);
  }

  const { data: jobs, error, count } = await query;

  if (error) {
    console.error('[VideoJobs] List failed:', error);
    return errorResponse('Failed to fetch your jobs. Please try again.', 'FETCH_FAILED', 500);
  }

  return successResponse({
    jobs: jobs ?? [],
    total: count ?? 0,
    page: pageParam,
    limit: limitParam,
  });
}
