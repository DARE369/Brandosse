// src/lib/video-engine/retention.ts
// One definition of when a job's clips disappear, shared by the API and the UI.
//
// ── Why this is its own module ──────────────────────────────────────────────
// The seven-day sweep is real (video-worker/retention.py:reap_expired_clips) and
// was surfaced nowhere. Adding a countdown is only an improvement if the
// countdown is RIGHT — a wrong one is worse than none, because people will plan
// around it and lose work anyway.
//
// ── The field that matters ──────────────────────────────────────────────────
// The sweep selects on `updated_at`, NOT `processing_ended_at`:
//
//     .lt("updated_at", cutoff_iso).in_("status", TERMINAL_STATUSES)
//
// Those two columns are usually close together, but they are not the same
// thing, and `processing_ended_at` is only written on the "complete" transition
// (video-worker/database.py:90) — a FAILED job never gets one at all. Keying a
// countdown off it would show "never expires" for exactly the jobs a person is
// most likely to come back to. So: updated_at, and only updated_at.
//
// Non-terminal jobs are not counted down. A job still working is not old, it is
// slow, and the sweep deliberately ignores it.

import { VIDEO_ENGINE_CONSTANTS } from './constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses the sweep treats as terminal. Verified against the live check
 *  constraint on 2026-08-22: "complete" and "failed" are accepted;
 *  "completed", "cancelled" and "canceled" are all REJECTED. */
export const TERMINAL_STATUSES = ['complete', 'failed'] as const;

export type RetentionJobShape = {
  status?: string | null;
  updated_at?: string | null;
};

export type ClipExpiry = {
  /** Milliseconds since epoch when the sweep becomes eligible to remove this
   *  job's clip files, or null when the job is not subject to retention yet. */
  expiresAt: number | null;
  /** Milliseconds remaining, floored at 0. null when expiresAt is null. */
  msRemaining: number | null;
  /** True once the window has closed. The files may still be present — the
   *  sweep runs hourly, not continuously — so this means "gone or going",
   *  which is the only thing worth promising a user. */
  expired: boolean;
  /** True inside the final 24 hours. The design's warning threshold. */
  expiringSoon: boolean;
};

/**
 * When do this job's clips get swept?
 *
 * Returns nulls for jobs that are not terminal, that carry no timestamp, or
 * whose timestamp does not parse — every one of which means "we do not know",
 * and none of which should render as a confident number.
 */
export function clipExpiry(job: RetentionJobShape | null | undefined, now = Date.now()): ClipExpiry {
  const none: ClipExpiry = { expiresAt: null, msRemaining: null, expired: false, expiringSoon: false };

  if (!job?.status) return none;
  if (!(TERMINAL_STATUSES as readonly string[]).includes(job.status)) return none;
  if (!job.updated_at) return none;

  const settledAt = Date.parse(job.updated_at);
  if (Number.isNaN(settledAt)) return none;

  const expiresAt = settledAt + VIDEO_ENGINE_CONSTANTS.CLIP_RETENTION_DAYS * DAY_MS;
  const msRemaining = Math.max(0, expiresAt - now);

  return {
    expiresAt,
    msRemaining,
    expired: msRemaining === 0,
    expiringSoon: msRemaining > 0 && msRemaining <= DAY_MS,
  };
}

/**
 * The ISO cutoff a query can use to find jobs whose clips are inside their
 * final `withinHours`. Mirrors the sweep's own arithmetic so the two agree.
 */
export function expiringSoonCutoffIso(withinHours = 24, now = Date.now()): string {
  const windowMs = VIDEO_ENGINE_CONSTANTS.CLIP_RETENTION_DAYS * DAY_MS - withinHours * 60 * 60 * 1000;
  return new Date(now - windowMs).toISOString();
}

/**
 * "6d 21h", "22h", "48m", "Gone".
 *
 * Deliberately coarse above a day and precise below it: nobody needs minutes
 * six days out, and everybody needs them in the last hour.
 */
export function formatRemaining(msRemaining: number | null): string | null {
  if (msRemaining === null) return null;
  if (msRemaining <= 0) return 'Gone';

  const totalMinutes = Math.floor(msRemaining / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
