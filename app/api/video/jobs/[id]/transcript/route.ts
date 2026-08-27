// app/api/video/jobs/[id]/transcript/route.ts
// Download a job's transcript as plain text.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A job can run the whole pipeline, charge nothing back, and produce zero clips
// — the source had music and room noise but no sustained speech, so the
// analyser found nothing worth cutting. That is a legitimate outcome, and until
// now the person walked away with literally nothing.
//
// The transcript was produced anyway. It is sitting in `video_transcripts`,
// written by the transcribe stage, read by the analyse stage, and surfaced to
// the user nowhere. Handing it over costs one query and turns a dead end into
// something the person can use.
//
// It is also the honest thing to offer on a zero-clip job: we did the work, we
// charged for the minutes, and this is what the work produced.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { safeEntryName } from '@/lib/video-engine/zip-stream';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type WordSegment = { word?: string; text?: string; start?: number; end?: number };

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Rebuild readable, timestamped paragraphs from word-level segments.
 *
 * WhisperX returns one entry per word, which is what the clip selector needs
 * and what a person absolutely cannot read. Words are gathered into blocks of
 * roughly 30 seconds, each stamped with where it starts, so the text can be
 * scanned against the video.
 */
function paragraphsFromWords(words: WordSegment[]): string {
  const BLOCK_SECONDS = 30;
  const lines: string[] = [];
  let blockStart: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const stamp = blockStart === null ? '' : `[${formatTimestamp(blockStart)}] `;
    lines.push(`${stamp}${buffer.join(' ').replace(/\s+/g, ' ').trim()}`);
    buffer = [];
  };

  for (const entry of words) {
    const token = (entry.word ?? entry.text ?? '').trim();
    if (!token) continue;
    const start = typeof entry.start === 'number' ? entry.start : null;

    if (blockStart === null && start !== null) blockStart = start;
    if (start !== null && blockStart !== null && start - blockStart >= BLOCK_SECONDS) {
      flush();
      blockStart = start;
    }
    buffer.push(token);
  }

  flush();
  return lines.join('\n\n');
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const { id: jobId } = await context.params;

  const { data: job, error: jobError } = await supabaseAdmin
    .from('video_jobs')
    .select('id, source_title, source_url, source_duration_secs, created_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (jobError || !job) return errorResponse('Job not found.', 'JOB_NOT_FOUND', 404);

  // Scoped by job_id, which is already proven to belong to this user above.
  // `user_id` on this table is nullable by design (the worker upserts without
  // it — see video-worker/migrations.sql), so it cannot be the access check.
  const { data: transcript, error: transcriptError } = await supabaseAdmin
    .from('video_transcripts')
    .select('full_text, word_segments, detected_language, language, duration')
    .eq('job_id', jobId)
    .maybeSingle();

  if (transcriptError) {
    console.error('[VideoTranscript] Fetch failed:', transcriptError);
    return errorResponse('Could not read the transcript.', 'TRANSCRIPT_FETCH_FAILED', 500);
  }

  if (!transcript) {
    return errorResponse(
      'This job has no transcript. It did not reach the transcribing stage.',
      'NO_TRANSCRIPT',
      404,
    );
  }

  const words: WordSegment[] = Array.isArray(transcript.word_segments) ? transcript.word_segments : [];
  const body = words.length > 0
    ? paragraphsFromWords(words)
    : String(transcript.full_text ?? '').trim();

  if (!body) {
    return errorResponse(
      'The transcript for this job came back empty — the source had no detectable speech.',
      'TRANSCRIPT_EMPTY',
      404,
    );
  }

  const language = transcript.detected_language || transcript.language || 'unknown';
  const header = [
    job.source_title || 'Untitled video',
    `Source: ${job.source_url}`,
    `Language: ${language}`,
    job.source_duration_secs ? `Duration: ${formatTimestamp(job.source_duration_secs)}` : null,
    '',
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const filename = `${safeEntryName(job.source_title ?? '', `transcript-${jobId.slice(0, 8)}`)}.txt`;

  return new Response(`${header}${body}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="transcript.txt"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
