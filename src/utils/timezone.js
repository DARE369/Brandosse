// Small Intl-only timezone helpers for the personal calendar.
// No date library exists in this repo (no date-fns-tz/luxon/dayjs) — these
// cover exactly the two things the calendar needs: format an instant in an
// arbitrary IANA zone, and convert a picked wall-clock date+time in an
// arbitrary zone into the correct UTC instant for storage.
//
// Calendar day-columns/cells are keyed by 'YYYY-MM-DD' strings (computed in
// the user's zone) rather than ambiguous local Date objects, so day-bucketing
// can't silently drift if the browser's zone differs from the user's stored
// preference.

export const DEFAULT_TIMEZONE = 'UTC';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatInTimeZone(iso, timeZone = DEFAULT_TIMEZONE, options = {}) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

// Numeric calendar/clock fields for `iso`, as read in `timeZone`.
export function getZonedParts(iso, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(iso);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map = {};
  for (const { type, value } of dtf.formatToParts(date)) map[type] = value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: map.weekday,
  };
}

// 'YYYY-MM-DD' for whichever calendar day `iso` falls on in `timeZone`.
export function getZonedDateKey(iso, timeZone = DEFAULT_TIMEZONE) {
  const { year, month, day } = getZonedParts(iso, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// 'YYYY-MM-DD' for "today" in `timeZone`.
export function getZonedTodayKey(timeZone = DEFAULT_TIMEZONE) {
  return getZonedDateKey(new Date().toISOString(), timeZone);
}

// Shift a 'YYYY-MM-DD' key by N days. Pure calendar-date arithmetic — anchored
// at UTC midnight purely as a neutral integer-day representation, never
// mixed with zone-aware reads, so this carries no real-world-instant meaning.
export function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + days);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function addMonthsToDateKey(dateKey, months) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + months, d));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-01`;
}

// 0 (Mon) .. 6 (Sun) for a 'YYYY-MM-DD' key, independent of any real zone.
export function dateKeyWeekdayIndex(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 6 : dow - 1; // 0=Mon..6=Sun
}

// Monday-anchored key for the week containing `dateKey`.
export function weekStartKeyFor(dateKey) {
  return addDaysToDateKey(dateKey, -dateKeyWeekdayIndex(dateKey));
}

// First-of-month key for the month containing `dateKey`.
export function monthStartKeyFor(dateKey) {
  const [y, m] = dateKey.split('-').map(Number);
  return `${y}-${pad2(m)}-01`;
}

// Format a bare 'YYYY-MM-DD' key for display (weekday/month/day labels etc.)
// without ever reintroducing zone ambiguity — the key is already the correct
// calendar day, so it's formatted as UTC so no local shift can move it.
export function formatDateKey(dateKey, options = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)), // noon UTC — clear of any rollover
  );
}

export function isSameDateKey(isoOrKey, dateKey, timeZone = DEFAULT_TIMEZONE) {
  const key = isoOrKey.includes('T') || isoOrKey.length > 10
    ? getZonedDateKey(isoOrKey, timeZone)
    : isoOrKey;
  return key === dateKey;
}

// Convert a picked wall-clock `dateStr` ('YYYY-MM-DD') + `timeStr` ('HH:MM')
// in `timeZone` into the correct UTC instant, returned as an ISO string.
// Standard Intl-only offset-detection recipe: guess the instant by treating
// the wall-clock value as if it were UTC, read back what that guess displays
// as in the target zone, then correct by the difference.
export function zonedDateTimeToUTC(dateStr, timeStr, timeZone = DEFAULT_TIMEZONE) {
  if (!dateStr || !timeStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const naiveMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  if (timeZone === 'UTC') return new Date(naiveMs).toISOString();

  const offsetMinutes = getOffsetMinutes(new Date(naiveMs), timeZone);
  return new Date(naiveMs - offsetMinutes * 60000).toISOString();
}

// Offset (minutes) such that zonedWallClock = utcInstant + offset, evaluated
// near `date`. For example America/New_York in January => -300.
function getOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = {};
  for (const { type, value } of dtf.formatToParts(date)) map[type] = value;
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  );
  return (asUTC - date.getTime()) / 60000;
}

// Combine a date-key + hour (0-23) into the correct UTC instant for `timeZone`.
export function zonedDateKeyAndHourToUTC(dateKey, hour, timeZone = DEFAULT_TIMEZONE) {
  return zonedDateTimeToUTC(dateKey, `${pad2(hour)}:00`, timeZone);
}
