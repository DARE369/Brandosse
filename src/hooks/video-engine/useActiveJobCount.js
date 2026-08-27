"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../services/supabaseClient";

/**
 * How many clipping jobs are in flight for this user, right now.
 *
 * ── Why the chrome needs to know ────────────────────────────────────────────
 * A clipping job runs for minutes and is explicitly designed to be left alone.
 * Once the person navigated away from the Videos surface, the product went
 * completely silent about it — the only way to find out whether their work was
 * still running was to go back and look. A count on the nav entry means an
 * unattended job is visible from anywhere in the app.
 *
 * ── Why a count and not a list ──────────────────────────────────────────────
 * This runs on every screen, so it must stay cheap: a head-only `count` query,
 * refreshed by realtime rather than polled. Anyone who wants detail is one
 * click away from the surface that has it.
 */

const ACTIVE_STATUSES = ["queued", "downloading", "transcribing", "analyzing", "rendering", "stitching"];

export function useActiveJobCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return undefined;
    }

    let active = true;

    async function read() {
      const { count: activeCount, error } = await supabase
        .from("video_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ACTIVE_STATUSES);

      // A failed read leaves the previous count alone rather than dropping to
      // zero. Zero is a claim — "nothing is running" — and a transient network
      // fault is not evidence for it.
      if (active && !error) setCount(activeCount ?? 0);
    }

    read();

    const channel = supabase
      .channel(`video-jobs-count-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "video_jobs", filter: `user_id=eq.${userId}` },
        read,
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return count;
}
