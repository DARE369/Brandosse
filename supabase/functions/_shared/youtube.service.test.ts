// supabase/functions/_shared/youtube.service.test.ts
//
// Unit tests for the pure logic in the YouTube publish adapter.
//
// ── Why these five functions ────────────────────────────────────────────────
// Everything else in the adapter needs a real upload to exercise, and no
// YouTube account has ever been connected. These five are pure, and they encode
// the rules that would otherwise be discovered by a user:
//
//   truncateBytes        — YouTube's description limit is 5000 BYTES, not
//                          characters. Getting this wrong rejects every post
//                          with an emoji-heavy caption, or worse, splits a
//                          surrogate pair and produces invalid JSON.
//   readOptions          — decides the visibility a video is published with.
//                          A bug here publishes something publicly that the
//                          user meant to keep private, which cannot be undone.
//   classifyGoogleError  — decides whether a failure is RETRIABLE. Marking a
//                          permanent failure retriable burns quota in a loop;
//                          marking a transient one permanent tells a user to
//                          reconnect a working account.
//   fitTags, sanitiseText — cheap, and both silently corrupt a post when wrong.
//
// ── No test framework import, deliberately ──────────────────────────────────
// CI pins deno-version v1.x (ci.yml) while current Deno is v2, and the standard
// library moved from deno.land/std to jsr: between them. Importing an assertion
// library would make this file pass on one and fail to resolve on the other.
// Deno.test is built in and stable across both.
//
//   Run:  deno test supabase/functions/_shared/youtube.service.test.ts

import {
  classifyGoogleError,
  classifyThumbnailError,
  fitTags,
  readOptions,
  sanitiseText,
  truncateBytes,
} from "./youtube.service.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, context: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${context}: expected ${e}, got ${a}`);
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

// ── sanitiseText ────────────────────────────────────────────────────────────

Deno.test("sanitiseText strips the angle brackets YouTube rejects", () => {
  assertEquals(sanitiseText("a<b>c"), "abc", "brackets removed");
  assertEquals(sanitiseText("<script>x</script>"), "scriptx/script", "no bracket survives");
});

Deno.test("sanitiseText trims but preserves inner whitespace and unicode", () => {
  assertEquals(sanitiseText("  hello  world  "), "hello  world", "outer trim only");
  assertEquals(sanitiseText("héllo 👋 世界"), "héllo 👋 世界", "unicode untouched");
});

// ── truncateBytes ───────────────────────────────────────────────────────────

Deno.test("truncateBytes leaves a short string alone", () => {
  assertEquals(truncateBytes("short", 5000), "short", "no truncation");
});

Deno.test("truncateBytes respects a BYTE budget, not a character count", () => {
  // Each emoji is 4 UTF-8 bytes. Ten of them is 40 bytes but only 10 code
  // points — a character-based limit would let all ten through a 20-byte cap.
  const emoji = "😀".repeat(10);
  assertEquals(byteLength(emoji), 40, "fixture is 40 bytes");

  const out = truncateBytes(emoji, 20);
  assert(byteLength(out) <= 20, `result must fit 20 bytes, got ${byteLength(out)}`);
  assertEquals(out, "😀".repeat(5), "exactly five emoji fit in 20 bytes");
});

Deno.test("truncateBytes never splits a surrogate pair", () => {
  // 21 bytes is mid-emoji. Splitting by UTF-16 unit here would emit a lone
  // surrogate, which produces invalid JSON and a Google 400 that names nothing.
  const out = truncateBytes("😀".repeat(10), 21);
  assert(byteLength(out) <= 21, "fits the budget");
  assert(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out),
    "no lone surrogate in the result",
  );
  assertEquals(out, "😀".repeat(5), "drops the whole code point");
});

Deno.test("truncateBytes handles a budget smaller than one character", () => {
  assertEquals(truncateBytes("😀", 2), "", "cannot fit, returns empty rather than looping");
});

