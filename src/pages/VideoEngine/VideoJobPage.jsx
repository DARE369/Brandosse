"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { AppShell, Button, EmptyState, Skeleton, useUiV2Toast } from "../../ui-v2";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { useJobRealtime } from "../../hooks/video-engine/useJobRealtime";
import { useSignedUrls } from "../../hooks/video-engine/useSignedUrls";
import { fetchJobCreditActivity, fetchJobDetail } from "../../services/videoEngineData";
import {
  deleteVideoJob,
  downloadJobArchive,
  downloadJobTranscript,
  publishClipToDraft,
  rerunVideoJob,
} from "../../services/videoEngineApi";
import { saveClipToLibrary, scheduleHandoffPathForAsset } from "../../components/video-engine/clipLibraryActions";
import { SourceSpine } from "./components/SourceSpine";
import { ClipRow } from "./components/ClipRow";
import { ClipTriageBar } from "./components/ClipTriageBar";
import { ClipReview } from "./components/ClipReview";
import { ClipGrid } from "./components/ClipGrid";
import { ClipTable } from "./components/ClipTable";
import {
  clipDisplayTitle,
  clipScores,
  explainJobError,
  formatDuration,
  formatTimecode,
  isUploadSource,
  jobState,
  jobTitle,
  normaliseScore,
  PIPELINE_STAGES,
  sourceLabel,
  stageState,
} from "./videoShared";
import styles from "./VideoJobPage.module.css";

/**
 * One job, one address, from queued to clips.
 *
 * ── Why progress and results are the same screen ────────────────────────────
 * They used to be two, chosen by a status check, so a person who left during
 * rendering and came back had to work out which screen now held their clips. A
 * job is one object with one URL; it changes state in place. Clips appear as
 * they finish rather than the page replacing itself at the end.
 *
 * ── Why the finished job is a triage surface, not a gallery ─────────────────
 * The verb here is "keep these four, bin the rest", performed daily. That is a
 * task with a finish line, so the screen tracks decisions and says how far
 * through the set you are, and offers four ways to look at the same selection:
 * Review to judge one clip on everything known about it, Grid and List to scan,
 * Table to compare five scores across every clip. They are views, not screens —
 * keeping in any of them keeps the same clip.
 */

/** Which view the person last used. A daily user picking "Table" every single
 *  time is a tax the product would be charging for nothing. */
const VIEW_STORAGE_KEY = "brandosse.video.clipView";
const VIEWS = new Set(["review", "grid", "list", "table"]);

function readStoredView() {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.has(stored) ? stored : "review";
  } catch {
    // Private windows and blocked site data both throw here. A remembered
    // preference is a convenience; losing it must not break the screen.
    return "review";
  }
}

export default function VideoJobPage({ jobId = null }) {
  return (
    <AppShell activeKey="video" mainClassName={styles.main}>
      <VideoJobBody jobId={jobId} />
    </AppShell>
  );
}

function VideoJobBody({ jobId }) {
  const { navigate, pathname } = useAppNavigation();
  const { user } = useAuth();
  const { show: toast } = useUiV2Toast();

  const id = jobId ?? pathname.split("/").filter(Boolean).slice(-1)[0] ?? null;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    if (!user?.id || !id) return undefined;
    let active = true;

    setLoading(true);
    fetchJobDetail(user.id, id)
      .then((data) => { if (active) setDetail(data); })
      // Identical message for "not yours" and "does not exist" — telling them
      // apart would let someone probe for valid job ids.
      .catch(() => { if (active) setError("This video could not be opened."); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [id, user?.id]);

  if (loading) {
    return (
      <div className={styles.page}>
        <Skeleton width="180px" height="12px" />
        <Skeleton width="60%" height="26px" style={{ marginTop: 12 }} />
        <Skeleton width="100%" height="92px" style={{ marginTop: 20 }} />
        <Skeleton width="100%" height="240px" style={{ marginTop: 16 }} />
      </div>
    );
  }

  if (error || !detail?.job) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="We couldn't open this video"
          description="It may have been deleted, or it belongs to another account."
          actions={<Button onClick={() => navigate("/app/video/jobs")}>Back to Videos</Button>}
        />
      </div>
    );
  }

  return (
    <JobView
      initialJob={detail.job}
      initialClips={detail.clips}
      userId={user.id}
      ledger={ledger}
      setLedger={setLedger}
      navigate={navigate}
      toast={toast}
    />
  );
}

