// src/app/api/video/clips/[id]/refresh-url/route.ts
// Generates a fresh 48-hour signed URL for an expired clip.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '../../../../../../lib/video-engine/auth-helpers';
import { supabaseAdmin } from '../../../../../../lib/video-engine/supabase-admin';

const SIGNED_URL_EXPIRY = 172800;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { id } = await context.params;

  const { data: clip, error: clipError } = await supabaseAdmin
    .from('video_clips')
    .select('id, storage_path, render_status, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (clipError || !clip) {
    return errorResponse('Clip not found.', 'CLIP_NOT_FOUND', 404);
  }

  if (!clip.storage_path) {
    return errorResponse(
      'This clip has not been rendered yet and has no file to link to.',
      'NO_STORAGE_PATH',
      400,
    );
  }

  if (clip.render_status !== 'complete') {
    return errorResponse(
      `Clip is not ready. Current render status: ${clip.render_status}`,
      'CLIP_NOT_READY',
      400,
    );
  }

  const { data: signedData, error: signError } = await supabaseAdmin.storage
    .from('video-clips')
    .createSignedUrl(clip.storage_path, SIGNED_URL_EXPIRY);

  if (signError || !signedData?.signedUrl) {
    console.error('[RefreshUrl] Signed URL generation failed:', signError);
    return errorResponse(
      'Failed to generate a new link for this clip. Please try again.',
      'SIGN_FAILED',
      500,
    );
  }

  await supabaseAdmin
    .from('video_clips')
    .update({ public_url: signedData.signedUrl, updated_at: new Date().toISOString() })
    .eq('id', clip.id);

  return successResponse({
    url: signedData.signedUrl,
    expires_in_seconds: SIGNED_URL_EXPIRY,
  });
}
