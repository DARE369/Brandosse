"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { AppShell, Button, EmptyState, Skeleton, useUiV2Toast } from "../../ui-v2";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { useJobsFeed } from "../../hooks/video-engine/useJobsFeed";
import { useWorkerHealth } from "../../hooks/video-engine/useWorkerHealth";
import { deleteVideoJob } from "../../services/videoEngineApi";
import { clipExpiry, formatRemaining } from "../../lib/video-engine/retention";
import { NewJobSheet } from "./components/NewJobSheet";
import { formatAge, formatClockTime, formatTimecode, jobTitle, resolveJobState, sourceLabel } from "./videoShared";
import styles from "./VideosPage.module.css";

/**
 * The Videos landing screen: what is running, what is finished, can I start
 * another.
 *
 * Replaces VideoJobsPage, which fetched once on mount with no realtime and no
 * polling — so the single most common action on this product (submit, return to
 * the list, wait) showed "In Queue" forever. Live state now comes from
 * useJobsFeed, along with the capacity numbers that let the interface state its
 * limits before a person hits them.
 */

/**
 * The four filters from the design.
 *
 * A fifth — "No clips" — was drafted and pulled. The STATE exists (a finished
 * job that produced nothing is labelled "No clips" rather than "Complete"), but
 * it cannot be FILTERED correctly: video_jobs stores no clip count, so the
 * server cannot page or count that set without a schema change. A filter whose
 * total is wrong is worse than no filter, and inventing one the design did not
 * ask for is not the place to spend a migration.
 */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

/** How long a deleted job can be brought back. The request is held for this
 *  window rather than fired and reversed, because the server delete removes
 *  storage files and cannot be undone once it lands. */
const UNDO_WINDOW_MS = 8000;

/**
 * AppShell mounts the toast provider, so anything that calls `useUiV2Toast`
 * has to be a CHILD of it. The page component's only job is therefore to render
 * the shell; all the state and behaviour live one level down in VideosBody.
 */
export default function VideosPage() {
  return (
    <AppShell activeKey="video" mainClassName={styles.main}>
      <VideosBody />
    </AppShell>
  );
}