function JobView({ initialJob, initialClips, userId, ledger, setLedger, navigate, toast }) {
  const { job, clips: liveClips, isConnected } = useJobRealtime(initialJob.id, initialJob, initialClips);
  const { clips, refreshClip } = useSignedUrls(liveClips);

  const state = jobState(job.status);
  const isFailed = job.status === "failed";
  const isWorking = state.working;

  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [savedClips, setSavedClips] = useState(() => new Map());
  const [skipped, setSkipped] = useState(() => new Set());
  const [titleOverrides, setTitleOverrides] = useState(() => new Map());
  const [view, setView] = useState("review");
  const [clipFilter, setClipFilter] = useState("all");
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const [busy, setBusy] = useState("");
  const [busyClipId, setBusyClipId] = useState(null);
  const [playToken, setPlayToken] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const elapsed = useElapsed(isWorking);
  const listRef = useRef(null);

  useEffect(() => { setView(readStoredView()); }, []);

  const changeView = useCallback((next) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is survivable; failing to change it is not.
    }
  }, []);

  // The refund is read from the ledger, not asserted. An earlier version of
  // this screen printed "your credits have been refunded" as static text wired
  // to no refund state at all.
  useEffect(() => {
    if (!isFailed || ledger !== null) return;
    fetchJobCreditActivity(userId, job.id)
      .then(setLedger)
      .catch(() => setLedger({ refundedAmount: null }));
  }, [isFailed, ledger, setLedger, userId, job.id]);

  const rendered = useMemo(() => clips.filter((c) => c.render_status === "complete"), [clips]);
  const failedClips = useMemo(() => clips.filter((c) => c.render_status === "failed"), [clips]);

  /** Rank is the product's whole claim, so it is computed once, from the score,
   *  and carried on the clip — every view then shows the same number. */
  const ordered = useMemo(() => {
    const ranked = [...rendered]
      .sort((a, b) => (normaliseScore(b.overall_score) ?? -1) - (normaliseScore(a.overall_score) ?? -1))
      .map((clip, index) => ({ ...clip, rank: index + 1 }));
    return [...ranked, ...failedClips.map((clip) => ({ ...clip, rank: null }))];
  }, [rendered, failedClips]);

  const hero = ordered[0] ?? null;

  useEffect(() => {
    if (selectedId === null && hero) setSelectedId(hero.id);
  }, [hero, selectedId]);

  const decisionOf = useCallback(
    (clip) => {
      if (clip.render_status === "failed") return "failed";
      if (savedClips.has(clip.id)) return "kept";
      if (skipped.has(clip.id)) return "skipped";
      return "open";
    },
    [savedClips, skipped],
  );

  const counts = useMemo(() => {
    const total = ordered.length;
    let kept = 0;
    let skippedCount = 0;
    for (const clip of ordered) {
      const decision = decisionOf(clip);
      if (decision === "kept") kept += 1;
      if (decision === "skipped") skippedCount += 1;
    }
    const failed = failedClips.length;
    // A clip that failed to render is decided for you — there is nothing to
    // judge, so leaving it out of the total would make the count unreachable.
    const decided = kept + skippedCount + failed;
    return { total, kept, skipped: skippedCount, failed, decided, undecided: total - decided };
  }, [ordered, decisionOf, failedClips.length]);

  const visible = useMemo(() => {
    const filtered = ordered.filter((clip) => {
      const decision = decisionOf(clip);
      if (clipFilter === "kept") return decision === "kept";
      if (clipFilter === "undecided") return decision === "open";
      if (clipFilter === "failed") return decision === "failed";
      return true;
    });

    const value = (clip) => {
      if (sortKey === "rank") return clip.rank === null ? Number.POSITIVE_INFINITY : clip.rank;
      if (sortKey === "duration") return Number(clip.duration_secs) || 0;
      if (sortKey === "start") return Number(clip.start_time_secs) || 0;
      if (sortKey === "title") return clipDisplayTitle(clip).toLowerCase();
      return clipScores(clip)[sortKey] ?? null;
    };

    return [...filtered].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      // Unknown sorts last in BOTH directions. Treating null as 0 would bury
      // unscored clips at one end and call it a ranking.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const cmp = typeof left === "string" ? left.localeCompare(right) : left - right;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [ordered, decisionOf, clipFilter, sortKey, sortDir]);

  // A filter can hide the clip you were on. Rather than showing an empty
  // review pane, move to the first clip that is still visible.
  useEffect(() => {
    if (visible.length === 0) return;
    if (!visible.some((clip) => clip.id === selectedId)) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  const selectedIndex = Math.max(0, visible.findIndex((clip) => clip.id === selectedId));
  const selected = visible[selectedIndex] ?? null;

  const markSaved = useCallback((clipId, assetId) => {
    setSavedClips((prev) => new Map(prev).set(clipId, assetId));
    setSkipped((prev) => {
      if (!prev.has(clipId)) return prev;
      const next = new Set(prev);
      next.delete(clipId);
      return next;
    });
  }, []);

  const overridesFor = useCallback(
    (clip) => {
      const title = titleOverrides.get(clip.id);
      return title ? { ai_title: title } : {};
    },
    [titleOverrides],
  );

  const keepClip = useCallback(
    async (clip, overrides = {}) => {
      if (savedClips.has(clip.id)) return savedClips.get(clip.id);
      // Pass the job through so the Library can say which video, and which
      // seconds of it, this clip came from — otherwise a saved clip is
      // indistinguishable from any other upload.
      //
      // `job` is the live row from useJobRealtime, not the fetch-time snapshot.
      // This read used `id` and `detail`, which are VideoJobBody's locals and
      // have never been in scope here — the dep array below evaluated them on
      // every render, so the whole page threw before it painted.
      const assetId = await saveClipToLibrary(
        { ...clip, ...overrides },
        { jobId: job.id, title: jobTitle(job) },
      );
      markSaved(clip.id, assetId);
      return assetId;
    },
    [savedClips, markSaved, job],
  );

  const handleKeep = useCallback(
    async (clip, overrides) => {
      setBusyClipId(clip.id);
      try {
        await keepClip(clip, overrides ?? overridesFor(clip));
        toast("Kept in your Library.", { tone: "success" });
      } catch (keepError) {
        toast(keepError?.message || "Could not save that clip.", { tone: "danger", duration: 6000 });
      } finally {
        setBusyClipId(null);
      }
    },
    [keepClip, overridesFor, toast],
  );

  const handleSchedule = useCallback(
    async (clip, overrides) => {
      setBusy("schedule");
      try {
        // Scheduling implies keeping, so the save happens silently and the
        // button still says exactly one thing.
        const assetId = await keepClip(clip, overrides ?? overridesFor(clip));

        // keepClip() stores the clip through the Library UPLOAD pipeline, which
        // hardcodes generation_id = NULL. The publisher resolves media only via
        // posts -> generations, so handing Quick Post that asset alone prefills
        // a composer that LOOKS complete and yields a post with no media — the
        // failure that put a YouTube post on the failed pile reading
        // "YouTube requires a video. This post has no media attached."
        //
        // publishClipToDraft() is the bridge giving the clip a real generations
        // row (storage path + bucket, signed fresh at publish, never stored
        // signed). Carrying its id through the handoff is what makes the
        // resulting post publishable.
        let generationId = null;
        try {
          const bridged = await publishClipToDraft(clip.id);
          generationId = bridged?.generationId || null;
        } catch (bridgeError) {
          // Non-fatal on purpose: the clip IS saved to the Library, and the
          // composer's media guard now refuses to schedule a media-required
          // platform with nothing publishable attached. Failing the whole
          // action here would discard a save that succeeded.
          console.error("[VideoJobPage] could not link clip to a generation:", bridgeError);
          toast("Saved to your Library, but this clip isn't publishable yet — try Schedule again.", {
            tone: "danger",
            duration: 7000,
          });
        }

        if (assetId) navigate(scheduleHandoffPathForAsset(assetId, generationId));
      } catch (scheduleError) {
        toast(scheduleError?.message || "Could not prepare that clip.", { tone: "danger", duration: 6000 });
      } finally {
        setBusy("");
      }
    },
    [keepClip, overridesFor, navigate, toast],
  );

  const handleKeepMany = useCallback(
    async (targets) => {
      const pending = targets.filter((clip) => !savedClips.has(clip.id) && clip.render_status === "complete");
      if (pending.length === 0) return;

      setBusy("keeping");
      let failures = 0;
      for (const clip of pending) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await keepClip(clip, overridesFor(clip));
        } catch {
          failures += 1;
        }
      }
      setBusy("");
      setChecked(new Set());

      // Partial failure is reported honestly rather than as a flat success.
      if (failures === 0) {
        toast(`Kept ${pending.length} clip${pending.length === 1 ? "" : "s"} in your Library.`, { tone: "success" });
      } else {
        toast(`${pending.length - failures} of ${pending.length} clips saved. ${failures} could not be.`, {
          tone: "danger",
          duration: 7000,
        });
      }
    },
    [keepClip, overridesFor, savedClips, toast],
  );

  const toggleSkip = useCallback((clip) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      return next;
    });
  }, []);

  const step = useCallback(
    (delta) => {
      if (visible.length === 0) return;
      const next = Math.min(visible.length - 1, Math.max(0, selectedIndex + delta));
      setSelectedId(visible[next].id);
    },
    [visible, selectedIndex],
  );

  const handleCopyCaption = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Caption copied.", { tone: "success", duration: 2500 });
      } catch {
        toast("Your browser would not let us write to the clipboard.", { tone: "danger" });
      }
    },
    [toast],
  );

  const handleDownloadAll = useCallback(
    async (clipIds) => {
      setBusy("archiving");
      try {
        const result = await downloadJobArchive(job.id, `${jobTitle(job)}.zip`, clipIds ? { clipIds } : undefined);
        if (clipIds) setChecked(new Set());
        return result;
      } catch (downloadError) {
        toast(downloadError?.message || "Could not build the archive.", { tone: "danger", duration: 6000 });
        return null;
      } finally {
        setBusy("");
      }
    },
    [job, toast],
  );

  const handleTranscript = useCallback(async () => {
    setBusy("transcript");
    try {
      await downloadJobTranscript(job.id, `${jobTitle(job)}.txt`);
    } catch (transcriptError) {
      toast(transcriptError?.message || "No transcript is available for this job.", { tone: "danger", duration: 6000 });
    } finally {
      setBusy("");
    }
  }, [job, toast]);

  const handleRerun = useCallback(async () => {
    setBusy("rerun");
    try {
      const result = await rerunVideoJob(job.id);
      navigate(`/app/video/jobs/${result.job_id}`);
    } catch (rerunError) {
      toast(rerunError?.message || "Could not start that job again.", { tone: "danger", duration: 7000 });
    } finally {
      setBusy("");
    }
  }, [job.id, navigate, toast]);

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    try {
      await deleteVideoJob(job.id);
      navigate("/app/video/jobs");
    } catch (deleteError) {
      toast(deleteError?.message || "Could not delete this job.", { tone: "danger", duration: 7000 });
    }
  }, [job.id, navigate, toast]);

  /** First click on a column sorts it the way that column is usually read —
   *  rank and title ascending, every score descending, because nobody opens a
   *  score column to find the worst clip first. */
  const handleSort = useCallback(
    (key) => {
      if (key === sortKey) {
        setSortDir((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir(key === "rank" || key === "title" ? "asc" : "desc");
    },
    [sortKey],
  );

  // ── Keyboard model ────────────────────────────────────────────────────────
  // Hours a day in a triage loop is exactly what hands need. The shortcuts only
  // exist once there is something to triage, and never fire while typing or
  // while the delete dialog owns the screen.
  const hasClips = job.status === "complete" && ordered.length > 0;

  useEffect(() => {
    if (!hasClips || confirmDelete) return undefined;

    function onKey(event) {
      const tag = (event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key;

      if (key >= "1" && key <= "4") {
        event.preventDefault();
        changeView(["review", "grid", "list", "table"][Number(key) - 1]);
        return;
      }

      if (!selected) return;

      if (key === "j" || key === "J" || key === "ArrowDown" || key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (key === "k" || key === "K" || key === "ArrowUp" || key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (key === "s" || key === "S") {
        event.preventDefault();
        if (!savedClips.has(selected.id) && selected.render_status === "complete") handleKeep(selected);
      } else if (key === "x" || key === "X") {
        event.preventDefault();
        if (selected.render_status === "complete") { toggleSkip(selected); step(1); }
      } else if (key === " ") {
        event.preventDefault();
        setPlayToken((token) => token + 1);
      } else if (key === "d" || key === "D") {
        if (!selected.public_url) return;
        event.preventDefault();
        const anchor = document.createElement("a");
        anchor.href = selected.public_url;
        anchor.download = `${clipDisplayTitle(selected)}.mp4`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasClips, confirmDelete, selected, savedClips, step, changeView, handleKeep, toggleSkip]);

  const failure = isFailed ? explainJobError(job.error_message, job.error_stage) : null;
  const uploadSource = isUploadSource(job);
  const keptCount = counts.kept;
  const checkedClips = ordered.filter((c) => checked.has(c.id) && c.render_status === "complete");
  const keptIds = useMemo(() => new Set(savedClips.keys()), [savedClips]);

  const toggleCheck = useCallback((clipId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  }, []);

  const strip = useMemo(
    () => visible.map((clip) => ({
      id: clip.id,
      label: clip.rank === null ? "×" : String(clip.rank),
      title: clipDisplayTitle(clip),
      duration: formatDuration(clip.duration_secs),
      thumbnail: clip.thumbnail_url || null,
      decision: decisionOf(clip),
      active: clip.id === selectedId,
      onSelect: () => setSelectedId(clip.id),
    })),
    [visible, decisionOf, selectedId],
  );

  return (
    <div className={styles.page}>
      <div className={styles.crumbs}>
        <Button size="sm" variant="subtle" onClick={() => navigate("/app/video/jobs")}>
          <ArrowLeft size={14} aria-hidden="true" /> All videos
        </Button>
        <span className={styles.mono}>JOB {String(job.id).slice(0, 6)}</span>
        {isWorking ? (
          <span className={styles.mono}>{isConnected ? "LIVE" : "RECONNECTING…"}</span>
        ) : null}
      </div>

      <header className={styles.header}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{jobTitle(job)}</h1>
          <p className={styles.meta}>
            {sourceLabel(job)}
            {job.source_duration_secs ? ` · ${formatTimecode(job.source_duration_secs)}` : ""}
            {job.aspect_ratio ? ` · ${job.aspect_ratio}` : ""}
            {job.caption_style ? ` · ${String(job.caption_style).replace(/_/g, " ")} captions` : ""}
          </p>
        </div>

        <div className={styles.headActions}>
          {isWorking ? (
            <span className={`${styles.statusPill} ${styles.pillAccent}`}>
              <span className={`${styles.dot} ${styles.dotPulse}`} aria-hidden="true" />
              {state.label}
              {job.status === "rendering" && clips.length > 0
                ? ` · clip ${Math.min(rendered.length + 1, clips.length)} of ${clips.length}`
                : ""}
              {elapsed ? ` · ${elapsed}` : ""}
            </span>
          ) : null}

          {isFailed ? (
            <span className={`${styles.statusPill} ${styles.pillDanger}`}>
              <span className={styles.dot} aria-hidden="true" />
              Failed{job.error_stage ? ` while ${job.error_stage}` : ""}
            </span>
          ) : null}

          {rendered.length > 0 ? (
            <>
              <Button size="sm" variant="subtle" onClick={() => handleDownloadAll(null)} disabled={busy === "archiving"}>
                {busy === "archiving" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                Download all
              </Button>
              <Button size="sm" onClick={() => handleKeepMany(ordered)} disabled={busy === "keeping" || keptCount === rendered.length}>
                {busy === "keeping" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" />
                  : keptCount === rendered.length ? <Check size={14} aria-hidden="true" /> : null}
                {keptCount === rendered.length ? "All kept" : `Keep all (${rendered.length - keptCount})`}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <SourceSpine
        durationSecs={job.source_duration_secs}
        clips={clips}
        selectedClipId={job.status === "complete" ? selected?.id ?? null : null}
        onSelectClip={job.status === "complete" ? setSelectedId : undefined}
        progressPercent={job.status === "downloading" ? job.download_progress ?? null : null}
        failedAtFraction={isFailed && job.status === "failed" ? 0.18 : null}
        label={job.status === "complete" ? "Source spine — where each clip came from" : "Source spine"}
        note={
          isWorking && clips.length > 0
            ? `${rendered.length} of ${clips.length} clips rendered`
            : job.status === "complete"
              ? `${rendered.length} cut${rendered.length === 1 ? "" : "s"}`
              : null
        }
      />

      {/* ── Working ─────────────────────────────────────────────────────── */}
      {isWorking ? (
        <section className={styles.panel}>
          <h2 className={styles.panelLabel}>Pipeline</h2>
          <ol className={styles.stages}>
            {PIPELINE_STAGES.map((stage) => {
              const status = stageState(stage.key, job.status, job.error_stage);
              return (
                <li key={stage.key} className={`${styles.stage} ${styles[`stage_${status}`]}`}>
                  <span className={styles.stageMark} aria-hidden="true">
                    {status === "done" ? <Check size={12} /> : status === "active" ? <Loader2 size={12} className={styles.spin} /> : null}
                  </span>
                  <span className={styles.stageText}>
                    <strong>{stage.label}</strong>
                    <span>
                      {status === "active" && stage.key === "rendering" && clips.length > 0
                        ? `Clip ${Math.min(rendered.length + 1, clips.length)} of ${clips.length} — each one lands as it finishes`
                        : stage.note}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className={styles.leaveable}>
            You can close this tab. The job keeps running, and finished clips land here one at a time.
          </p>

          <div className={styles.stopBox}>
            <h3 className={styles.panelLabel}>Stopping</h3>
            {job.status === "queued" ? (
              <>
                <p>This job has not started yet, so it can still be cancelled.</p>
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Cancel this job</Button>
              </>
            ) : (
              <>
                {/* The server refuses this with a 409 and an explanation. The old
                    UI offered the control anyway and reported the refusal as
                    "Could not delete. Try again." — wrong twice. */}
                <p>Processing has started, so this job cannot be stopped. It will finish, and you will be charged for it.</p>
                <Button size="sm" variant="subtle" disabled>Cannot cancel once processing starts</Button>
              </>
            )}
          </div>
        </section>
      ) : null}

      {/* ── Failed ──────────────────────────────────────────────────────── */}
      {isFailed && failure ? (
        <section className={`${styles.panel} ${styles.panelDanger}`}>
          <h2 className={styles.failHeadline}>{failure.headline}</h2>
          <p className={styles.failBody}>{failure.body}</p>

          {failure.remedy ? (
            <div className={styles.remedy}>
              <span className={styles.panelLabel}>What works</span>
              <p>{failure.remedy}</p>
            </div>
          ) : null}

          <div className={styles.failActions}>
            {/* An upload job's source is held for 24 hours and cleared on
                redeploy, so re-running one usually cannot work. Offering the
                action anyway would create a job that is already doomed. */}
            {uploadSource ? (
              <Button size="sm" onClick={() => navigate("/app/video/jobs?new=1")}>Upload the file again</Button>
            ) : (
              <Button size="sm" onClick={handleRerun} disabled={busy === "rerun"}>
                {busy === "rerun" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Run this video again
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden="true" /> Delete this job
            </Button>
          </div>

          {ledger?.refundedAmount ? (
            <div className={styles.refund}>
              <span className={styles.dotSuccess} aria-hidden="true" />
              <p>
                Refunded <strong>{ledger.refundedAmount} credits</strong>
                {ledger.refundedAt ? ` at ${new Date(ledger.refundedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
                {ledger.balanceAfterRefund !== null ? ` — balance back to ${ledger.balanceAfterRefund}.` : "."}
              </p>
            </div>
          ) : null}

          {job.error_message ? (
            <details className={styles.technical}>
              <summary>Technical detail</summary>
              <pre>{job.error_message}</pre>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* ── Complete ────────────────────────────────────────────────────── */}
      {job.status === "complete" ? (
        ordered.length === 0 ? (
          <section className={styles.panel}>
            <EmptyState
              title="This one had nothing to cut."
              description={
                "The job ran all the way through, but the transcript came back nearly empty — clipping needs sustained "
                + "speech to find moments worth keeping. A source that is mostly music or room noise produces no clips."
              }
              actions={
                <>
                  <Button size="sm" onClick={() => navigate("/app/video/jobs?new=1")}>Try a different source</Button>
                  <Button size="sm" variant="subtle" onClick={handleTranscript} disabled={busy === "transcript"}>
                    <FileText size={14} aria-hidden="true" /> Download the transcript
                  </Button>
                </>
              }
            />
          </section>
        ) : (
          <>
            <ClipTriageBar
              view={view}
              onViewChange={changeView}
              filter={clipFilter}
              onFilterChange={setClipFilter}
              counts={counts}
            />

            {counts.undecided === 0 ? (
              <div className={styles.triageDone} role="status">
                <span className={styles.dotSuccess} aria-hidden="true" />
                <p>
                  Every clip reviewed — {counts.kept} kept, {counts.skipped} skipped
                  {counts.failed > 0 ? `, ${counts.failed} failed to render` : ""}. Kept clips are in your Library.
                </p>
                {counts.kept > 0 ? (
                  <Button size="sm" variant="subtle" onClick={() => navigate("/app/library")}>Open the Library</Button>
                ) : null}
              </div>
            ) : null}

            {visible.length === 0 ? (
              <section className={styles.panel}>
                <EmptyState
                  title="No clips match that filter"
                  description="Nothing in this job is in that state yet."
                  actions={<Button size="sm" variant="subtle" onClick={() => setClipFilter("all")}>Show all clips</Button>}
                />
              </section>
            ) : view === "review" && selected ? (
              <ClipReview
                clip={selected}
                aspectRatio={job.aspect_ratio || null}
                rank={selected.rank}
                position={selectedIndex + 1}
                total={visible.length}
                kept={keptIds.has(selected.id)}
                skipped={skipped.has(selected.id)}
                busy={busyClipId === selected.id ? "keep" : busy === "schedule" ? "schedule" : ""}
                onKeep={() => handleKeep(selected)}
                onSkip={() => { toggleSkip(selected); step(1); }}
                onSchedule={() => handleSchedule(selected)}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onTitleChange={(next) => setTitleOverrides((prev) => new Map(prev).set(selected.id, next))}
                onRefreshUrl={() => refreshClip(selected.id)}
                onCopyCaption={handleCopyCaption}
                strip={strip}
                atStart={selectedIndex === 0}
                atEnd={selectedIndex === visible.length - 1}
                playToken={playToken}
              />
            ) : view === "grid" ? (
              <ClipGrid
                clips={visible}
                aspectRatio={job.aspect_ratio || null}
                activeId={selectedId}
                decisionOf={decisionOf}
                keptIds={keptIds}
                busyId={busyClipId}
                onOpen={(clip) => { setSelectedId(clip.id); changeView("review"); }}
                onKeep={(clip) => handleKeep(clip)}
              />
            ) : view === "table" ? (
              <ClipTable
                clips={visible}
                activeId={selectedId}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                decisionOf={decisionOf}
                keptIds={keptIds}
                checkedIds={checked}
                onToggleCheck={toggleCheck}
                busyId={busyClipId}
                onOpen={(clip) => { setSelectedId(clip.id); changeView("review"); }}
                onKeep={(clip) => handleKeep(clip)}
              />
            ) : (
              <section className={styles.clipList} ref={listRef}>
                <div className={styles.clipListHead}>
                  <span className={styles.panelLabel}>
                    {rendered.length} clip{rendered.length === 1 ? "" : "s"} ready · best first
                    {failedClips.length > 0 ? ` · ${failedClips.length} failed` : ""}
                  </span>
                  <Button size="sm" variant="ghost" onClick={handleTranscript} disabled={busy === "transcript"}>
                    <FileText size={14} aria-hidden="true" /> Transcript
                  </Button>
                </div>

                {visible.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    clip={clip}
                    aspectRatio={job.aspect_ratio || null}
                    rank={clip.rank}
                    selected={clip.id === selected?.id}
                    checked={checked.has(clip.id)}
                    kept={keptIds.has(clip.id)}
                    onSelect={() => setSelectedId(clip.id)}
                    onToggleCheck={() => toggleCheck(clip.id)}
                    onKeep={(overrides) => handleKeep(clip, overrides)}
                    onSchedule={(overrides) => handleSchedule(clip, overrides)}
                    onRefreshUrl={() => refreshClip(clip.id)}
                    onRerunJob={handleRerun}
                  />
                ))}

                {/* Produced on every successful job, stored on the job row, and
                    surfaced by nothing until now. */}
                {job.stitched_output_url ? (
                  <div className={styles.stitchedRow}>
                    <span className={styles.stitchedTag}>ALL</span>
                    <div className={styles.stitchedText}>
                      <strong>Every clip, back to back</strong>
                      <span className={styles.mono}>ONE FILE · {job.aspect_ratio || "9:16"}</span>
                    </div>
                    <a
                      className={styles.stitchedLink}
                      href={job.stitched_output_url}
                      download={`${jobTitle(job)}-all.mp4`}
                    >
                      Download
                    </a>
                  </div>
                ) : null}
              </section>
            )}

            <p className={styles.retentionNote}>
              <span>
                Your clips stay here until you delete them. <strong>Keeping</strong> a clip also copies it into
                your Library. Downloads are yours either way. Skipping only marks a clip reviewed for this pass;
                it deletes nothing and is not remembered after you leave.
              </span>
              <Button size="sm" variant="ghost" onClick={handleTranscript} disabled={busy === "transcript"}>
                <FileText size={14} aria-hidden="true" /> Transcript
              </Button>
            </p>
          </>
        )
      ) : null}

      {checkedClips.length > 0 ? (
        <div className={styles.bulkBar} role="status">
          <span className={styles.mono}>{checkedClips.length} selected</span>
          <Button size="sm" onClick={() => handleKeepMany(checkedClips)} disabled={busy === "keeping"}>
            {busy === "keeping" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : null}
            Keep {checkedClips.length} in Library
          </Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => handleDownloadAll(checkedClips.map((clip) => clip.id))}
            disabled={busy === "archiving"}
          >
            {busy === "archiving" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSkipped((prev) => {
                const next = new Set(prev);
                for (const clip of checkedClips) if (!keptIds.has(clip.id)) next.add(clip.id);
                return next;
              });
              setChecked(new Set());
            }}
          >
            Skip
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDelete
          job={job}
          clipCount={rendered.length}
          keptCount={keptCount}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}

/** Permanent loss gets a modal, not an undo — the files go immediately and
 *  cannot be recovered. Everything reversible on this screen uses a toast. */
function ConfirmDelete({ job, clipCount, keptCount, onCancel, onConfirm }) {
  const atRisk = Math.max(0, clipCount - keptCount);

  return (
    <div className={styles.scrim} onMouseDown={onCancel} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{clipCount > 0 ? `Delete this job and its ${clipCount} clip${clipCount === 1 ? "" : "s"}?` : "Delete this job?"}</h2>
        <p>
          The clip files are removed immediately and cannot be recovered. Clips you have already kept in your Library
          stay there.
        </p>
        {clipCount > 0 ? (
          <p className={styles.mono}>{keptCount} OF {clipCount} KEPT · {atRisk} WOULD BE LOST</p>
        ) : null}
        <div className={styles.dialogActions}>
          <Button size="sm" variant="subtle" onClick={onCancel}>Keep job</Button>
          <Button size="sm" variant="dangerSolid" onClick={onConfirm}>
            {clipCount > 0 ? "Delete job and clips" : "Delete job"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return undefined;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active || seconds === 0) return null;
  return formatDuration(seconds);
}
