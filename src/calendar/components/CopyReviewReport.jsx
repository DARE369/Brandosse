"use client";

// CopyReviewReport — the copy review as it stood when the post published.
//
// Shown in two places, from this one component so they can never disagree:
//   * the publish receipt, as each destination confirms;
//   * the post's details panel, permanently.
//
// It renders workflow_state.copy_review.final and nothing else. That record is
// written once, by the finalize-copy-reviews worker, after the post publishes,
// and never rewritten — so what this shows today is what it will show in a
// year. There is deliberately no "re-score" control here: a report that can be
// changed after the fact is not a record of the point of publishing.
//
// "Copy review", not "discovery" — LOCK L5.11. The score reads only the post's
// own text; it is not a reach prediction and is never labelled as one.
import { finalReportState, measuredMetrics, readCopyReview } from "../copyReview";
import { bandFor } from "../discoveryScore";

function scoreTone(v) {
  if (v === null || v === undefined) return "var(--uiv2-text-tertiary)";
  if (v >= 80) return "var(--uiv2-success)";
  if (v >= 60) return "var(--uiv2-warning)";
  return "var(--uiv2-danger)";
}

function formatWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CopyReviewReport({ post, compact = false }) {
  const state = finalReportState(post);
  const { final } = readCopyReview(post);

  if (state === "not_applicable") return null;

  const wrap = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: compact ? 10 : 12,
    borderRadius: 10,
    border: "1px solid var(--uiv2-border)",
    background: "var(--uiv2-bg-inset)",
  };
  const muted = { fontSize: 12, color: "var(--uiv2-text-secondary)", margin: 0 };

  if (state === "pending") {
    return (
      <div style={wrap} data-copy-review="pending">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>
          Copy review at publish
        </span>
        <p style={muted} role="status" aria-live="polite">
          Being taken now. It is recorded once and then kept with this post permanently.
        </p>
      </div>
    );
  }

  if (state === "overdue") {
    return (
      <div style={wrap} data-copy-review="overdue">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>
          Copy review at publish — not recorded yet
        </span>
        <p style={muted}>
          It is normally recorded within minutes of publishing, and this one is overdue. The post
          itself is unaffected. If this persists, the review job is not running.
        </p>
      </div>
    );
  }

  if (state === "not_recorded") {
    return (
      <div style={wrap} data-copy-review="not_recorded">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>
          Copy review at publish
        </span>
        <p style={muted}>
          No review was recorded when this published — it went out before reviews were kept with
          each post. One will not be added now, because a review taken today would not describe the
          moment it published.
        </p>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div style={wrap} data-copy-review="unavailable">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>
          Copy review at publish — not recorded
        </span>
        <p style={muted}>
          This post published normally, but its copy could not be reviewed: {final?.reason || "no reason was recorded"}.
          Nothing about the post itself was affected.
        </p>
      </div>
    );
  }

  const result = final.result || {};
  const overall = result.overall;
  const band = bandFor(overall);
  const metrics = measuredMetrics(result);
  const hook = metrics.find((m) => m.key === "hookStrength");
  const others = metrics.filter((m) => m.key !== "hookStrength");
  const frozenAt = formatWhen(final.frozen_at);
  const unmeasured = metrics.filter((m) => !m.measured).length;

  return (
    <div style={wrap} data-copy-review="frozen">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>
          Copy review at publish
        </span>
        <span style={{ fontSize: 20, fontWeight: 700, color: scoreTone(overall) }}>
          {overall ?? "—"}
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--uiv2-text-secondary)", marginLeft: 6 }}>
            {band.label}
          </span>
        </span>
      </div>

      {/* Hook strength first and larger: whether the opening line earns the
          rest of the caption is the metric the fold preview is also about. */}
      {hook && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 130, fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>Hook strength</span>
          {hook.measured ? (
            <>
              <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--uiv2-bg-elevated)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(0, Math.min(100, hook.value))}%`, height: "100%", background: scoreTone(hook.value) }} />
              </div>
              <span style={{ width: 28, textAlign: "right", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--uiv2-font-mono)" }}>{hook.value}</span>
            </>
          ) : (
            <span style={muted}>Not measured</span>
          )}
        </div>
      )}

      {!compact && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {others.map((m) => (
            <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
              <span style={{ width: 130, color: "var(--uiv2-text-secondary)" }}>{m.label}</span>
              {m.measured ? (
                <>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--uiv2-bg-elevated)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, m.value))}%`, height: "100%", background: scoreTone(m.value) }} />
                  </div>
                  <span style={{ width: 28, textAlign: "right", fontFamily: "var(--uiv2-font-mono)" }}>{m.value}</span>
                </>
              ) : (
                // Never a zero bar. A metric the reviewer did not return was not
                // measured, and drawing it as 0 would be a reading nobody took.
                <span style={{ color: "var(--uiv2-text-tertiary)" }}>Not measured</span>
              )}
            </div>
          ))}
        </div>
      )}

      {!compact && Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
          {result.suggestions.slice(0, 4).map((s) => (
            <li key={s} style={{ fontSize: 12, color: "var(--uiv2-text-secondary)" }}>{s}</li>
          ))}
        </ul>
      )}

      <p style={{ ...muted, fontSize: 11, color: "var(--uiv2-text-tertiary)" }}>
        {final.source === "composer"
          ? "Your review from the composer — the text did not change before it published, so it was kept rather than re-run."
          : "Reviewed when it published."}
        {frozenAt ? ` Recorded ${frozenAt}.` : ""}
        {" "}This record does not change.
        {unmeasured > 0 && metrics.some((m) => m.coverageKnown) ? ` ${unmeasured} metric${unmeasured === 1 ? " was" : "s were"} not returned by the reviewer.` : ""}
        {metrics.every((m) => !m.coverageKnown) ? " Taken before per-metric coverage was recorded, so a 0 may mean not measured." : ""}
      </p>
    </div>
  );
}
