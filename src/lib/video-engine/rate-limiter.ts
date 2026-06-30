// src/lib/video-engine/rate-limiter.ts
// Database-backed rate limiter for job submissions.

import { supabaseAdmin } from './supabase-admin';

const HOURLY_SUBMISSION_LIMIT = 10;
const MAX_CONCURRENT_JOBS = 2;

export async function checkSubmissionRateLimit(
  userId: string,
): Promise<{ allowed: boolean; code?: string; message?: string }> {
  const activeStatuses = ['queued', 'downloading', 'transcribing', 'analyzing', 'rendering'];

  const { count: activeCount, error: activeError } = await supabaseAdmin
    .from('video_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', activeStatuses);

  if (activeError) {
    console.error('[RateLimiter] Active job check failed:', activeError);
    return { allowed: true };
  }

  if ((activeCount ?? 0) >= MAX_CONCURRENT_JOBS) {
    return {
      allowed: false,
      code: 'TOO_MANY_ACTIVE_JOBS',
      message: `You already have ${activeCount} videos being processed. Please wait for one to complete before submitting another.`,
    };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count: recentCount, error: recentError } = await supabaseAdmin
    .from('video_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);

  if (recentError) {
    console.error('[RateLimiter] Recent job check failed:', recentError);
    return { allowed: true };
  }

  if ((recentCount ?? 0) >= HOURLY_SUBMISSION_LIMIT) {
    return {
      allowed: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `You have submitted ${recentCount} videos in the last hour. The limit is ${HOURLY_SUBMISSION_LIMIT} per hour. Please try again later.`,
    };
  }

  return { allowed: true };
}
