// app/api/video/jobs/[id]/archive/route.ts
// "Download all" — every rendered clip in one ZIP.
//
// ── Why a server route and not N browser downloads ──────────────────────────
// Triggering seven downloads from a click works for about two of them; browsers
// treat the rest as unsolicited and block them silently. The user is left with
// an incomplete set and no error. One response is one download.
//
// ── Streaming, not buffering ────────────────────────────────────────────────
// Clip bytes are never held here. Each object is opened one at a time from a
// signed URL and its body is piped straight through the ZIP writer, so memory
// stays flat whether the job produced two clips or fifteen. See
// src/lib/video-engine/zip-stream.ts for why STORE and data descriptors.
//
// ── Partial success is normal ───────────────────────────────────────────────
// Clip files are swept 7 days after a job settles (video-worker/retention.py),
// and the sweep removes files ahead of rows in the general case. So an entry
// whose object is already gone is an ordinary outcome, not an error: it is
// skipped, the rest of the archive is still valid, and the count of what was
// skipped comes back in a response header rather than corrupting the download.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { VIDEO_ENGINE_CONSTANTS } from '@/lib/video-engine/constants';
import { buildZipStream, safeEntryName, type ZipEntry } from '@/lib/video-engine/zip-stream';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Short-lived: this URL is used within milliseconds, by us, and never leaves
 *  the server. It does not need the 48-hour lifetime a browser-facing clip link
 *  gets. */
const INTERNAL_SIGNED_URL_TTL_SECONDS = 300;

/**
 * The `clips` query parameter, as a list of ids — or null when the caller wants
 * the whole job.
 *
 * Capped, because the parameter decides how many objects this response opens.
 * A job cannot hold more than MAX_CLIPS_PER_JOB anyway, so the cap refuses
 * nothing a real selection can ask for.
 */
const MAX_SELECTION = 64;

function parseClipSelection(raw: string | null): string[] | null {
  if (raw === null) return null;
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-fA-F-]{8,64}$/.test(value));
  return Array.from(new Set(ids)).slice(0, MAX_SELECTION);
}

/** ASCII-only filename for the Content-Disposition `filename` parameter; the
 *  UTF-8 original is carried alongside it in `filename*`. */
function asciiFallback(name: string): string {
  return (
    Array.from(name)
      .map((ch) => ((ch.codePointAt(0) ?? 0) < 128 ? ch : '-'))
      .join('')
      .replace(/["\\]/g, '-')
      .trim() || 'clips.zip'
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { id: jobId } = await context.params;

  const { data: job, error: jobError } = await supabaseAdmin
    .from('video_jobs')
    .select('id, source_title, status, updated_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  // Same shape for "not yours" and "does not exist" — knowing which is which
  // would let someone probe for valid job ids.
  if (jobError || !job) return errorResponse('Job not found.', 'JOB_NOT_FOUND', 404);

  // A subset selection, when the caller asked for specific clips rather than
  // all of them. Ids are matched against this job's own clips by the query
  // below, so an id belonging to someone else simply matches nothing — the
  // filter cannot widen what the user_id/job_id predicates already allow.
  const selection = parseClipSelection(request.nextUrl.searchParams.get('clips'));
  if (selection && selection.length === 0) {
    return errorResponse('No valid clip ids were given.', 'EMPTY_SELECTION', 400);
  }

  let clipQuery = supabaseAdmin
    .from('video_clips')
    .select('id, clip_index, ai_title, storage_path, render_status, overall_score')
    .eq('job_id', jobId)
    .eq('user_id', user.id)
    .eq('render_status', 'complete');

  if (selection) clipQuery = clipQuery.in('id', selection);

  const { data: clips, error: clipsError } = await clipQuery.order('overall_score', {
    ascending: false,
    nullsFirst: false,
  });

  if (clipsError) {
    console.error('[VideoArchive] Clip list failed:', clipsError);
    return errorResponse('Could not read this job’s clips.', 'CLIPS_FETCH_FAILED', 500);
  }

  const rendered = (clips ?? []).filter((clip) => clip.storage_path);

  if (rendered.length === 0) {
    // These messages used to explain the absence with the 7-day expiry. That
    // expiry was removed on 2026-09-01, so the only way a rendered clip has no
    // file now is that someone deleted it — saying anything about a retention
    // window would be inventing a cause.
    return errorResponse(
      selection
        ? 'None of those clips have a file to download any more. They may have been deleted.'
        : 'This job has no rendered clips to download. They may have been deleted.',
      'NO_CLIPS_TO_ARCHIVE',
      404,
    );
  }

  // Rank-prefixed so the archive preserves the ordering the product's whole
  // claim rests on. Unzipped alphabetically, "01-" still comes first.
  const used = new Set<string>();
  const entries: ZipEntry[] = rendered.map((clip, index) => {
    const rank = String(index + 1).padStart(2, '0');
    const base = safeEntryName(clip.ai_title ?? '', `clip-${(clip.clip_index ?? index) + 1}`);
    let name = `${rank}-${base}.mp4`;
    // Two clips can share an AI title. Duplicate names inside a ZIP are legal
    // but extract over each other, which loses a clip silently.
    let dedupe = 2;
    while (used.has(name)) {
      name = `${rank}-${base}-${dedupe}.mp4`;
      dedupe += 1;
    }
    used.add(name);

    return {
      name,
      open: async () => {
        const { data, error } = await supabaseAdmin.storage
          .from(VIDEO_ENGINE_CONSTANTS.CLIPS_BUCKET)
          .createSignedUrl(String(clip.storage_path), INTERNAL_SIGNED_URL_TTL_SECONDS);

        if (error || !data?.signedUrl) return null;

        const response = await fetch(data.signedUrl);
        if (!response.ok || !response.body) return null;
        return response.body as ReadableStream<Uint8Array>;
      },
    };
  });

  const skipped: string[] = [];

  const archive = buildZipStream(entries, {
    modifiedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
    onSkip: (name, reason) => {
      skipped.push(name);
      console.warn('[VideoArchive] Skipped entry', { jobId, name, reason });
    },
  });

  const label = safeEntryName(job.source_title ?? '', `clips-${jobId.slice(0, 8)}`);
  const filename = selection ? `${label}-selection.zip` : `${label}.zip`;

  return new Response(archive, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition':
        `attachment; filename="${asciiFallback(filename)}"; `
        + `filename*=UTF-8''${encodeURIComponent(filename)}`,
      // The length is genuinely unknown until the last clip has streamed, and
      // guessing it would truncate the download. Chunked it is.
      'Cache-Control': 'no-store',
      // How many clips this archive ATTEMPTS. Not how many it contains.
      //
      // There is no honest header for the latter: response headers flush before
      // the first byte of the body, and an entry is only discovered to be
      // missing when the writer reaches it. An `X-Archive-Partial` computed here
      // would read "false" on every response including the partial ones — a
      // header asserting a fact it cannot have, which is the exact defect this
      // rebuild exists to remove. Skips are logged server-side; the client
      // compares this count against the entry count in the downloaded file if it
      // needs certainty.
      'X-Clip-Count': String(entries.length),
    },
  });
}
