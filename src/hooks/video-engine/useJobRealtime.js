import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../../services/supabaseClient";

// When Realtime is connected: poll every 30s as a missed-event safety net.
// When Realtime is disconnected: poll every 5s so the UI stays responsive.
const HEARTBEAT_INTERVAL_MS = 30_000;
const FALLBACK_INTERVAL_MS  =  5_000;

export function useJobRealtime(jobId, initialJob, initialClips = []) {
  const [job, setJob] = useState(initialJob);
  const [clips, setClips] = useState(initialClips);
  const [isConnected, setIsConnected] = useState(false);
  const pollIntervalRef = useRef(null);
  const isConnectedRef  = useRef(false);

  useEffect(() => {
    setJob(initialJob);
    setClips(initialClips);
  }, [initialJob, initialClips]);

  // Keep a ref in sync so the interval callback can read the current value
  // without being recreated every time isConnected changes.
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const pollJob = useCallback(async () => {
    try {
      const { data: jobData, error: jobError } = await supabase
        .from("video_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (jobError) throw jobError;
      if (jobData) setJob(jobData);

      const { data: clipsData, error: clipsError } = await supabase
        .from("video_clips")
        .select("*")
        .eq("job_id", jobId)
        .order("clip_index", { ascending: true });

      if (clipsError) throw clipsError;
      if (clipsData) setClips(clipsData);
    } catch (err) {
      console.warn("[useJobRealtime] Polling failed:", err);
    }
  }, [jobId]);

  // Smart polling: heartbeat (30s) when Realtime is up, fast fallback (5s) when not.
  // Stops completely once the job reaches a terminal state.
  useEffect(() => {
    if (!jobId || job.status === "complete" || job.status === "failed") {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    const intervalMs = isConnected ? HEARTBEAT_INTERVAL_MS : FALLBACK_INTERVAL_MS;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(pollJob, intervalMs);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [jobId, job.status, isConnected, pollJob]);

  useEffect(() => {
    if (!jobId) return undefined;

    const channel = supabase
      .channel(`video-engine-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          setJob(payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "video_clips",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const newClip = payload.new;
          setClips((current) => {
            if (current.some((clip) => clip.id === newClip.id)) return current;
            return [...current, newClip].sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_clips",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const updatedClip = payload.new;
          setClips((current) =>
            current
              .map((clip) => (clip.id === updatedClip.id ? updatedClip : clip))
              .sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0)),
          );
        },
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  return { job, clips, isConnected };
}
