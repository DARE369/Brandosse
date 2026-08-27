"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../services/supabaseClient";
import { fetchJobsPage } from "../../services/videoEngineApi";

/**
 * The job list's data: one page, kept live, with an honest staleness signal.
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 * VideoJobsPage fetched once on mount and never again — no realtime channel, no
 * polling, no refetch. The job-DETAIL screen had both a subscription and a
 * polling fallback (useJobRealtime), but the list, which is the surface's
 * landing screen and the first thing a person sees after submitting, sat frozen
 * at "In Queue" until they reloaded by hand. The most common single action on
 * this product — submit, go back to the list, wait — showed a lie.
 *
 * ── Why staleness is surfaced rather than hidden ────────────────────────────
 * A dropped subscription and a stalled pipeline look identical from the user's
 * chair: nothing moves. They call for opposite responses (wait vs. investigate),
 * so the interface has to be able to tell them apart out loud. `isStale` goes
 * true when the connection is down AND the last successful read is old enough
 * to matter, so a momentary reconnect never nags.
 *
 * ── Why polling still exists alongside realtime ─────────────────────────────
 * Same reasoning as useJobRealtime: the subscription is the fast path, polling
 * is the correctness path. Slow when connected (a missed-event safety net),
 * fast when not (the only path). It stops entirely when nothing is in flight,
 * so an idle list costs nothing.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const FALLBACK_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 20_000;
const REFRESH_DEBOUNCE_MS = 400;

const ACTIVE_STATUSES = new Set(["queued", "downloading", "transcribing", "analyzing", "rendering"]);

export function useJobsFeed({ q = "", status = "all", sort = "newest", limit = 25 } = {}) {
  const [jobs, setJobs] = useState([]);
  const [capacity, setCapacity] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isStale, setIsStale] = useState(false);

  const lastSyncRef = useRef(Date.now());
  const debounceRef = useRef(null);
  const pollRef = useRef(null);
  const connectedRef = useRef(false);
  // Background refreshes must re-read the page the person is LOOKING at. Before
  // paging existed they always re-read page 1, which was the same thing; now it
  // would yank someone off page 3 every few seconds.
  const pageRef = useRef(1);
  // Guards against a slow response for an old query landing after a fast one
  // for a new query — which would show results for a search the person has
  // already changed.
  const requestSeqRef = useRef(0);

  const anyActive = jobs.some((job) => ACTIVE_STATUSES.has(job.status));

  const load = useCallback(
    async ({ pageToLoad = 1, append = false, quiet = false } = {}) => {
      const seq = (requestSeqRef.current += 1);

      if (!quiet) {
        if (append) setLoadingMore(true);
        else setLoading(true);
      }

      try {
        const result = await fetchJobsPage({ q, status, sort, page: pageToLoad, limit });
        if (seq !== requestSeqRef.current) return;

        setJobs((current) => (append ? [...current, ...(result.jobs ?? [])] : result.jobs ?? []));
        setCapacity(result.capacity ?? null);
        setTotal(result.total ?? 0);
        setHasMore(Boolean(result.has_more));
        setPage(result.page ?? pageToLoad);
        pageRef.current = result.page ?? pageToLoad;
        setError("");
        lastSyncRef.current = Date.now();
        setIsStale(false);
      } catch (loadError) {
        if (seq !== requestSeqRef.current) return;
        // A quiet refresh that fails must not replace a good list with an error
        // screen. The rows on screen are still the best information we have,
        // and the staleness banner already says they may be behind.
        if (!quiet) setError(loadError?.message || "Failed to load your videos.");
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [q, status, sort, limit],
  );

  /** Coalesces bursts — a rendering job emits an event per clip, and each one
   *  must not become its own round trip. */
  const scheduleRefresh = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => load({ pageToLoad: pageRef.current, quiet: true }),
      REFRESH_DEBOUNCE_MS,
    );
  }, [load]);

  useEffect(() => {
    // `load` changes identity whenever q/status/sort/limit change, so this both
    // runs the first fetch and resets to page 1 on any new query. Staying on
    // page 7 of a filter that now has two results shows an empty table.
    pageRef.current = 1;
    load({ pageToLoad: 1 });
    return () => clearTimeout(debounceRef.current);
  }, [load]);

  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel = null;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId || cancelled) return;

      channel = supabase
        .channel(`video-jobs-list-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "video_jobs", filter: `user_id=eq.${userId}` },
          scheduleRefresh,
        )
        // Clip inserts drive the "4 of 7" counter, which changes while the job
        // row itself does not — without this the progress figure would only
        // move when the stage changed.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "video_clips", filter: `user_id=eq.${userId}` },
          scheduleRefresh,
        )
        .subscribe((subscriptionStatus) => {
          if (!cancelled) setIsConnected(subscriptionStatus === "SUBSCRIBED");
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);

  // ── Polling + staleness ───────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(pollRef.current);

    // Nothing in flight means nothing to poll for. An idle list should cost the
    // database nothing at all.
    if (!anyActive) {
      setIsStale(false);
      return undefined;
    }

    const intervalMs = isConnected ? HEARTBEAT_INTERVAL_MS : FALLBACK_INTERVAL_MS;

    pollRef.current = setInterval(() => {
      load({ pageToLoad: pageRef.current, quiet: true });
      setIsStale(!connectedRef.current && Date.now() - lastSyncRef.current > STALE_AFTER_MS);
    }, intervalMs);

    return () => clearInterval(pollRef.current);
  }, [anyActive, isConnected, load]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    load({ pageToLoad: page + 1, append: true });
  }, [hasMore, loadingMore, page, load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  /**
   * Jump to a page, replacing the rows rather than appending.
   *
   * Paging and "load more" coexist deliberately: append is right while a person
   * is scanning forward, and a page jump is right when they know roughly where
   * they are going. Both go through the same loader, so the polling and realtime
   * refreshes above always re-read page 1 — which is where anything newly
   * submitted lands.
   */
  const goToPage = useCallback(
    (nextPage) => {
      const target = Math.max(1, Math.min(totalPages, Math.round(nextPage)));
      if (target === page || loading) return;
      load({ pageToLoad: target });
      // A page change moves the whole list; leaving the viewport halfway down
      // makes it look like nothing happened.
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [totalPages, page, loading, load],
  );

  /**
   * Drop a job from the list without waiting for a round trip.
   *
   * Used by the delete flow, which holds the actual request for a few seconds
   * behind an undo. `restore` puts it back if the person takes the undo, so the
   * row returns to its original position rather than jumping to the top.
   */
  const removeJobLocally = useCallback((jobId) => {
    let removed = null;
    let index = -1;

    setJobs((current) => {
      index = current.findIndex((job) => job.id === jobId);
      if (index === -1) return current;
      removed = current[index];
      return current.filter((job) => job.id !== jobId);
    });

    return () => {
      if (!removed) return;
      setJobs((current) => {
        if (current.some((job) => job.id === removed.id)) return current;
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, removed);
        return next;
      });
    };
  }, []);

  return {
    jobs,
    capacity,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    isConnected,
    isStale,
    anyActive,
    page,
    totalPages,
    limit,
    reload: () => load({ pageToLoad: 1 }),
    loadMore,
    goToPage,
    removeJobLocally,
  };
}
