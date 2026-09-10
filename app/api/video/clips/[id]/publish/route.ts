// app/api/video/clips/[id]/publish/route.ts
//
// Turns a rendered video clip into a draft post the publisher can actually see.
//
// ── The gap this closes ─────────────────────────────────────────────────────
// The clipping pipeline writes to `video_clips`. The publisher reads media from
// `posts -> generations.output_url / storage_path` (publish-post/index.ts).
// Nothing joined the two: the only reference to video_clips outside the video
// pipeline was a realtime subscription used to refresh the dashboard.
//
// So every clip this product renders was unpublishable — not by a bug, but
// because the link was never built. That blocks YouTube and TikTok equally,
// since both require video and neither could reach one.
//
// ── Why a generations row rather than teaching the publisher about clips ────
// `generations` is already the publisher's media contract, and it is already
// what the scheduler, the composer and the calendar read. Teaching every one of
// those about a second media table would multiply the surface that has to know
// where a video lives. One adapter row keeps the contract at one.
//
// ── output_url is deliberately NULL ─────────────────────────────────────────
// The `video-clips` bucket is PRIVATE, so its URLs are signed and expire.
// Writing a signed URL here would look like it worked and then rot: a post
// scheduled three weeks out would carry a signature that died days earlier, and
// the publish would fail with a storage 400 that names nothing.
//
// Instead this stores the PATH plus the bucket, and publish-post mints a
// short-lived signed URL seconds before the upload. The durable fact is the
// path; the credential is made fresh each time.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';

/** The bucket clips are rendered into. Recorded on the generation so the
 *  publisher knows where to sign, rather than guessing from the path shape. */
const CLIP_BUCKET = 'video-clips';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { id } = await context.params;

  // ── The clip must exist, belong to the caller, and be finished ────────────
  //
  // Ownership is enforced with an explicit user_id match rather than trusted
  // from RLS: this route holds the service-role client, which bypasses RLS
  // entirely. Omitting it would let any authenticated user publish any other
  // user's clip by guessing an id.
  const { data: clip, error: clipError } = await supabaseAdmin
    .from('video_clips')
    .select('id, storage_path, render_status, user_id, ai_title, ai_caption, duration_secs, file_size_bytes')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (clipError || !clip) {
    return errorResponse('Clip not found.', 'CLIP_NOT_FOUND', 404);
  }

  if (clip.render_status !== 'complete') {
    return errorResponse(
      `This clip is not ready yet (render status: ${clip.render_status}). `
      + 'Publishing it now would upload nothing.',
      'CLIP_NOT_READY',
      400,
    );
  }

  if (!clip.storage_path) {
    return errorResponse(
      'This clip reports itself as rendered but has no file behind it. '
      + 'That is a fault on our side, not something you can fix by retrying.',
      'NO_STORAGE_PATH',
      500,
    );
  }

  // ── Idempotency ───────────────────────────────────────────────────────────
  //
  // Two clicks on "publish this clip" must not produce two drafts. The existing
  // draft is returned instead, so the second click lands the user on the same
  // post rather than silently forking their work into a copy they will not
  // notice until one of them publishes.
  const { data: existing } = await supabaseAdmin
    .from('generations')
    .select('id')
    .eq('user_id', user.id)
    .contains('metadata', { source_clip_id: clip.id })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data: priorPost } = await supabaseAdmin
      .from('posts')
      .select('id')
      .eq('generation_id', existing.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (priorPost?.id) {
      return successResponse({
        postId: priorPost.id,
        generationId: existing.id,
        reused: true,
        message: 'This clip already has a draft post.',
      });
    }
  }

  // ── 1. The media row ──────────────────────────────────────────────────────
  const title = (clip.ai_title || '').trim() || 'Untitled clip';
  const caption = (clip.ai_caption || '').trim() || title;

  const { data: generation, error: genError } = await supabaseAdmin
    .from('generations')
    .insert({
      user_id: user.id,
      media_type: 'video',
      status: 'completed',
      storage_path: clip.storage_path,
      // NULL on purpose — see the header. The publisher signs the path fresh.
      output_url: null,
      prompt: title,
      metadata: {
        storage_bucket: CLIP_BUCKET,
        source_clip_id: clip.id,
        duration_secs: clip.duration_secs,
        file_size_bytes: clip.file_size_bytes,
        created_by: 'clip-publish-bridge',
      },
    })
    .select('id')
    .single();

  if (genError || !generation?.id) {
    console.error('[clip-publish] generation insert failed:', genError);
    return errorResponse(
      'Could not prepare this clip for publishing.',
      'GENERATION_INSERT_FAILED',
      500,
    );
  }

  // ── 2. The draft post — created by a TRIGGER, not by us ───────────────────
  //
  // ensure_draft_post_for_generation() (migration 20260227103000) fires on any
  // generations insert with status = 'completed' and writes the draft post
  // itself, with caption = prompt and account_id NULL.
  //
  // An explicit insert here therefore COLLIDES with it:
  //   duplicate key value violates unique constraint
  //   "idx_posts_unique_draft_per_generation_account"
  //
  // That is exactly what the first run of this route did. The lesson is the one
  // CLAUDE.md leads with — check the caller. The draft already exists; this
  // adopts it and fills in what the trigger cannot know: a title, and the clip's
  // own caption rather than the prompt.
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('posts')
    .select('id')
    .eq('generation_id', generation.id)
    .eq('user_id', user.id)
    .eq('status', 'draft')
    .limit(1)
    .maybeSingle();

  if (draftError) {
    console.error('[clip-publish] could not read the auto-created draft:', draftError);
  }

  let postId: string | undefined = draft?.id;

  if (postId) {
    // The trigger sets caption = prompt and has no notion of a title. Both
    // matter downstream: YouTube uses the title as the video title, and a
    // caption that is really a prompt reads like machine output on the video
    // page.
    const { error: updErr } = await supabaseAdmin
      .from('posts')
      .update({ title, caption, updated_at: new Date().toISOString() })
      .eq('id', postId);

    if (updErr) {
      // Not fatal — the post exists and is publishable, it just carries the
      // prompt as its caption. Reported rather than swallowed.
      console.error('[clip-publish] draft update failed:', updErr);
    }
  } else {
    // The trigger did not fire. It bails when status is not 'completed', and we
    // always write 'completed' — so reaching here means the trigger was changed
    // or dropped. Create the post rather than leaving a generation the user can
    // never reach, and say so loudly.
    console.error(
      '[clip-publish] no auto-draft found for generation '
      + `${generation.id} — ensure_draft_post_for_generation may have been removed.`,
    );

    const { data: manual, error: postError } = await supabaseAdmin
      .from('posts')
      .insert({ user_id: user.id, generation_id: generation.id, status: 'draft', title, caption })
      .select('id')
      .single();

    if (postError || !manual?.id) {
      // Compensate: a generation with no post is an orphan the user cannot see,
      // and half-written state is this repository's signature defect.
      console.error('[clip-publish] post insert failed, rolling back generation:', postError);
      await supabaseAdmin.from('generations').delete().eq('id', generation.id);
      return errorResponse(
        'Could not create a draft post for this clip.',
        'POST_INSERT_FAILED',
        500,
      );
    }
    postId = manual.id;
  }

  return successResponse({
    postId,
    generationId: generation.id,
    reused: false,
    title,
    // Surfaced so the caller can tell the user what will actually be uploaded,
    // rather than discovering the size at publish time.
    durationSeconds: clip.duration_secs,
    fileSizeBytes: clip.file_size_bytes,
  });
}