Deno.test("truncateBytes fits YouTube's real 5000-byte description limit", () => {
  const long = "é".repeat(4000);           // 2 bytes each = 8000 bytes
  const out = truncateBytes(long, 5000);
  assert(byteLength(out) <= 5000, `must fit 5000 bytes, got ${byteLength(out)}`);
  assertEquals(out.length, 2500, "2500 two-byte characters is exactly 5000 bytes");
});

// ── readOptions ─────────────────────────────────────────────────────────────

Deno.test("readOptions defaults to private when nothing is set", () => {
  const o = readOptions(null);
  assertEquals(o.privacyStatus, "private", "safe default");
  assertEquals(o.privacyWasDefaulted, true, "the default must be reportable");
});

Deno.test("readOptions honours each valid visibility", () => {
  for (const v of ["public", "private", "unlisted"] as const) {
    const o = readOptions({ privacy_status: v });
    assertEquals(o.privacyStatus, v, `honours ${v}`);
    assertEquals(o.privacyWasDefaulted, false, `${v} is not a default`);
  }
});

Deno.test("readOptions falls back to private on a bogus visibility, and says so", () => {
  // The dangerous direction is the one that must not happen: an unrecognised
  // value must never resolve to `public`.
  for (const bad of ["PUBLIC ", "everyone", "", "true", "null"]) {
    const o = readOptions({ privacy_status: bad });
    assertEquals(o.privacyStatus, "private", `"${bad}" must not publish publicly`);
    assertEquals(o.privacyWasDefaulted, true, `"${bad}" is a defaulted value`);
  }
});

Deno.test("readOptions accepts uppercase from the platform", () => {
  assertEquals(readOptions({ privacy_status: "PUBLIC" }).privacyStatus, "public", "case-insensitive");
});

Deno.test("readOptions keeps the disclosure fields tri-state", () => {
  // null (absent) and false (a positive declaration) are different statements
  // to YouTube, and collapsing them would answer a compliance question on the
  // user's behalf.
  const absent = readOptions({});
  assertEquals(absent.madeForKids, null, "absent stays null");
  assertEquals(absent.containsSyntheticMedia, null, "absent stays null");

  const declared = readOptions({ made_for_kids: false, contains_synthetic_media: false });
  assertEquals(declared.madeForKids, false, "explicit false is preserved");
  assertEquals(declared.containsSyntheticMedia, false, "explicit false is preserved");

  const positive = readOptions({ made_for_kids: true, contains_synthetic_media: true });
  assertEquals(positive.madeForKids, true, "explicit true is preserved");
  assertEquals(positive.containsSyntheticMedia, true, "explicit true is preserved");
});

Deno.test("readOptions ignores non-boolean disclosure values", () => {
  // A string "true" is not a declaration. Coercing it would let a malformed
  // row make a compliance claim nobody made.
  const o = readOptions({ made_for_kids: "true", contains_synthetic_media: 1 });
  assertEquals(o.madeForKids, null, "string is not a boolean declaration");
  assertEquals(o.containsSyntheticMedia, null, "number is not a boolean declaration");
});

Deno.test("readOptions defaults the category and coerces tags to strings", () => {
  assertEquals(readOptions({}).categoryId, "22", "People & Blogs default");
  assertEquals(readOptions({ category_id: 24 }).categoryId, "24", "numeric id becomes a string");
  assertEquals(readOptions({ tags: ["a", 1, "", null] }).tags, ["a", "1"], "empties dropped");
  assertEquals(readOptions({ tags: "not-an-array" }).tags, [], "non-array yields no tags");
});

Deno.test("readOptions leaves thumbnailUrl absent when nothing was chosen", () => {
  // Absent must mean "no custom thumbnail" — never an empty-string URL that a
  // later fetch would try and fail on.
  assertEquals(readOptions({}).thumbnailUrl, null, "no thumbnail chosen");
  assertEquals(readOptions({ thumbnail_url: "" }).thumbnailUrl, null, "empty string is not a URL");
  assertEquals(readOptions({ thumbnail_url: "   " }).thumbnailUrl, null, "whitespace is not a URL");
});

