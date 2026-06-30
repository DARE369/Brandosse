// src/app/api/video/jobs/[id]/route.ts
// GET: Returns one job with all its clips.
// DELETE: Cancels or deletes a job and removes its storage files.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { notifyJobCancelled } from '@/lib/video-engine/worker-client';

const CANCELLABLE_STATUSES = ['queued'];
const ACTIVE_STATUSES = ['queued', 'downloading', 'transcribing', 'analyzing', 'rendering'];
const SIGNED_URL_EXPIRY = 172800;

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getRouteId(context: RouteContext): Promise<string> {
  return (await context.params).id;
}

async function maybeSignClipUrl(clip: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (
    clip.storage_path &&
    (!clip.public_url || String(clip.public_url).length === 0) &&
    clip.render_status === 'complete'
  ) {
    try {
      const { data } = await supabaseAdmin.storage
        .from('video-clips')
        .createSignedUrl(String(clip.storage_path), SIGNED_URL_EXPIRY);

      return { ...clip, public_url: data?.signedUrl ?? null };
    } catch {
      return clip;
    }
  }

  return clip;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const jobId = await getRouteId(context);

  const { data: job, error } = await supabaseAdmin
    .from('video_jobs')
    .select(
      `
      *,
      clips:video_clips (
        id, clip_index, ai_title, ai_caption,
        hook_score, content_score, overall_score,
        start_time_secs, end_time_secs, duration_secs,
        storage_path, public_url, thumbnail_path, thumbnail_url,
        transcript_excerpt, platform_target, render_status,
        created_at, updated_at
      )
    `,
    )
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (error || !job) {
    return errorResponse('Job not found.', 'JOB_NOT_FOUND', 404);
  }

  const clips = await Promise.all((job.clips ?? []).map(maybeSignClipUrl));

  return successResponse({ job: { ...job, clips } });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const jobId = await getRouteId(context);

  const { data: job, error: fetchError } = await supabaseAdmin
    .from('video_jobs')
    .select('id, user_id, status, credits_consumed, source_url')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !job) {
    return errorResponse('Job not found.', 'JOB_NOT_FOUND', 404);
  }

  if (CANCELLABLE_STATUSES.includes(job.status)) {
    await notifyJobCancelled(job.id, job.user_id, job.credits_consumed ?? 0);
  } else if (ACTIVE_STATUSES.includes(job.status)) {
    return errorResponse(
      `This job is currently being processed (${job.status}) and cannot be cancelled. Wait for it to complete or fail.`,
      'JOB_PROCESSING_CANNOT_CANCEL',
      409,
    );
  }

  const storagePrefix = `${user.id}/${job.id}`;

  try {
    const { data: files } = await supabaseAdmin.storage.from('video-clips').list(storagePrefix);

    if (files && files.length > 0) {
      const filePaths = files.map((file) => `${storagePrefix}/${file.name}`);
      await supabaseAdmin.storage.from('video-clips').remove(filePaths);
    }
  } catch (storageError) {
    console.warn('[JobDelete] Storage cleanup failed for job:', job.id, storageError);
  }

  const { error: deleteError } = await supabaseAdmin
    .from('video_jobs')
    .delete()
    .eq('id', job.id)
    .eq('user_id', user.id);

  if (deleteError) {
    console.error('[JobDelete] Delete failed:', deleteError);
    return errorResponse('Failed to delete the job. Please try again.', 'DELETE_FAILED', 500);
  }

  return successResponse({ deleted_job_id: job.id });
}
