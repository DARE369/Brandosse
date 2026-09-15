// src/calendar/scheduleSeed.js
//
// One answer to "what date and time should the picker open on, and is the value
// the user chose actually sendable?" Pure functions, no I/O, no React — so the
// rules can be tested directly rather than through a modal.
//
// ── The defect this replaces ────────────────────────────────────────────────
// ScheduleModal seeded an existing post's picker from UTC parts:
//
//     new Date(post.scheduled_at).toISOString().slice(0, 10)   // UTC date
//     d.getUTCHours()                                          // UTC hour
//
// while its own banner promised "All times below are in your account timezone",
// and its caller converted the result back with
// zonedDateTimeToUTC(dateKey, timeStr, timezone) — which reads those values as
// ACCOUNT-TIMEZONE wall clock.
//
// So for any account not on UTC, opening "Reschedule…" and pressing Confirm
// WITHOUT TOUCHING ANYTHING moved the post by the zone's offset, and moved it
// again on every reopen. At WAT (UTC+1) a post at 10:00 displayed as 09:00 and
// saved as 08:00Z. That is silent content movement of the kind Law 3 forbids,
// and it is invisible in a UTC-only test environment — which is exactly why the
// round trip is asserted in schedule-seed.test.mjs rather than eyeballed.
//
// ── The floor ───────────────────────────────────────────────────────────────
// The dispatcher is a cron job registered '* * * * *'
// (20260710140000_create_process_scheduled_posts.sql), so anything scheduled
// less than a minute out is a lie about precision the product cannot keep.
// Ten minutes is the figure because Facebook's API refuses a
// scheduled_publish_time closer than that (PLATFORM-PUBLISH-FIELDS.md §5), and
// one floor everywhere beats a per-platform floor the user has to learn.
//
// This floor governs the PICKER only. "Publish now" deliberately writes
// scheduled_at = now(), which is below the floor by design — it is not a
// scheduling choice, it is a send.
// Explicit .js extension so this module is importable by `node` directly, not
// only through the bundler — which is what lets schedule-seed.test.mjs exercise
// the real rules instead of a copy of them. Same reason publishability.js does it.
import {
  getZonedParts,
  getZonedTodayKey,
  zonedDateTimeToUTC,
} from '../utils/timezone.js';

/** Minutes a scheduled time must clear, measured from now. See the header. */
export const SCHEDULE_FLOOR_MINUTES = 10;

/** Granularity the picker snaps to. Users think in 5s; the worker runs each minute. */
export const SCHEDULE_STEP_MINUTES = 5;

const pad2 = (n) => String(n).padStart(2, '0');

const partsToSeed = (p) => ({
  dateKey: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
  timeStr: `${pad2(p.hour)}:${pad2(p.minute)}`,
});

/**
 * Where the picker should open for an EXISTING post: the instant it is already
 * scheduled for, expressed in the account timezone — the same frame its caller
 * will read the values back in.
 *
 * @returns {{dateKey: string, timeStr: string}}
 */
export function seedFromPost(post, timezone, nowMs = Date.now()) {
  if (!post?.scheduled_at) return seedFromNow(timezone, nowMs);
  return partsToSeed(getZonedParts(post.scheduled_at, timezone));
}

/**
 * Where the picker should open for a NEW post: the clock at open, rounded UP to
 * the next step, and never closer than the floor.
 *
 * Rounding UP rather than down matters — rounding down produces a time already
 * in the past, which the dispatcher sends on its very next pass. The user
 * scheduled something and it left immediately.
 *
 * Replaces a hardcoded '09:00', which was in the past for most of the working
 * day and produced exactly that.
 *
 * @returns {{dateKey: string, timeStr: string}}
 */
