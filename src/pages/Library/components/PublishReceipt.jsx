"use client";

// PublishReceipt — what happened to the post, per destination, as it happens.
//
// ── Why this screen exists ──────────────────────────────────────────────────
// Before it, a publish ended in a toast and the user was left where they were.
// A multi-destination send that half-succeeded looked identical to one that
// worked, and the URL of the live post — written by the adapter into
// workflow_state.publish.platform_post_url — was read by nothing at all. That
// string appeared exactly once in the whole repository, inside a comment.
//
// ── Why it POLLS instead of asserting ───────────────────────────────────────
// Publishing is asynchronous. publish-post has exactly one caller: the cron
// worker process-scheduled-posts, registered '* * * * *'. At the moment this
// screen opens, the only true statement is "queued". Everything past that is
// read back off the rows as the worker moves them.
//
// Polling rather than realtime, deliberately: realtime needs `posts` to be in
// the database's publication, which cannot be verified from here and would fail
// SILENTLY — the screen would simply never update, which looks identical to a
// post that never sent. A poll has no such dependency. It is a handful of rows
// by primary key, every four seconds, and it stops on its own.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { Button, Modal } from "../../../ui-v2";
import { supabase } from "../../../services/supabaseClient";
import { OUTCOME, summarise } from "../../../calendar/publishOutcome";
import { finalReportState } from "../../../calendar/copyReview";
import CopyReviewReport from "../../../calendar/components/CopyReviewReport";

/**
 * Stop polling after this long. The worker runs each minute, and three retries a
 * minute apart plus slack sits comfortably inside five. Past that, something is
 * wrong that this screen cannot resolve — so it SAYS so rather than spinning
 * forever, because a spinner that never resolves is its own kind of lie.
 */
const POLL_CEILING_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

const ICON_FOR = {
  [OUTCOME.PUBLISHED]: CheckCircle2,
  [OUTCOME.FAILED]: XCircle,
  [OUTCOME.RETRYING]: RefreshCw,
  [OUTCOME.SENDING]: RefreshCw,
  [OUTCOME.QUEUED]: Clock,
  [OUTCOME.DRAFT]: Clock,
};

const TONE_COLOR = {
  success: "var(--uiv2-accent-solid)",
  warning: "var(--uiv2-accent-solid)",
  danger: "var(--uiv2-danger)",
  pending: "var(--uiv2-text-secondary)",
};

