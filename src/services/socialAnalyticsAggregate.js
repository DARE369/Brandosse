/**
 * socialAnalyticsAggregate.js — the arithmetic of the analytics surface, with
 * no I/O, so it can be tested.
 *
 * Split out of socialAnalyticsService.js on purpose: that file imports the
 * Supabase client, which cannot be loaded outside a browser, and a rule nobody
 * can execute is a rule nobody has checked. Same reasoning as the pure helpers
 * exported from supabase/functions/_shared/youtube.service.ts for its Deno
 * tests.
 *
 * Its guard is scripts/check-metric-aggregation.mjs.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Collapse daily rows into one value per metric.
 *
 * ADDITIVE metrics (views, likes, watch time) are summed over the window.
 *
 * NON-ADDITIVE metrics (average view percentage, average view duration) report
 * the LATEST day present, never a sum and never an unweighted average.
 * YouTube's averageViewPercentage for a day is already weighted by that day's
 * views; averaging those figures across days produces a number belonging to no
 * day and no video, and summing them produces "336%".
 *
 * @param {Array<{metric_key: string, metric_date: string, value: number|string}>} rows
 * @param {Map<string, {display_name?: string, unit?: string, is_additive?: boolean}>} definitionsByKey
 */
export function aggregateMetrics(rows, definitionsByKey) {
  const byKey = new Map();

  for (const row of rows || []) {
    const key = row.metric_key;
    const def = definitionsByKey?.get(key) || null;
    // Unknown metric: treated as additive, which every count-like metric is,
    // but flagged with `known: false` — an unknown key means the vocabulary
    // table and the ingestion worker have drifted apart.
    const additive = def ? Boolean(def.is_additive) : true;
    const current = byKey.get(key);

    if (!current) {
      byKey.set(key, {
        metricKey: key,
        label: def?.display_name || key.replace(/_/g, " "),
        unit: def?.unit || "count",
        additive,
        known: Boolean(def),
        value: toNumber(row.value),
        asOf: row.metric_date,
        days: 1,
      });
      continue;
    }

    current.days += 1;
    if (additive) {
      current.value += toNumber(row.value);
      if (row.metric_date > current.asOf) current.asOf = row.metric_date;
    } else if (row.metric_date > current.asOf) {
      current.value = toNumber(row.value);
      current.asOf = row.metric_date;
    }
  }

  return [...byKey.values()];
}

/**
 * Why is there nothing to show?
 *
 * Zero has four causes and they need four different responses. Returning null
 * means "there is data, render it". Order matters: the earliest true cause is
 * the one to report, because fixing it is what unblocks the next.
 */
export function describeEmptiness({ freshness, hasRows, privacyStatus }) {
  if (hasRows) return null;

  if (!freshness || !freshness.last_attempt_at) {
    return {
      reason: "never_collected",
      message:
        "No collection has run for this account yet. The collector runs every six hours; "
        + "its first pass backfills up to 90 days.",
    };
  }

  if (freshness.last_status && freshness.last_status !== "succeeded") {
    return {
      reason: "collection_failing",
      message: freshness.last_error_code
        ? `The last collection did not succeed (${freshness.last_error_code}). `
          + "Figures here would be older than they look, so none are shown."
        : "The last collection did not succeed, so no figures are shown for it.",
    };
  }

  if (privacyStatus && privacyStatus !== "public") {
    return {
      reason: "not_public",
      message:
        `Collection succeeded, but this video is ${privacyStatus} on YouTube. `
        + "YouTube reports no views, watch time or retention for a video nobody can watch — "
        + "make it public and figures appear within a day or two.",
    };
  }

  return {
    reason: "platform_reported_nothing",
    message:
      "Collection succeeded and the platform returned no figures for this period. "
      + "That usually means there has been no activity yet, not that anything is broken.",
  };
}

/** Format a metric for display, honouring its unit. */
export function formatMetricValue(metric) {
  const value = Number(metric?.value) || 0;
  switch (metric?.unit) {
    case "seconds": {
      if (value < 60) return `${Math.round(value)}s`;
      if (value < 3600) return `${Math.round(value / 60)}m`;
      const hours = value / 3600;
      return `${hours >= 100 ? Math.round(hours) : hours.toFixed(1)}h`;
    }
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return value.toFixed(2);
    default:
      return new Intl.NumberFormat("en-US").format(Math.round(value));
  }
}
