// src/app/api/video/submit/route.ts
// Submits a video URL for processing.

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '../../../../lib/video-engine/auth-helpers';
import { supabaseAdmin } from '../../../../lib/video-engine/supabase-admin';
import { notifyJobSubmitted } from '../../../../lib/video-engine/worker-client';
import { checkSubmissionRateLimit } from '../../../../lib/video-engine/rate-limiter';
import { MIN_CREDITS_TO_SUBMIT } from '../../../../lib/video-engine/credit-packages';
import { VIDEO_ENGINE_CONSTANTS } from '../../../../lib/video-engine/constants';

// ─── Input sanitizers for new preference fields ───────────────────────────────
// These return null (not undefined) so the spread pattern omits them cleanly,
// letting the DB DEFAULT apply rather than writing explicit null.

const VALID_ASPECT_RATIOS = new Set(['9:16', '4:5', '1:1', '16:9', '3:4']);
const VALID_CAPTION_STYLES = new Set([
  'karaoke', 'bold_drop', 'box_pop', 'classic', 'color_pop', 'focus_word',
]);

function sanitizeAspectRatio(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (VALID_ASPECT_RATIOS.has(trimmed)) return trimmed;
  // Allow custom W:H strings with positive integers
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (w > 0 && h > 0 && w <= 9999 && h <= 9999) return trimmed;
  }
  return null;
}

function sanitizeCaptionStyle(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return VALID_CAPTION_STYLES.has(trimmed) ? trimmed : null;
}

function sanitizeClipCount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw), 10);
  if (isNaN(n) || n < 1 || n > 20) return null;
  return n;
}

function sanitizeDuration(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw), 10);
  // Floor is 15 to match Pack 1's MIN_CLIP_SECONDS — not 10
  if (isNaN(n) || n < 15 || n > 600) return null;
  return n;
}

function sanitizeText(raw: unknown, maxLength = 500): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

// ─── Zod schema (url + platform only — new fields handled by sanitizers) ─────

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

  // Parse raw body once so both Zod and the sanitizers can read from it.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(rawBody);
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

  // Sanitize new optional preference fields
  const raw = rawBody as Record<string, unknown>;
  const aspectRatio     = sanitizeAspectRatio(raw.aspect_ratio);
  const captionStyle    = sanitizeCaptionStyle(raw.caption_style);
  const clipCountTarget = sanitizeClipCount(raw.clip_count_target);
  const minDuration     = sanitizeDuration(raw.min_duration_secs);
  const maxDuration     = sanitizeDuration(raw.max_duration_secs);
  const specificMoments = sanitizeText(raw.specific_moments, 500);

  // Cross-field validation: min must be less than max when both are provided
  if (minDuration !== null && maxDuration !== null && minDuration >= maxDuration) {
    return errorResponse(
      'min_duration_secs must be less than max_duration_secs',
      'INVALID_DURATION_RANGE',
      400,
    );
  }

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

  // Spread pattern: only include non-null fields so DB DEFAULT applies to missing ones.
  // Including explicit null would override DEFAULT '9:16' / DEFAULT 'karaoke' with null.
  const { data: newJob, error: insertError } = await supabaseAdmin
    .from('video_jobs')
    .insert({
      user_id: user.id,
      source_url: url,
      source_platform: platform,
      status: 'queued',
      ...(aspectRatio     !== null && { aspect_ratio:       aspectRatio     }),
      ...(captionStyle    !== null && { caption_style:      captionStyle    }),
      ...(clipCountTarget !== null && { clip_count_target:  clipCountTarget }),
      ...(minDuration     !== null && { min_duration_secs:  minDuration     }),
      ...(maxDuration     !== null && { max_duration_secs:  maxDuration     }),
      ...(specificMoments !== null && { specific_moments:   specificMoments }),
    })
    .select('id, status, created_at, aspect_ratio, caption_style, clip_count_target, min_duration_secs, max_duration_secs, specific_moments')
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
      job_id:            newJob.id,
      status:            newJob.status,
      created_at:        newJob.created_at,
      aspect_ratio:      newJob.aspect_ratio,
      caption_style:     newJob.caption_style,
      clip_count_target: newJob.clip_count_target,
      min_duration_secs: newJob.min_duration_secs,
      max_duration_secs: newJob.max_duration_secs,
      specific_moments:  newJob.specific_moments,
      credits_remaining: creditsData.balance,
      worker_notified:   workerNotified,
    },
    201,
  );
}
