// src/app/api/video/submit/route.ts
// Submits a video URL for processing.

import { NextRequest } from 'next/server';
import { z } from 'zod';
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
import { VIDEO_ENGINE_CONSTANTS } from '@/lib/video-engine/constants';

const submitSchema = z
  .object({
    url: z.string().trim().min(3, 'URL is too short').max(500, 'URL is too long'),
    platform: z.enum(['youtube', 'twitter', 'upload']),
  })
  .superRefine((value, ctx) => {
    if (
      value.platform !== 'upload' &&
      !value.url.startsWith('http://') &&
      !value.url.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'URL must start with http:// or https://',
      });
    }
  });

function detectPlatformFromUrl(url: string): 'youtube' | 'twitter' | null {
  for (const pattern of VIDEO_ENGINE_CONSTANTS.YOUTUBE_URL_PATTERNS) {
    if (pattern.test(url)) return 'youtube';
  }

  for (const pattern of VIDEO_ENGINE_CONSTANTS.TWITTER_URL_PATTERNS) {
    if (pattern.test(url)) return 'twitter';
  }

  return null;
}

function isUnsupportedUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  const isYoutube = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');

  if (!isYoutube) return false;

  return (
    lowerUrl.includes('youtube.com/playlist') ||
    lowerUrl.includes('/private') ||
    lowerUrl.includes('privacy=private') ||
    (lowerUrl.includes('/shorts/') && lowerUrl.includes('list='))
  );
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  let body: z.infer<typeof submitSchema>;

  try {
    body = submitSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        'VALIDATION_ERROR',
        400,
      );
    }

    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  const { url, platform } = body;

  if (platform !== 'upload') {
    if (isUnsupportedUrl(url)) {
      return errorResponse(
        'This URL is not supported. Paste a direct public YouTube or Twitter/X video URL.',
        'UNSUPPORTED_URL',
        400,
      );
    }

    const detectedPlatform = detectPlatformFromUrl(url);

    if (!detectedPlatform) {
      return errorResponse(
        'This URL is not supported. Paste a YouTube or Twitter/X video URL.',
        'UNSUPPORTED_URL',
        400,
      );
    }

    if (detectedPlatform !== platform) {
      return errorResponse(
        `The URL looks like a ${detectedPlatform} link but platform is set to ${platform}.`,
        'PLATFORM_MISMATCH',
        400,
      );
    }
  }

  const { data: creditsData, error: creditsError } = await supabaseAdmin
    .from('user_credits')
    .select('balance')
    .eq('user_id', user.id)
    .single();

  if (creditsError || !creditsData) {
    console.error('[VideoSubmit] Credits fetch failed:', creditsError);
    return errorResponse(
      'Could not retrieve your credit balance. Please refresh and try again.',
      'CREDITS_FETCH_FAILED',
      500,
    );
  }

  if (creditsData.balance < MIN_CREDITS_TO_SUBMIT) {
    return errorResponse(
      `You need at least ${MIN_CREDITS_TO_SUBMIT} credits to process a video. Your current balance is ${creditsData.balance}. Purchase more credits to continue.`,
      'INSUFFICIENT_CREDITS',
      402,
    );
  }

  const rateCheck = await checkSubmissionRateLimit(user.id);
  if (!rateCheck.allowed) {
    return errorResponse(rateCheck.message!, rateCheck.code!, 429);
  }

  const { data: newJob, error: insertError } = await supabaseAdmin
    .from('video_jobs')
    .insert({
      user_id: user.id,
      source_url: url,
      source_platform: platform,
      status: 'queued',
    })
    .select('id, status, created_at')
    .single();

  if (insertError || !newJob) {
    console.error('[VideoSubmit] Job insert failed:', insertError);
    return errorResponse('Failed to create your video job. Please try again.', 'JOB_CREATE_FAILED', 500);
  }

  const workerNotified = await notifyJobSubmitted(newJob.id);
  if (!workerNotified) {
    console.warn('[VideoSubmit] Worker notification failed for job:', newJob.id);
  }

  return successResponse(
    {
      job_id: newJob.id,
      status: newJob.status,
      created_at: newJob.created_at,
      credits_remaining: creditsData.balance,
      worker_notified: workerNotified,
    },
    201,
  );
}
