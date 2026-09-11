// supabase/functions/_shared/youtube.analytics.service.test.ts
//
// Unit tests for the report parsing in the YouTube Analytics adapter.
//
// ── Why these, specifically ─────────────────────────────────────────────────
// The Analytics API returns COLUMNAR data: `columnHeaders` names the columns
// and `rows` is an array of arrays with no keys. Every bug this file guards
// against is silent — the numbers still look like numbers:
//
//   * reading a column by position plots watch time as views;
//   * coercing a null to 0 turns "not reported" into "nobody watched", which
//     is the fabrication Law 3 forbids and which cannot be undone once stored;
//   * forgetting the minutes-to-seconds conversion is a 60x error that looks
//     entirely plausible on a chart;
//   * clamping audienceWatchRatio to 1 silently deletes rewatch signal, which
//     is exactly the signal worth having.
//
// None of these throw. None would be caught by a type check. They are only
// visible if something asserts the parsed values.
//
//   Run:  deno test --no-check supabase/functions/_shared/youtube.analytics.service.test.ts

import {
  chunkVideoIds,
  classifyAnalyticsError,
  headerIndex,
  parseBreakdownRows,
  parseDailyRows,
  parseRetentionRows,
  VIDEO_METRICS,
} from "./youtube.analytics.service.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, context: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${context}: expected ${e}, got ${a}`);
}

const find = (rows: Array<{ metricKey: string }>, key: string) =>
  rows.filter((r) => r.metricKey === key);

// ── headerIndex ─────────────────────────────────────────────────────────────

Deno.test("headerIndex locates a column by name, not position", () => {
  const headers = [{ name: "video" }, { name: "day" }, { name: "views" }];
  assertEquals(headerIndex(headers, "views"), 2, "found");
  assertEquals(headerIndex(headers, "likes"), -1, "absent returns -1, never 0");
});

// ── parseDailyRows ──────────────────────────────────────────────────────────

Deno.test("parseDailyRows survives YouTube reordering its columns", () => {
  // Same data, columns swapped. A positional reader would report 5 views and
  // 100 likes — plausible numbers, entirely wrong.
  const a = parseDailyRows({
    columnHeaders: [{ name: "video" }, { name: "day" }, { name: "views" }, { name: "likes" }],
    rows: [["vid1", "2026-09-10", 100, 5]],
  }, VIDEO_METRICS, { videoDimension: true });

  const b = parseDailyRows({
    columnHeaders: [{ name: "likes" }, { name: "day" }, { name: "views" }, { name: "video" }],
    rows: [[5, "2026-09-10", 100, "vid1"]],
  }, VIDEO_METRICS, { videoDimension: true });

  assertEquals(find(a, "views")[0].value, 100, "views read by name");
  assertEquals(find(b, "views")[0].value, 100, "views still 100 after reorder");
  assertEquals(find(b, "likes")[0].value, 5, "likes still 5 after reorder");
});

Deno.test("parseDailyRows converts watch time from minutes to seconds", () => {
  const rows = parseDailyRows({
    columnHeaders: [{ name: "video" }, { name: "day" }, { name: "estimatedMinutesWatched" }],
    rows: [["vid1", "2026-09-10", 10]],
  }, VIDEO_METRICS, { videoDimension: true });

  const wt = find(rows, "watch_time_seconds");
  assertEquals(wt.length, 1, "one watch-time fact");
  assertEquals(wt[0].value, 600, "10 minutes is 600 seconds, not 10");
});

Deno.test("parseDailyRows DROPS nulls rather than storing zero", () => {
  // The distinction the whole schema is built on: an absent row means "not
  // reported"; a row with 0 means "the platform reported zero". Coercing the
  // first into the second is irreversible.
  const rows = parseDailyRows({
    columnHeaders: [{ name: "video" }, { name: "day" }, { name: "views" }, { name: "likes" }],
    rows: [["vid1", "2026-09-10", null, 0]],
  }, VIDEO_METRICS, { videoDimension: true });

  assertEquals(find(rows, "views").length, 0, "null views produces NO fact row");
  assertEquals(find(rows, "likes").length, 1, "a real zero IS recorded");
  assertEquals(find(rows, "likes")[0].value, 0, "and its value is 0");
});

