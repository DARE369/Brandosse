#!/usr/bin/env node
/**
 * check-metric-aggregation.mjs — the guard for the analytics surface's numbers.
 *
 * ── What can go wrong here, and why a test is the only way to catch it ──────
 * The analytics page renders figures a user will act on. Two failure modes
 * would both look completely normal on screen:
 *
 *   1. SUMMING A NON-ADDITIVE METRIC. `averageViewPercentage` is a per-day
 *      figure already weighted by that day's views. Summed across a 30-day
 *      window it produces things like "1,440%"; averaged unweighted it produces
 *      a number belonging to no day and no video. Either renders as a
 *      plausible-looking percentage.
 *
 *   2. AN EMPTY RESULT THAT DOES NOT EXPLAIN ITSELF. Zero rows means one of
 *      four different things — never collected, collection failing, video not
 *      public, or genuinely no activity — and three of them are not "0 views".
 *      Rendering "0" for all four is a confident lie.
 *
 * Neither is visible in review, and neither throws. So the arithmetic lives in
 * src/services/socialAnalyticsAggregate.js with no I/O, and this runs it.
 *
 *   Usage:  node scripts/check-metric-aggregation.mjs
 *   Exit 0 = all assertions pass. Exit 1 = a finding.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_PATH = path.join(
  process.cwd(),
  "src",
  "services",
  "socialAnalyticsAggregate.js",
);

let mod;
try {
  mod = await import(pathToFileURL(MODULE_PATH).href);
} catch (error) {
  console.error("check-metric-aggregation: FAIL — could not load");
  console.error(`  ${MODULE_PATH}`);
  console.error(`  ${error.message}`);
  console.error("  The analytics arithmetic must stay free of I/O so it can be executed here.");
  process.exit(1);
}

const { aggregateMetrics, describeEmptiness, formatMetricValue } = mod;

const failures = [];
function check(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`,
    );
  }
}

const DEFS = new Map([
  ["views", { display_name: "Views", unit: "count", is_additive: true }],
  ["watch_time_seconds", { display_name: "Watch time", unit: "seconds", is_additive: true }],
  ["avg_view_percentage", { display_name: "Average viewed", unit: "percent", is_additive: false }],
]);

/* ── 1. Additive metrics sum over the window ─────────────────────────────── */

const additive = aggregateMetrics(
  [
    { metric_key: "views", metric_date: "2026-09-15", value: 10 },
    { metric_key: "views", metric_date: "2026-09-16", value: 25 },
    { metric_key: "views", metric_date: "2026-09-17", value: 7 },
  ],
  DEFS,
);
check("views over three days must sum", additive[0]?.value, 42);
check("a summed metric reports its latest day", additive[0]?.asOf, "2026-09-17");

/* ── 2. Non-additive metrics take the LATEST day, never a sum ────────────── */

const nonAdditive = aggregateMetrics(
  [
    { metric_key: "avg_view_percentage", metric_date: "2026-09-15", value: 41.2 },
    { metric_key: "avg_view_percentage", metric_date: "2026-09-17", value: 48.6 },
    { metric_key: "avg_view_percentage", metric_date: "2026-09-16", value: 44.9 },
  ],
  DEFS,
);
check("average viewed must be the latest day, not a sum", nonAdditive[0]?.value, 48.6);
check("and must say which day it belongs to", nonAdditive[0]?.asOf, "2026-09-17");
if (Number(nonAdditive[0]?.value) > 100) {
  failures.push("a percentage metric aggregated above 100% — it is being summed");
}

/* ── 3. Rows out of date order must not change the answer ────────────────── */

const shuffled = aggregateMetrics(
  [
    { metric_key: "avg_view_percentage", metric_date: "2026-09-17", value: 48.6 },
    { metric_key: "avg_view_percentage", metric_date: "2026-09-15", value: 41.2 },
  ],
  DEFS,
);
check("latest-day logic must not depend on row order", shuffled[0]?.value, 48.6);

/* ── 4. An unknown metric is flagged, not silently trusted ───────────────── */

const unknown = aggregateMetrics(
  [{ metric_key: "mystery_metric", metric_date: "2026-09-17", value: 3 }],
  DEFS,
);
check("an unknown metric key is marked as unknown", unknown[0]?.known, false);

/* ── 5. Empty results explain themselves, differently each time ──────────── */

const cases = [
  {
    label: "no collection has ever run",
    input: { freshness: null, hasRows: false },
    reason: "never_collected",
  },
  {
    label: "the last collection failed",
    input: {
      freshness: {
        last_attempt_at: "2026-09-18T06:00:00Z",
        last_status: "failed",
        last_error_code: "api_not_enabled",
      },
      hasRows: false,
    },
    reason: "collection_failing",
  },
  {
    label: "the video is private",
    input: {
      freshness: { last_attempt_at: "2026-09-18T06:00:00Z", last_status: "succeeded" },
      hasRows: false,
      privacyStatus: "private",
    },
    reason: "not_public",
  },
  {
    label: "collected fine, nothing happened",
    input: {
      freshness: { last_attempt_at: "2026-09-18T06:00:00Z", last_status: "succeeded" },
      hasRows: false,
      privacyStatus: "public",
    },
    reason: "platform_reported_nothing",
  },
];

const seenMessages = new Set();
for (const c of cases) {
  const result = describeEmptiness(c.input);
  check(`empty state: ${c.label}`, result?.reason, c.reason);
  if (result?.message) seenMessages.add(result.message);
}
if (seenMessages.size !== cases.length) {
  failures.push(
    `the four empty states produced ${seenMessages.size} distinct message(s). `
      + "Distinct causes that read identically are the defect this check exists for.",
  );
}

check("data present means no empty state", describeEmptiness({ hasRows: true }), null);

/* ── 6. Units are formatted as their unit, not as raw numbers ────────────── */

check("seconds under a minute", formatMetricValue({ unit: "seconds", value: 45 }), "45s");
check("seconds to minutes", formatMetricValue({ unit: "seconds", value: 600 }), "10m");
check("seconds to hours", formatMetricValue({ unit: "seconds", value: 7200 }), "2.0h");
check("percent keeps one decimal", formatMetricValue({ unit: "percent", value: 48.64 }), "48.6%");
check("counts are grouped", formatMetricValue({ unit: "count", value: 12345 }), "12,345");

/* ── Report ──────────────────────────────────────────────────────────────── */

if (failures.length === 0) {
  console.log("check-metric-aggregation: PASS");
  console.log("  additive metrics sum, non-additive metrics report their latest day,");
  console.log("  and all four empty states say something different.");
  process.exit(0);
}

console.error(`check-metric-aggregation: FAIL — ${failures.length} finding(s)\n`);
for (const f of failures) console.error(`  ✗ ${f}\n`);
console.error("  These figures are read by users and acted on. A wrong one looks exactly");
console.error("  like a right one on screen, which is why this runs in CI.");
process.exit(1);