Deno.test("readOptions passes a chosen thumbnailUrl through, trimmed", () => {
  const o = readOptions({ thumbnail_url: "  https://example.com/thumb.jpg  " });
  assertEquals(o.thumbnailUrl, "https://example.com/thumb.jpg", "trimmed, not rejected");
});

// ── fitTags ─────────────────────────────────────────────────────────────────

Deno.test("fitTags passes a small set through untouched", () => {
  assertEquals(fitTags(["one", "two"]), ["one", "two"], "well under budget");
});

Deno.test("fitTags stops at YouTube's 500-character combined budget", () => {
  const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`.padEnd(50, "x"));
  const out = fitTags(tags);
  // Each tag is 50 chars; separators count. Nine tags plus eight separators is
  // 458; a tenth would reach 509 and exceed the budget.
  const used = out.reduce((n, t) => n + t.length, 0) + Math.max(0, out.length - 1);
  assert(used <= 500, `combined length must be <= 500, got ${used}`);
  assertEquals(out.length, 9, "nine 50-character tags fit");
});

Deno.test("fitTags returns nothing when the first tag alone exceeds the budget", () => {
  assertEquals(fitTags(["x".repeat(600)]), [], "an oversized single tag is dropped, not truncated");
});

// ── classifyGoogleError ─────────────────────────────────────────────────────

const fail = (reason: string, retriable = false) => ({
  success: false as const,
  platformPostId: null,
  platformPostUrl: null,
  failureReason: reason,
  retriable,
});

function googleError(reason: string, message = "") {
  return JSON.stringify({ error: { errors: [{ reason }], message } });
}

Deno.test("classifyGoogleError marks quota exhaustion retriable and blames the app", () => {
  const r = classifyGoogleError(403, googleError("quotaExceeded"), fail);
  assertEquals(r.retriable, true, "quota resets, so a retry is meaningful");
  assert(
    /app-wide/i.test(r.failureReason ?? ""),
    "must say the limit is the app's, not the user's channel — quota is per Cloud project",
  );
});

Deno.test("classifyGoogleError does not tell a quota-blocked user to reconnect", () => {
  const r = classifyGoogleError(403, googleError("quotaExceeded"), fail);
  assert(
    !/reconnect/i.test(r.failureReason ?? ""),
    "reconnecting cannot fix a project-wide quota, and sends the user somewhere useless",
  );
});

Deno.test("classifyGoogleError distinguishes the three meanings of 403", () => {
  const perms = classifyGoogleError(403, googleError("insufficientPermissions"), fail);
  assert(/reconnect/i.test(perms.failureReason ?? ""), "a scope problem needs a reconnect");
  assertEquals(perms.retriable, false, "retrying cannot widen a granted token");

  const noChannel = classifyGoogleError(403, googleError("youtubeSignupRequired"), fail);
  assert(
    /channel/i.test(noChannel.failureReason ?? ""),
    "no channel is a YouTube-side action, not a permissions problem",
  );

  const suspended = classifyGoogleError(403, googleError("accountSuspended"), fail);
  assert(/standing/i.test(suspended.failureReason ?? ""), "suspension points at the channel");
  assertEquals(suspended.retriable, false, "a suspension does not clear on retry");
});

Deno.test("classifyGoogleError treats 401 as a credential problem", () => {
  const r = classifyGoogleError(401, "", fail);
  assert(/reconnect/i.test(r.failureReason ?? ""), "401 means the sign-in is no longer good");
  assertEquals(r.retriable, false, "a dead token does not revive on retry");
});

Deno.test("classifyGoogleError makes 5xx retriable", () => {
  for (const code of [500, 502, 503, 504]) {
    assertEquals(classifyGoogleError(code, "", fail).retriable, true, `http ${code} is transient`);
  }
});

Deno.test("classifyGoogleError leaves a 400 permanent", () => {
  // A malformed request fails identically every time. Retrying it burns quota
  // and delays the real answer.
  assertEquals(classifyGoogleError(400, googleError("invalidValue"), fail).retriable, false, "400 is ours");
});

Deno.test("classifyGoogleError survives a non-JSON error body", () => {
  const r = classifyGoogleError(502, "<html>Bad Gateway</html>", fail);
  assertEquals(r.retriable, true, "still classified by status when the body is unparseable");
  assert((r.failureReason ?? "").length > 0, "must still say something");
});

Deno.test("classifyGoogleError truncates the platform message it echoes", () => {
  // Google echoes request context into some error shapes, and this string is
  // persisted to the post's error field.
  const r = classifyGoogleError(400, googleError("invalidValue", "x".repeat(500)), fail);
  assert(
    (r.failureReason ?? "").length < 300,
    `echoed message must be bounded, got ${(r.failureReason ?? "").length} chars`,
  );
});

// ── classifyThumbnailError ───────────────────────────────────────────────────
//
// The eligibility-gate test uses the EXACT body captured live 2026-09-22 from
// a real thumbnails.set call against a real connected channel — not a guessed
// shape. That call is reproduced in full in the migration/session history; the
// body below is copied verbatim from it.

const REAL_THUMBNAIL_FORBIDDEN_BODY = JSON.stringify({
  error: {
    code: 403,
    message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails.",
    errors: [
      {
        message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails.",
        domain: "youtube.thumbnail",
        reason: "forbidden",
        location: "Authorization",
        locationType: "header",
      },
    ],
  },
});

Deno.test("classifyThumbnailError names the real, unfixable-by-us cause: channel not eligible", () => {
  const note = classifyThumbnailError(403, REAL_THUMBNAIL_FORBIDDEN_BODY);
  assert(
    /not yet eligible for custom thumbnails/i.test(note),
    `must name the eligibility gate specifically, got: ${note}`,
  );
  assert(/phone number/i.test(note), "must say HOW to fix it — phone verification");
  assert(/published/i.test(note), "must say the video itself still published");
});

Deno.test("classifyThumbnailError does not confuse this with a video-upload 403", () => {
  // The SAME reason string ("forbidden") on a DIFFERENT domain means something
  // else entirely (see classifyGoogleError's own "forbidden" branch, which is
  // about account suspension). Domain is what disambiguates it, so a 403 with
  // no youtube.thumbnail domain must not be misclassified as the eligibility gate.
  const body = JSON.stringify({ error: { errors: [{ domain: "youtube", reason: "forbidden" }] } });
  const note = classifyThumbnailError(403, body);
  assert(
    !/not yet eligible for custom thumbnails/i.test(note),
    "a bare 'forbidden' on the wrong domain must not claim it is the eligibility gate",
  );
  assert(/published/i.test(note), "still must not read as a publish failure");
});

Deno.test("classifyThumbnailError survives a non-JSON body and still says the video published", () => {
  const note = classifyThumbnailError(500, "<html>Internal Server Error</html>");
  assert(/published/i.test(note), "must not read as if the whole publish failed");
  assert(note.length > 0, "must still say something");
});

Deno.test("classifyThumbnailError never returns a failure-shaped result — it is always just a string", () => {
  // Regression guard for the mistake this function exists to prevent: reusing
  // classifyGoogleError's fail()-based shape here would make a thumbnail
  // problem look like a failed publish to any caller that checks .success.
  const note = classifyThumbnailError(403, REAL_THUMBNAIL_FORBIDDEN_BODY);
  assertEquals(typeof note, "string", "classifyThumbnailError returns a note, never a PublishResult");
});