Deno.test("parseDailyRows rejects a malformed day", () => {
  const rows = parseDailyRows({
    columnHeaders: [{ name: "video" }, { name: "day" }, { name: "views" }],
    rows: [["vid1", "not-a-date", 10], ["vid1", "2026-09-10", 20]],
  }, VIDEO_METRICS, { videoDimension: true });

  assertEquals(rows.length, 1, "only the well-formed day survives");
  assertEquals(rows[0].metricDate, "2026-09-10", "and it is the right one");
});

Deno.test("parseDailyRows returns nothing when a required dimension is missing", () => {
  // Better to write no rows than rows attributed to the wrong video.
  const noVideo = parseDailyRows({
    columnHeaders: [{ name: "day" }, { name: "views" }],
    rows: [["2026-09-10", 10]],
  }, VIDEO_METRICS, { videoDimension: true });
  assertEquals(noVideo.length, 0, "video dimension demanded but absent");

  const noDay = parseDailyRows({
    columnHeaders: [{ name: "video" }, { name: "views" }],
    rows: [["vid1", 10]],
  }, VIDEO_METRICS, { videoDimension: true });
  assertEquals(noDay.length, 0, "day always required");
});

Deno.test("parseDailyRows handles channel-level rows with no video column", () => {
  const rows = parseDailyRows({
    columnHeaders: [{ name: "day" }, { name: "views" }],
    rows: [["2026-09-10", 4321]],
  }, VIDEO_METRICS, { videoDimension: false });

  assertEquals(rows.length, 1, "one channel fact");
  assertEquals(rows[0].platformPostId, null, "channel rows carry no post id");
  assertEquals(rows[0].value, 4321, "value preserved");
});

Deno.test("parseDailyRows tolerates an empty report", () => {
  assertEquals(parseDailyRows({}, VIDEO_METRICS, { videoDimension: true }).length, 0, "no body");
  assertEquals(
    parseDailyRows({ columnHeaders: [{ name: "day" }], rows: [] }, VIDEO_METRICS, { videoDimension: false }).length,
    0,
    "headers but no rows",
  );
});

// ── parseBreakdownRows ──────────────────────────────────────────────────────

Deno.test("parseBreakdownRows maps the dimension value and converts units", () => {
  const rows = parseBreakdownRows({
    columnHeaders: [{ name: "country" }, { name: "views" }, { name: "estimatedMinutesWatched" }],
    rows: [["NG", 500, 20], ["US", 300, 10]],
  }, "country", "country", "vid1", {
    views: { key: "views" },
    estimatedMinutesWatched: { key: "watch_time_seconds", convert: (n: number) => n * 60 },
  });

  assertEquals(rows.length, 4, "two metrics x two countries");
  const ng = rows.find((r) => r.dimensionValue === "NG" && r.metricKey === "views");
  assertEquals(ng?.value, 500, "NG views");
  const ngWatch = rows.find((r) => r.dimensionValue === "NG" && r.metricKey === "watch_time_seconds");
  assertEquals(ngWatch?.value, 1200, "20 minutes is 1200 seconds");
  assertEquals(rows[0].dimensionKey, "country", "stored under our dimension key");
});

Deno.test("parseBreakdownRows skips blank dimension values", () => {
  // An empty dimension is not a category. Storing it would create a bucket
  // labelled "" that a chart renders as a real segment.
  const rows = parseBreakdownRows({
    columnHeaders: [{ name: "country" }, { name: "views" }],
    rows: [["", 999], ["NG", 1]],
  }, "country", "country", "vid1", { views: { key: "views" } });

  assertEquals(rows.length, 1, "only the real country");
  assertEquals(rows[0].dimensionValue, "NG", "blank dropped");
});

// ── parseRetentionRows ──────────────────────────────────────────────────────