export default function PublishReceipt({ open, postIds = [], assetTitle = "", onClose, onOpenCalendar }) {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef(null);

  const fetchRows = useCallback(async () => {
    if (!postIds.length) return { done: true };
    const { data, error } = await supabase
      .from("posts")
      .select("id, platform, status, error_message, external_post_id, published_at, failed_at, workflow_state")
      .in("id", postIds);

    if (error) {
      // Surfaced, never swallowed. "We could not read the outcome" and "the post
      // failed" are different statements, and showing the second for the first
      // would have someone re-sending a post that went out perfectly well.
      console.error("[receipt] could not read post outcomes:", error.message);
      setLoadError(error.message);
      return { done: false };
    }

    setLoadError(null);
    setRows(data || []);
    // Done only when every destination has settled AND every one that published
    // has its copy review frozen — the report lands a minute or two after the
    // post does, and stopping at "published" would leave it saying "being taken"
    // until the user reopened the post. The poll ceiling still bounds this.
    const rowsNow = data || [];
    // Only `pending` is worth waiting for; overdue and not_recorded will not
    // resolve on the receipt's timescale, and each already says so in words.
    const reportsSettled = rowsNow.every((row) => finalReportState(row) !== "pending");
    return { done: summarise(rowsNow).allSettled && reportsSettled };
  }, [postIds]);

  useEffect(() => {
    if (!open || postIds.length === 0) return undefined;

    let cancelled = false;
    let timer = null;
    startedAt.current = Date.now();
    setGaveUp(false);

    const tick = async () => {
      if (cancelled) return;
      const { done } = await fetchRows();
      if (cancelled) return;

      if (done) return;                                  // every destination settled
      if (Date.now() - startedAt.current > POLL_CEILING_MS) {
        setGaveUp(true);                                 // say so; never spin silently
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, postIds, fetchRows]);

  if (!open) return null;

  const summary = summarise(rows);

  return (
    <Modal open={open} onClose={onClose} title="Where this is going" size="lg">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ── Headline ────────────────────────────────────────────────────
            summarise() owns every word of this. It will not say "Published"
            while anything is still moving, and will not say it at all unless
            every destination actually confirmed. */}
        <div
          style={{
            display: "flex", gap: 12, alignItems: "flex-start", padding: 14,
            borderRadius: 12, background: "var(--uiv2-bg-elevated)",
            border: `1px solid ${TONE_COLOR[summary.tone]}`,
          }}
        >
          <span style={{ color: TONE_COLOR[summary.tone], flexShrink: 0, marginTop: 2 }}>
            {summary.tone === "success" ? <CheckCircle2 size={20} aria-hidden="true" />
              : summary.tone === "danger" ? <XCircle size={20} aria-hidden="true" />
                : summary.tone === "warning" ? <AlertTriangle size={20} aria-hidden="true" />
                  : <Clock size={20} aria-hidden="true" />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--uiv2-text-primary)" }}>
              {summary.title}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginTop: 4 }}>
              {assetTitle ? `${assetTitle} · ` : ""}{summary.detail}
            </div>
          </div>
        </div>

        {loadError && (
          <div className="ui-field-error" role="alert">
            Could not read the latest status ({loadError}). The send itself is unaffected — it runs
            on the server, not in this tab. Open the Calendar to see where it got to.
          </div>
        )}

        {gaveUp && !summary.allSettled && (
          <div className="ui-field-error" role="alert">
            Still not confirmed after five minutes. The post has not been lost — it is on the server
            and the publisher keeps trying. That points at the dispatcher rather than at this post;
            the Calendar shows its current state.
          </div>
        )}

        {/* ── Per destination ───────────────────────────────────────────── */}
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--uiv2-text-tertiary)" }}>
          Where it is going
        </div>

        {summary.outcomes.map((o, i) => {
          const row = rows[i] || {};
          const Icon = ICON_FOR[o.state] || Clock;
          return (
            <div
              key={row.id || i}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start", padding: 12,
                borderRadius: 10, border: "1px solid var(--uiv2-border)",
                background: "var(--uiv2-bg-surface)",
              }}
            >
              <Icon
                size={16}
                aria-hidden="true"
                style={{
                  flexShrink: 0, marginTop: 2,
                  color: o.state === OUTCOME.FAILED ? "var(--uiv2-danger)" : "var(--uiv2-text-secondary)",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--uiv2-text-primary)", textTransform: "capitalize" }}>
                  {row.platform || "Destination"} · {o.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--uiv2-text-secondary)", marginTop: 3 }}>
                  {o.detail}
                </div>
                {/* A live restriction is stated ON success, not hidden by it.
                    YouTube-forced-private and TikTok SELF_ONLY are conditions
                    the platform imposes, and "Published" alone conceals them —
                    which is how someone believes they posted publicly and did
                    not. */}
                {/* The copy review as it stood at publish — shown once this
                    destination has actually published, never before, since
                    there is no "at publish" for a post still queued. */}
                {o.state === OUTCOME.PUBLISHED && (
                  <div style={{ marginTop: 8 }}>
                    <CopyReviewReport post={row} />
                  </div>
                )}
                {o.restriction && (
                  <div style={{
                    fontSize: 12, color: "var(--uiv2-text-secondary)", marginTop: 6,
                    paddingLeft: 10, borderLeft: "2px solid var(--uiv2-border)",
                  }}
                  >
                    {o.restriction}
                  </div>
                )}
              </div>
              {/* Appears only once that platform has confirmed AND returned a
                  URL — never before, and never as a dead link. */}
              {o.url && (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ui-button ui-button-secondary ui-button-sm"
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  View post <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </div>
          );
        })}

        {!summary.allSettled && (
          <div style={{ fontSize: 12, color: "var(--uiv2-text-tertiary)" }}>
            You do not have to stay on this screen. The send is queued on the server, not in this
            tab — close it and the post still goes out. Each row becomes a link the moment that
            platform confirms.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <Button onClick={onClose}>Back to Library</Button>
          <Button variant="subtle" onClick={onOpenCalendar}>Open Calendar</Button>
        </div>
      </div>
    </Modal>
  );
}
