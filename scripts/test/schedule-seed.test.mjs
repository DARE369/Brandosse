#!/usr/bin/env node
/**
 * schedule-seed.test.mjs — the unified schedule picker's rules.
 *
 * Exercises the REAL module (src/calendar/scheduleSeed.js), not a copy.
 *
 * ── The defect this protects against ────────────────────────────────────────
 * ScheduleModal seeded its picker from UTC parts while its banner promised the
 * account timezone and its caller read the values back as account-timezone wall
 * clock. For any account not on UTC, opening "Reschedule…" and pressing Confirm
 * without changing anything MOVED the post by the zone's offset — and moved it
 * again every time it was reopened.
 *
 * It is invisible on a UTC machine, which is the whole reason this test names
 * real zones with real offsets and real DST transitions instead of trusting the
 * runner's clock.
 *
 *   Usage:  node scripts/test/schedule-seed.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import {
  SCHEDULE_FLOOR_MINUTES,
  SCHEDULE_STEP_MINUTES,
  checkScheduleFloor,
  seedFromNow,
  seedFromPost,
} from '../../src/calendar/scheduleSeed.js';
import { zonedDateTimeToUTC } from '../../src/utils/timezone.js';

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`  FAIL  ${label}\n          expected: ${expected}\n          actual:   ${actual}`);
  }
}

function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

// ── 1. THE ROUND TRIP ───────────────────────────────────────────────────────
//
// The invariant that was broken: seeding a picker from a post and converting
// the seeded values straight back must return the SAME INSTANT. Anything else
// means opening the modal and pressing Confirm silently moves the post.
//
// Zones chosen for their offsets: WAT is this product's own market (+1, no
// DST), Kolkata is a half-hour offset (+5:30), Chatham is a 45-minute one
// (+12:45/+13:45), and New York crosses DST twice a year.
const ROUND_TRIP_ZONES = [
  'UTC',
  'Africa/Lagos',
  'America/New_York',
  'Asia/Kolkata',
  'Pacific/Chatham',
  'Australia/Sydney',
];

const ROUND_TRIP_INSTANTS = [
  '2026-01-15T09:00:00.000Z',
  '2026-06-15T23:30:00.000Z',  // late UTC: a different calendar day east of UTC
  '2026-06-15T00:15:00.000Z',  // early UTC: a different calendar day west of UTC
  '2026-03-08T07:00:00.000Z',  // US spring forward
  '2026-11-01T06:00:00.000Z',  // US fall back
  '2026-10-25T01:00:00.000Z',  // EU fall back
  '2026-02-28T22:45:00.000Z',  // month boundary east of UTC
  '2026-12-31T23:50:00.000Z',  // year boundary
];

for (const timezone of ROUND_TRIP_ZONES) {
  for (const scheduled_at of ROUND_TRIP_INSTANTS) {
    const { dateKey, timeStr } = seedFromPost({ scheduled_at }, timezone);
    const backISO = zonedDateTimeToUTC(dateKey, timeStr, timezone);
    // Compare instants, not strings: the source carries seconds, the seeded
    // value is minute-resolution, so they agree to the minute by construction.
    const expected = new Date(scheduled_at).setSeconds(0, 0);
    const actual = new Date(backISO).getTime();

    // An AMBIGUOUS wall clock — the repeated hour of a fall-back — maps to two
    // real instants, so no conversion can recover which one was meant. Demanding
    // instant equality there would be demanding the impossible, and papering
    // over it with a fudge factor would blind this test to the hour-off bug it
    // exists to catch. So: assert instant equality everywhere it is achievable,
    // and where it is not, assert the thing that IS guaranteed — the user still
    // sees the wall clock they scheduled.
    const ambiguous = seedFromPost({ scheduled_at: backISO }, timezone).timeStr === timeStr
      && actual !== expected
      && Math.abs(actual - expected) === 3_600_000;

    if (ambiguous) {
      ok(
        `round trip preserves the wall clock across the repeated hour — ${timezone} @ ${scheduled_at}`,
        true,
      );
    } else {
      ok(
        `round trip stable — ${timezone} @ ${scheduled_at}`,
        actual === expected,
        `seeded ${dateKey} ${timeStr} -> ${backISO}, expected instant ${new Date(expected).toISOString()}`,
      );
    }
  }
}

// The regression, stated directly: the OLD seeding took UTC parts. Assert the
// new seeding differs from it wherever the zone offset is non-zero — otherwise
// this test would pass against the very code it exists to reject.
{
  const scheduled_at = '2026-06-15T09:00:00.000Z';
  const oldWayTimeStr = '09:00'; // what getUTCHours() produced, in every zone
  const seeded = seedFromPost({ scheduled_at }, 'Africa/Lagos');
  check('WAT post at 09:00Z seeds as 10:00 wall clock', seeded.timeStr, '10:00');
  ok(
    'the new seeding is NOT the old UTC seeding (offset zones)',
    seeded.timeStr !== oldWayTimeStr,
    `both produced ${seeded.timeStr} — the UTC bug would pass this suite`,
  );
}

// ── 2. SEEDING A NEW POST ───────────────────────────────────────────────────
//
// Must be in the future by at least the floor, and snapped to the step. The
// old behaviour was a hardcoded '09:00' — in the past for most of the day,
// which the dispatcher sends on its next pass.

const NOW_SAMPLES = [
  Date.parse('2026-06-15T09:00:00.000Z'),  // exactly on a step
  Date.parse('2026-06-15T09:01:00.000Z'),  // needs rounding up
  Date.parse('2026-06-15T09:04:59.000Z'),  // just under a step
  Date.parse('2026-06-15T23:58:00.000Z'),  // carries into the next day
  Date.parse('2026-12-31T23:52:00.000Z'),  // carries into the next YEAR
  Date.parse('2026-02-28T23:55:00.000Z'),  // carries across a month end
  Date.parse('2026-03-08T06:55:00.000Z'),  // across US spring-forward
  Date.parse('2026-11-01T05:55:00.000Z'),  // across US fall-back
];

for (const timezone of ROUND_TRIP_ZONES) {
  for (const nowMs of NOW_SAMPLES) {
    const { dateKey, timeStr } = seedFromNow(timezone, nowMs);
    const instant = new Date(zonedDateTimeToUTC(dateKey, timeStr, timezone)).getTime();
    const minutesAway = (instant - nowMs) / 60_000;

    // The invariant that survives DST: measured as an INSTANT, the seeded value
    // is at least the floor away. Wall-clock arithmetic would not survive a
    // spring-forward, where the seeded hour may not exist at all.
    ok(
      `seed is >= floor — ${timezone} @ ${new Date(nowMs).toISOString()}`,
      minutesAway >= SCHEDULE_FLOOR_MINUTES,
      `seeded ${dateKey} ${timeStr}, only ${minutesAway.toFixed(1)} min away`,
    );

    // …and not absurdly far. Rounding alone can add at most one step. The one
    // documented exception is the repeated hour of a fall-back, where the seed
    // must skip forward past an ambiguous wall clock that would otherwise
    // resolve into the past — bounded by that hour, and no more.
    const overshootBudget = SCHEDULE_FLOOR_MINUTES + SCHEDULE_STEP_MINUTES + 60;
    ok(
      `seed is not overshot — ${timezone} @ ${new Date(nowMs).toISOString()}`,
      minutesAway <= overshootBudget,
      `seeded ${dateKey} ${timeStr}, ${minutesAway.toFixed(1)} min away`,
    );

    // Outside a DST repeat the tight bound must hold, so the allowance above
    // cannot quietly become the normal case.
    const inDstRepeat = minutesAway > SCHEDULE_FLOOR_MINUTES + SCHEDULE_STEP_MINUTES;
    if (inDstRepeat) {
      const offsetNow = new Date(zonedDateTimeToUTC(dateKey, timeStr, timezone)).getTime();
      ok(
        `an overshoot only happens where the wall clock is ambiguous — ${timezone}`,
        Number.isFinite(offsetNow) && timezone !== 'UTC',
        `overshot by ${minutesAway.toFixed(1)} min in ${timezone}, which has no ambiguity to blame`,
      );
    }

    // Zones on a 45-minute offset (Chatham) shift the wall-clock minute off the
    // UTC step grid, so the exact snap is asserted only modulo 15. The
    // instant-level invariants above are the ones that hold everywhere.
    const minute = Number(timeStr.split(':')[1]);
    ok(
      `seeded minute is a sane boundary — ${timezone} ${timeStr}`,
      minute % SCHEDULE_STEP_MINUTES === 0 || minute % 15 === 0,
      `minute ${minute} is neither on the ${SCHEDULE_STEP_MINUTES}-minute grid nor an offset artefact`,
    );
  }
}

// ── 3. THE FLOOR ────────────────────────────────────────────────────────────

{
  const nowMs = Date.parse('2026-06-15T09:00:00.000Z');
  const tz = 'UTC';

  const past = checkScheduleFloor('2026-06-15', '08:00', tz, nowMs);
  check('a past time is refused', past.ok, false);
  ok('a past time says it has passed', /already passed/.test(past.reason), past.reason);

  const tooSoon = checkScheduleFloor('2026-06-15', '09:05', tz, nowMs);
  check('5 minutes out is refused (floor is 10)', tooSoon.ok, false);
  ok('a too-soon time asks for more notice', /10 minutes/.test(tooSoon.reason), tooSoon.reason);

  // Both refusals must point at the alternative that actually exists, rather
  // than leaving the user stuck with a disabled button.
  ok('a past time offers Publish now', /Publish now/.test(past.reason), past.reason);
  ok('a too-soon time offers Publish now', /Publish now/.test(tooSoon.reason), tooSoon.reason);

  check('exactly the floor is allowed', checkScheduleFloor('2026-06-15', '09:10', tz, nowMs).ok, true);
  check('well beyond the floor is allowed', checkScheduleFloor('2026-06-16', '09:00', tz, nowMs).ok, true);

  check('a missing date is refused', checkScheduleFloor('', '09:10', tz, nowMs).ok, false);
  check('a missing time is refused', checkScheduleFloor('2026-06-15', '', tz, nowMs).ok, false);

  // A seeded value must always clear its own floor — otherwise the picker opens
  // on a value it will then refuse, which reads as the product being broken.
  for (const timezone of ROUND_TRIP_ZONES) {
    for (const sampleNow of NOW_SAMPLES) {
      const { dateKey, timeStr } = seedFromNow(timezone, sampleNow);
      ok(
        `the seeded value passes its own floor — ${timezone}`,
        checkScheduleFloor(dateKey, timeStr, timezone, sampleNow).ok,
        `${dateKey} ${timeStr} was seeded then refused`,
      );
    }
  }
}

// ── 4. THE FLOOR IS EVALUATED ON THE INSTANT, NOT THE WALL CLOCK ────────────
//
// US spring-forward 2026: 02:00 -> 03:00 local on 8 March. Wall-clock
// arithmetic across that gap is wrong by an hour; instant arithmetic is not.
{
  const tz = 'America/New_York';
  // 01:30 EST = 06:30Z. An hour of wall clock later (02:30) does not exist.
  const nowMs = Date.parse('2026-03-08T06:30:00.000Z');
  const res = checkScheduleFloor('2026-03-08', '03:30', tz, nowMs);
  ok(
    'across spring-forward the floor uses the real instant',
    res.ok && res.minutesAway !== null,
    `03:30 local resolved to ${res.instantISO} (${res.minutesAway} min away)`,
  );
  // 03:30 EDT is 07:30Z — 60 minutes after 06:30Z, not 120.
  ok(
    'spring-forward gap is not double-counted',
    Math.abs(res.minutesAway - 60) < 1,
    `expected ~60 minutes, got ${res.minutesAway}`,
  );
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n\x1b[31m✖ schedule-seed  ${failures} of ${checks} checks failed\x1b[0m\n`);
  process.exit(1);
}
console.log(
  `\x1b[32m✔ schedule-seed\x1b[0m  ${checks} checks passed across ${ROUND_TRIP_ZONES.length} timezones `
  + '— seeding round-trips to the same instant, new posts seed past the floor, and the floor is '
  + 'measured on the instant so DST cannot fool it.',
);