Deno.test("parseRetentionRows keeps a watch ratio above 1", () => {
  // A rewatched segment genuinely exceeds 1. Clamping would delete the single
  // most interesting signal in the curve — the bit people replay.
  const rows = parseRetentionRows({
    columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }],
    rows: [[0.1, 1.0], [0.25, 1.8]],
  }, "vid1");

  assertEquals(rows.length, 2, "both points kept");
  assertEquals(rows[1].watchRatio, 1.8, "rewatch preserved, not clamped");
});

Deno.test("parseRetentionRows drops points outside a plottable range", () => {
  const rows = parseRetentionRows({
    columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }],
    rows: [[-0.1, 0.5], [1.5, 0.5], [0.5, -1], [0.5, 0.9]],
  }, "vid1");

  assertEquals(rows.length, 1, "only the valid point survives");
  assertEquals(rows[0].elapsedRatio, 0.5, "elapsed in 0..1");
  assertEquals(rows[0].watchRatio, 0.9, "watch ratio non-negative");
});

// ── chunkVideoIds ───────────────────────────────────────────────────────────

Deno.test("chunkVideoIds respects YouTube's filter ceiling", () => {
  const ids = Array.from({ length: 450 }, (_, i) => `v${i}`);
  const chunks = chunkVideoIds(ids, 200);
  assertEquals(chunks.length, 3, "450 ids becomes three requests");
  assertEquals(chunks[0].length, 200, "full chunk");
  assertEquals(chunks[2].length, 50, "remainder");
  assertEquals(chunks.flat().length, 450, "no id is lost");
  assertEquals(chunks.flat()[449], "v449", "and order is preserved");
});

Deno.test("chunkVideoIds returns nothing for no ids", () => {
  assertEquals(chunkVideoIds([]).length, 0, "no ids, no requests");
});

// ── classifyAnalyticsError ──────────────────────────────────────────────────

const gErr = (reason: string, message = "") =>
  JSON.stringify({ error: { errors: [{ reason }], message } });

Deno.test("classifyAnalyticsError marks quota exhaustion retriable and app-wide", () => {
  const e = classifyAnalyticsError(403, gErr("quotaExceeded"));
  assertEquals(e.code, "quota_exceeded", "coded");
  assertEquals(e.retriable, true, "quota resets, so retrying tomorrow works");
  assert(/app-wide|shared/i.test(e.detail), "must say the limit is shared, not this account's fault");
});

Deno.test("classifyAnalyticsError treats a missing scope as permanent", () => {
  const e = classifyAnalyticsError(403, gErr("insufficientPermissions"));
  assertEquals(e.code, "scope_not_granted", "coded");
  assertEquals(e.retriable, false, "retrying cannot widen an already-issued token");
  assert(/reconnect/i.test(e.detail), "names the only real remedy");
});

Deno.test("classifyAnalyticsError separates 429 from other 4xx", () => {
  assertEquals(classifyAnalyticsError(429, "").code, "quota_exceeded", "rate limited is a quota problem");
  assertEquals(classifyAnalyticsError(401, "").code, "token_rejected", "401 is the credential");
  assertEquals(classifyAnalyticsError(401, "").retriable, false, "a dead token does not revive");
});

Deno.test("classifyAnalyticsError makes 5xx retriable", () => {
  for (const code of [500, 502, 503]) {
    assertEquals(classifyAnalyticsError(code, "").retriable, true, `http ${code} is transient`);
  }
});

Deno.test("classifyAnalyticsError bounds the message it persists", () => {
  // This string is written to social_ingestion_runs.error_detail, and Google
  // echoes request context into some error shapes.
  const e = classifyAnalyticsError(400, gErr("badRequest", "x".repeat(900)));
  assert(e.detail.length <= 200, `detail must be bounded, got ${e.detail.length}`);
});

Deno.test("classifyAnalyticsError survives a non-JSON body", () => {
  const e = classifyAnalyticsError(502, "<html>Bad Gateway</html>");
  assertEquals(e.retriable, true, "classified by status alone");
  assert(e.detail.length > 0, "still says something");
});