function VideosBody() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const { show: toast } = useUiV2Toast();
  const workerStatus = useWorkerHealth();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [sheetOpen, setSheetOpen] = useState(false);

  const searchRef = useRef(null);
  const pendingDeletes = useRef(new Map());

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 280);
    return () => clearTimeout(id);
  }, [query]);

  // /app/video/new redirects here with ?new=1. The parameter is consumed
  // immediately so a reload does not reopen a sheet the person already closed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;

    setSheetOpen(true);
    params.delete("new");
    const remaining = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${remaining ? `?${remaining}` : ""}`);
  }, []);

  const feed = useJobsFeed({ q: debouncedQuery, status: filter, sort });
  const {
    jobs, capacity, total, hasMore, loading, loadingMore, error, isStale,
    page, totalPages, reload, loadMore, goToPage, removeJobLocally,
  } = feed;

  // ── Keyboard model ────────────────────────────────────────────────────────
  // These users sit in a triage loop for hours. N and / are the two verbs that
  // start everything else.
  useEffect(() => {
    function onKey(event) {
      const tag = (event.target?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || event.target?.isContentEditable;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === "n" || event.key === "N") && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setSheetOpen(true);
      } else if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Any delete still inside its undo window when the page unmounts must still
  // happen — the person asked for it and took no undo.
  useEffect(() => {
    const inFlight = pendingDeletes.current;
    return () => {
      for (const { commit, timer } of inFlight.values()) {
        clearTimeout(timer);
        commit();
      }
      inFlight.clear();
    };
  }, []);

  const handleDelete = useCallback(
    (job) => {
      const restore = removeJobLocally(job.id);
      let cancelled = false;

      const commit = async () => {
        if (cancelled) return;
        pendingDeletes.current.delete(job.id);
        try {
          await deleteVideoJob(job.id);
        } catch (deleteError) {
          restore();
          // The server refuses to delete a job that is actively processing
          // (409). That is a permanent refusal for now, not a transient error,
          // so it must not read as "try again".
          toast(deleteError?.message || "Could not delete that job.", { tone: "danger", duration: 6000 });
        }
      };

      const timer = setTimeout(commit, UNDO_WINDOW_MS);
      pendingDeletes.current.set(job.id, { commit, timer });

      toast(`Deleted "${jobTitle(job)}".`, {
        tone: "info",
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            cancelled = true;
            clearTimeout(timer);
            pendingDeletes.current.delete(job.id);
            restore();
          },
        },
      });
    },
    [removeJobLocally, toast],
  );

  const resultLabel = useMemo(() => {
    if (loading) return "";
    if (debouncedQuery || filter !== "all") return `${jobs.length} of ${total}`;
    return `${total} ${total === 1 ? "job" : "jobs"}`;
  }, [loading, debouncedQuery, filter, jobs.length, total]);

  return (
    <>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Videos</h1>
            <p className={styles.subtitle}>
              One long video in. Short vertical clips out, ranked by how well they should land.
            </p>
          </div>
          <div className={styles.headerActions}>
            {/* Shown only when the worker is KNOWN to be asleep. "unknown" says
                nothing — an unverified warning trains people to ignore the one
                that matters. */}
            {workerStatus === "asleep" ? (
              <span
                className={styles.sleepChip}
                title="The processor powers down when idle. Submitting wakes it, which adds about half a minute."
              >
                <span className={styles.dotWarning} aria-hidden="true" />
                Processor asleep · +30s
              </span>
            ) : null}
            <Button onClick={() => setSheetOpen(true)}>
              <Plus size={15} aria-hidden="true" /> New job
              <kbd className={styles.kbd}>N</kbd>
            </Button>
          </div>
        </header>

        <CapacityStrip capacity={capacity} loading={loading && !capacity} />

        {isStale ? (
          <div className={styles.staleBanner} role="status">
            <span className={styles.dotWarning} aria-hidden="true" />
            <p>Live updates dropped, so these states may be behind. Your jobs are still running.</p>
            <Button size="sm" variant="subtle" onClick={reload}>Refresh now</Button>
          </div>
        ) : null}

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sources"
              aria-label="Search your videos"
            />
            <kbd className={styles.kbd}>/</kbd>
          </label>

          <div className={styles.segmented} role="tablist" aria-label="Filter by state">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={filter === option.key}
                className={filter === option.key ? styles.segmentActive : styles.segment}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <select
            className={styles.sort}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>

          <span className={styles.resultCount}>{resultLabel}</span>
        </div>

        <div className={styles.table}>
          <div className={`${styles.row} ${styles.headRow}`} aria-hidden="true">
            <span>State</span>
            <span>Source</span>
            <span className={styles.colLength}>Length</span>
            <span className={styles.colClips}>Clips</span>
            <span className={styles.colExpiry}>Clips expire</span>
            <span className={styles.colAge} />
          </div>

          {loading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.row}>
                <Skeleton width="86px" height="11px" />
                <Skeleton width={`${45 + ((index * 13) % 40)}%`} height="11px" />
                <Skeleton width="52px" height="11px" className={styles.colLength} />
                <Skeleton width="24px" height="11px" className={styles.colClips} />
                <Skeleton width="48px" height="11px" className={styles.colExpiry} />
                <span className={styles.colAge} />
              </div>
            ))
          ) : error ? (
            <EmptyState
              title="We couldn't load your job list"
              description={`${error} This affects the display only — anything processing is still processing, and no credits are involved.`}
              actions={<Button onClick={reload}><RefreshCw size={15} aria-hidden="true" /> Try again</Button>}
            />
          ) : jobs.length === 0 ? (
            debouncedQuery || filter !== "all" ? (
              <EmptyState
                title="Nothing matches"
                description="No jobs match that search and filter."
                actions={
                  <Button variant="subtle" onClick={() => { setQuery(""); setFilter("all"); }}>
                    Clear search and filter
                  </Button>
                }
              />
            ) : (
              <EmptyState
                dashed
                title="Nothing here yet"
                description={
                  "Hand over a podcast, webinar, interview, or stream. We transcribe it, find the moments worth cutting, "
                  + "and send back short vertical clips with captions burned in — ranked best first. It costs "
                  + `${capacity?.credits_per_source_minute ?? 1} credit per minute of source video. `
                  + "Uploading a file always works; pasting a link usually does."
                }
                actions={<Button onClick={() => setSheetOpen(true)}>Start your first job</Button>}
              />
            )
          ) : (
            <>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} onOpen={() => navigate(`/app/video/jobs/${job.id}`)} onDelete={handleDelete} />
              ))}
              {hasMore || totalPages > 1 ? (
                <div className={styles.moreRow}>
                  <span className={styles.mono}>
                    SHOWING {jobs.length} OF {total}
                    {totalPages > 1 ? ` · PAGE ${page} OF ${totalPages}` : ""}
                  </span>

                  <div className={styles.pager}>
                    {hasMore ? (
                      <Button size="sm" variant="subtle" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? "Loading…" : "Load more"}
                      </Button>
                    ) : null}

                    {totalPages > 1 ? (
                      <nav className={styles.pageNav} aria-label="Job list pages">
                        <button
                          type="button"
                          className={styles.pageStep}
                          onClick={() => goToPage(page - 1)}
                          disabled={page <= 1}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={14} aria-hidden="true" />
                        </button>

                        {pageNumbers(page, totalPages).map((entry, index) =>
                          entry === "gap" ? (
                            // eslint-disable-next-line react/no-array-index-key
                            <span key={`gap-${index}`} className={styles.pageGap} aria-hidden="true">…</span>
                          ) : (
                            <button
                              key={entry}
                              type="button"
                              className={entry === page ? styles.pageNumActive : styles.pageNum}
                              onClick={() => goToPage(entry)}
                              aria-current={entry === page ? "page" : undefined}
                              aria-label={`Page ${entry}`}
                            >
                              {entry}
                            </button>
                          ),
                        )}

                        <button
                          type="button"
                          className={styles.pageStep}
                          onClick={() => goToPage(page + 1)}
                          disabled={page >= totalPages}
                          aria-label="Next page"
                        >
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      </nav>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <p className={styles.shortcuts}>
          <span>N new job</span>
          <span>/ search</span>
          <span>Esc clear</span>
        </p>
      </div>

      <NewJobSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        capacity={capacity}
        userId={user?.id ?? null}
        onSubmitted={(jobId) => {
          setSheetOpen(false);
          navigate(`/app/video/jobs/${jobId}`);
        }}
      />
    </>
  );
}

/**
 * First, last, and a window around the current page, with gaps between.
 * A flat list of every page is unusable past about a dozen; this keeps the
 * control a fixed width whether there are 3 pages or 300.
 */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);

  const out = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push("gap");
    out.push(value);
    previous = value;
  }
  return out;
}

/** Slots, hourly usage, balance, and what is about to be deleted — the four
 *  numbers that decide whether a person can start another job right now. */
function CapacityStrip({ capacity, loading }) {
  if (loading) {
    return (
      <div className={styles.capacity}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={styles.capacityCell}>
            <Skeleton width="90px" height="9px" />
            <Skeleton width="60px" height="14px" style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!capacity) return null;

  const slotsFull = capacity.slots_used >= capacity.slots_total;
  const resetAt = capacity.hour_resets_at ? formatClockTime(capacity.hour_resets_at) : null;

  return (
    <div className={styles.capacity}>
      <div className={styles.capacityCell}>
        <span className={styles.capacityLabel}>Slots in use</span>
        <span className={styles.capacityRow}>
          <strong className={styles.mono}>{capacity.slots_used} of {capacity.slots_total}</strong>
          {slotsFull ? <em className={styles.warnText}>Full — next job waits</em> : null}
        </span>
      </div>

      <div className={styles.capacityCell}>
        <span className={styles.capacityLabel}>Submitted this hour</span>
        <span className={styles.capacityRow}>
          <strong className={styles.mono}>{capacity.submitted_this_hour} of {capacity.hourly_limit}</strong>
          {resetAt ? <em>resets {resetAt}</em> : null}
        </span>
      </div>

      <div className={styles.capacityCell}>
        <span className={styles.capacityLabel}>Balance</span>
        <span className={styles.capacityRow}>
          {/* A failed read shows as unknown, never as 0 — telling someone they
              have no credits when they do is the same lie as a fabricated stat. */}
          <strong className={styles.mono}>{capacity.balance === null ? "—" : `${capacity.balance} cr`}</strong>
          <em>{capacity.credits_per_source_minute} cr per source minute</em>
        </span>
      </div>

      <div className={styles.capacityCell}>
        <span className={styles.capacityLabel}>Clips expiring soon</span>
        <span className={styles.capacityRow}>
          <strong className={capacity.clips_expiring_soon ? styles.warnStrong : styles.mono}>
            {capacity.clips_expiring_soon === null ? "—" : capacity.clips_expiring_soon}
          </strong>
          <em>within 24h</em>
        </span>
      </div>
    </div>
  );
}

function JobRow({ job, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const state = resolveJobState(job);
  const expiry = clipExpiry(job);
  const expiryLabel = formatRemaining(expiry.msRemaining);

  const total = job.clip_count ?? 0;
  const rendered = job.clips_rendered ?? 0;
  const clipsLabel = state.working
    ? total > 0 ? `${rendered}/${total}` : "—"
    : total > 0 ? String(total) : job.status === "complete" ? "0" : "—";

  return (
    <div className={`${styles.row} ${styles.jobRow} ${state.working ? styles.rowWorking : ""}`}>
      <button type="button" className={styles.rowOpen} onClick={onOpen} aria-label={`Open ${jobTitle(job)}`}>
        <span className={`${styles.state} ${styles[`tone_${state.tone}`]}`}>
          <span className={`${styles.dot} ${state.working ? styles.dotPulse : ""}`} aria-hidden="true" />
          {state.label}
        </span>

        <span className={styles.sourceCell}>
          <span className={styles.sourceTitle}>{jobTitle(job)}</span>
          <span className={styles.sourceMeta}>
            {sourceLabel(job)}
            {job.aspect_ratio ? ` · ${job.aspect_ratio}` : ""}
            {job.status === "failed" && job.error_stage ? ` · failed at ${job.error_stage}` : ""}
          </span>
        </span>

        <span className={`${styles.mono} ${styles.colLength}`}>
          {job.source_duration_secs ? formatTimecode(job.source_duration_secs) : "—"}
        </span>
        <span className={`${styles.mono} ${styles.colClips}`}>{clipsLabel}</span>
        <span className={`${styles.mono} ${styles.colExpiry} ${expiry.expiringSoon ? styles.warnText : ""}`}>
          {expiryLabel ?? "—"}
        </span>
        <span className={`${styles.mono} ${styles.colAge}`}>{formatAge(job.created_at)}</span>
      </button>

      <div className={styles.rowActions}>
        {confirming ? (
          <span className={styles.confirm}>
            <span>Delete?</span>
            <button type="button" onClick={() => { setConfirming(false); onDelete(job); }}>Yes</button>
            <button type="button" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${jobTitle(job)}`}
            title="Delete job"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {state.working ? (
        <div className={styles.rowProgress}>
          <div className={styles.rowProgressTrack}>
            <div
              className={styles.rowProgressFill}
              style={{ width: total > 0 ? `${Math.round((rendered / total) * 100)}%` : "8%" }}
            />
          </div>
          <div className={styles.rowProgressMeta}>
            <span>
              {job.status === "rendering" && total > 0
                ? `Rendering clip ${Math.min(rendered + 1, total)} of ${total}`
                : state.note}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