export function seedFromNow(timezone, nowMs = Date.now()) {
  // Round the wall-clock minute UP to the next step. Carrying into the next
  // hour — and the next day, month or year — is done by re-deriving from the
  // INSTANT rather than by arithmetic on the parts, so month ends, leap days
  // and DST shifts stay the platform's problem rather than ours.
  const roundUp = (ms) => {
    const parts = getZonedParts(new Date(ms).toISOString(), timezone);
    const remainder = parts.minute % SCHEDULE_STEP_MINUTES;
    if (remainder === 0) return partsToSeed(parts);
    const bumped = ms + (SCHEDULE_STEP_MINUTES - remainder) * 60_000;
    return partsToSeed(getZonedParts(new Date(bumped).toISOString(), timezone));
  };

  let attemptMs = nowMs + SCHEDULE_FLOOR_MINUTES * 60_000;

  // ── Why this is a loop and not one calculation ────────────────────────────
  //
  // During the REPEATED hour of a fall-back, a wall clock is ambiguous: "01:05"
  // names two real instants an hour apart, and zonedDateTimeToUTC resolves it
  // to the earlier one. So a seed computed inside that hour can convert back to
  // an instant BEFORE now — the picker would open on a time it then refuses,
  // which reads as the product being broken rather than as a calendar subtlety.
  // Live example: America/New_York at 2026-11-01T05:55Z seeded "01:05", which
  // resolved to 05:05Z — fifty minutes in the past.
  //
  // Stepping forward until the seed's own resolved instant clears the floor is
  // the fix, and it costs nothing on the ~8759 hours a year that are not
  // ambiguous, where the first attempt already passes. Bounded at two hours'
  // worth of steps: no real transition repeats more than one hour, and a
  // bounded loop cannot hang the composer if a zone database ever disagrees.
  const maxAttempts = Math.ceil(120 / SCHEDULE_STEP_MINUTES);
  for (let i = 0; i < maxAttempts; i += 1) {
    const seed = roundUp(attemptMs);
    const resolvedISO = zonedDateTimeToUTC(seed.dateKey, seed.timeStr, timezone);
    const resolvedMs = resolvedISO ? new Date(resolvedISO).getTime() : NaN;
    if (Number.isFinite(resolvedMs) && resolvedMs - nowMs >= SCHEDULE_FLOOR_MINUTES * 60_000) {
      return seed;
    }
    attemptMs += SCHEDULE_STEP_MINUTES * 60_000;
  }

  // Unreachable for any real zone. Returning the last attempt rather than
  // throwing keeps the composer open: a slightly-off default the user can
  // correct beats a modal that will not render.
  return roundUp(attemptMs);
}

/**
 * Is this picked wall-clock value far enough out to be sendable?
 *
 * Deliberately evaluated on the resolved INSTANT, not on the wall-clock parts.
 * Across a DST transition the same wall clock can be nearer or further than it
 * looks — on a spring-forward day "02:30" may not exist at all — and only the
 * instant says what will actually happen.
 *
 * @returns {{ok: boolean, instantISO: string|null, minutesAway: number|null, reason: string}}
 */
export function checkScheduleFloor(dateKey, timeStr, timezone, nowMs = Date.now()) {
  if (!dateKey || !timeStr) {
    return { ok: false, instantISO: null, minutesAway: null, reason: 'Pick a date and a time.' };
  }
  const instantISO = zonedDateTimeToUTC(dateKey, timeStr, timezone);
  if (!instantISO) {
    return { ok: false, instantISO: null, minutesAway: null, reason: 'That date and time could not be read.' };
  }
  const minutesAway = (new Date(instantISO).getTime() - nowMs) / 60_000;
  if (minutesAway < SCHEDULE_FLOOR_MINUTES) {
    return {
      ok: false,
      instantISO,
      minutesAway,
      // Says what to do, and why the limit exists, rather than just refusing.
      reason: minutesAway < 0
        ? `That time has already passed in ${timezone}. Pick a time at least ${SCHEDULE_FLOOR_MINUTES} minutes from now, or use Publish now.`
        : `Scheduling needs at least ${SCHEDULE_FLOOR_MINUTES} minutes' notice. Pick a later time, or use Publish now to send it straight away.`,
    };
  }
  return { ok: true, instantISO, minutesAway, reason: '' };
}

/** Today in the account timezone — re-exported so callers need one import. */
export function todayKeyFor(timezone) {
  return getZonedTodayKey(timezone);
}
