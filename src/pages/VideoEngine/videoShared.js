"use client";

/**
 * Vocabulary and formatting shared by the Videos screens.
 *
 * The design record fixes the glossary deliberately: source (the long video),
 * job (one run), clip (one output), keep (save to Library), credit. Not:
 * render, asset, item, task, process. Centralising the labels here is what
 * stops that vocabulary drifting apart across four screens the way NAV_ITEMS
 * once did across nine pages.
 */

/**
 * Every state a job row can be in, in the words a person reads.
 *
 * `stitching` is included on purpose. The worker sets it between rendering and
 * completion (video-worker/job_runner.py:116) and neither the interface's status
 * list nor the migration-tracked CHECK constraint mentions it — so a job in that
 * state used to fall through to an "unknown job state" dead end. Whether the
 * live constraint accepts the write is unverified; either way the UI now has a
 * word for it instead of a blank screen.
 */
export const JOB_STATE = {
  queued: { label: "Queued", tone: "info", working: true, note: "Waiting for a free slot" },
  downloading: { label: "Downloading", tone: "accent", working: true, note: "Fetching the source" },
  transcribing: { label: "Transcribing", tone: "accent", working: true, note: "Reading the audio" },
  analyzing: { label: "Analysing", tone: "accent", working: true, note: "Finding what is worth cutting" },
  rendering: { label: "Rendering", tone: "accent", working: true, note: "Producing vertical clips" },
  stitching: { label: "Assembling", tone: "accent", working: true, note: "Joining the clips into one file" },
  complete: { label: "Complete", tone: "success", working: false, note: "Clips are ready" },
  // A job can run the whole pipeline successfully and produce nothing, because
  // the source had no sustained speech. That is not "Complete" in any sense the
  // person cares about — labelling it so sends them into a job to find an empty
  // screen. It is not a database status either: the row says 'complete' and the
  // distinction is the clip count, resolved by resolveJobState below.
  zero: { label: "No clips", tone: "neutral", working: false, note: "Nothing worth cutting was found" },
  failed: { label: "Failed", tone: "danger", working: false, note: "Stopped before finishing" },
};

export const WORKING_STATUSES = Object.keys(JOB_STATE).filter((key) => JOB_STATE[key].working);

/**
 * The state to SHOW for a job, which is not always the state stored on it.
 *
 * Only `zero` differs: a finished job with no clips. Everything else passes
 * through. Callers that have the clip count should use this; callers that only
 * have a status string can still call jobState directly.
 */
export function resolveJobState(job) {
  if (job?.status === "complete" && Number(job?.clip_count ?? 0) === 0) return jobState("zero");
  return jobState(job?.status);
}

export function jobState(status) {
  return (
    JOB_STATE[status] || {
      label: String(status || "Unknown"),
      tone: "neutral",
      working: false,
      note: "This job is in a state we do not have a word for yet.",
    }
  );
}

/** The pipeline as the person moves through it, with the worker's own honest
 *  estimates (JobStatusPipeline's original figures, kept). */
export const PIPELINE_STAGES = [
  { key: "queued", label: "Waiting for the worker", note: "Usually seconds" },
  { key: "downloading", label: "Downloading the source", note: "1–3 minutes" },
  { key: "transcribing", label: "Transcribing the audio", note: "1–2 minutes" },
  { key: "analyzing", label: "Analysing for moments", note: "Under a minute" },
  { key: "rendering", label: "Rendering clips", note: "2–5 minutes" },
  { key: "stitching", label: "Assembling the full reel", note: "Seconds" },
];

const STAGE_ORDER = PIPELINE_STAGES.map((stage) => stage.key);

function normaliseErrorStage(errorStage) {
  const value = String(errorStage || "").toLowerCase();
  if (value.includes("download")) return "downloading";
  if (value.includes("transcrib")) return "transcribing";
  if (value.includes("analy")) return "analyzing";
  if (value.includes("stitch")) return "stitching";
  if (value.includes("render")) return "rendering";
  if (value.includes("queue")) return "queued";
  return "rendering";
}

export function stageState(stageKey, status, errorStage) {
  if (status === "failed") {
    const failedAt = normaliseErrorStage(errorStage);
    if (stageKey === failedAt) return "failed";
    return STAGE_ORDER.indexOf(stageKey) < STAGE_ORDER.indexOf(failedAt) ? "done" : "todo";
  }
  if (status === "complete") return "done";

  const current = STAGE_ORDER.indexOf(status);
  const index = STAGE_ORDER.indexOf(stageKey);
  if (current === -1) return "todo";
  if (index < current) return "done";
  if (index === current) return "active";
  return "todo";
}

/**
 * Turn a provider error into something a person can act on.
 *
 * Ported unchanged in substance from JobStatusPipeline: the raw text used to be
 * the ONLY thing shown, so users read yt-dlp output verbatim — "Sign in to
 * confirm you're not a bot. Use --cookies-from-browser" — which is both the most
 * common real failure on this pipeline and completely meaningless to them.
 */
export function explainJobError(raw, stage) {
  const text = String(raw || "").toLowerCase();

  if (text.includes("sign in to confirm") || text.includes("not a bot") || text.includes("cookies-from-browser")) {
    return {
      headline: "YouTube blocked the download.",
      body: "It does this to servers it does not recognise. It is not something you did wrong, and it is not about this particular video.",
      remedy: "Upload the file directly. That path does not depend on YouTube and has never failed for this reason.",
      remedyIsUpload: true,
    };
  }
  if (text.includes("requested format is not available") || text.includes("no video formats")) {
    return {
      headline: "That video is not available in a format we can download.",
      body: "The platform did not offer a stream this pipeline can read.",
      remedy: "Try a different source, or upload the file directly.",
      remedyIsUpload: true,
    };
  }
  if (text.includes("private") || text.includes("members-only") || text.includes("unavailable")) {
    return {
      headline: "That video is private, restricted, or unavailable in this region.",
      body: "We can only fetch videos that are publicly viewable.",
      remedy: "Use a public video, or upload the file directly.",
      remedyIsUpload: true,
    };
  }
  if (text.includes("no audio")) {
    return {
      headline: "That video has no audio track.",
      body: "Clipping works from speech — the transcript is what tells us which moments are worth cutting.",
      remedy: null,
      remedyIsUpload: false,
    };
  }
  if (text.includes("no longer on the worker") || text.includes("upload it again")) {
    return {
      headline: "The uploaded file is no longer on the processor.",
      body: "Uploads are held for 24 hours and are cleared when the processor is redeployed.",
      remedy: "Upload the file again to run this.",
      remedyIsUpload: true,
    };
  }
  if (text.includes("timed out") || text.includes("timeout")) {
    return {
      headline: "Processing took too long and was stopped.",
      body: "Long sources are more likely to hit the time limit.",
      remedy: "Try again, or use a shorter source.",
      remedyIsUpload: false,
    };
  }
  if (text.includes("api key") || text.includes("unauthorized") || text.includes("401")) {
    return {
      headline: "The video service is not configured correctly.",
      body: "This is a problem on our side, not yours. Nothing you change will fix it.",
      remedy: null,
      remedyIsUpload: false,
    };
  }

  return {
    headline: stage ? `Something went wrong at the "${stage}" step.` : "Something went wrong while processing this video.",
    body: "We could not finish this job.",
    remedy: "You can run it again, or upload the file directly.",
    remedyIsUpload: false,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** "1:42:09" / "42:18" / "0:43" — the form a timecode is read in. */
export function formatTimecode(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** "43s" / "1m 5s" — a clip's length, which reads better than a timecode. */
export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const minutes = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  if (minutes === 0) return `${secs}s`;
  if (secs === 0) return `${minutes}m`;
  return `${minutes}m ${secs}s`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "6m", "3d" — how long ago, at a glance. */
export function formatAge(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatClockTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Scores arrive on two scales: earlier rows stored 0–1, the current pipeline
 * writes 0–100. Absent stays absent — a missing score must read as unknown,
 * never as zero, because zero is a judgement and null is not.
 */
export function normaliseScore(raw) {
  if (raw === null || raw === undefined) return null;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return null;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}

/** What the source is, said plainly. */
export function sourceLabel(job) {
  const platform = String(job?.source_platform || "").toLowerCase();
  if (platform === "upload") return "Upload";
  if (platform === "youtube") return "YouTube";
  if (platform === "twitter") return "X";
  return platform ? platform.toUpperCase() : "Source";
}

/** A link job has no title until the download stage resolves one, so a queued
 *  or failed link job would otherwise render as blank. */
export function jobTitle(job) {
  if (job?.source_title) return job.source_title;
  const url = String(job?.source_url || "");
  if (url.startsWith("worker://")) return "Uploaded file";
  if (url) return url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 90);
  return "Untitled video";
}

export function isUploadSource(job) {
  return String(job?.source_url || "").startsWith("worker://") || job?.source_platform === "upload";
}

/**
 * The five scores a clip is judged on, normalised, in the order the design
 * shows them: hook leads because it is the strongest single predictor of
 * whether a clip gets watched.
 *
 * Absent stays absent all the way through — the table prints "—" and never 0,
 * because a missing score is unknown and 0 is a verdict.
 */
export function clipScores(clip) {
  return {
    hook: normaliseScore(clip?.hook_score),
    flow: normaliseScore(clip?.flow_score),
    content: normaliseScore(clip?.content_score),
    trend: normaliseScore(clip?.trend_score),
    overall: normaliseScore(clip?.overall_score),
  };
}

/** A clip always has something to be called, even before the model titles it. */
export function clipDisplayTitle(clip) {
  return clip?.ai_title?.trim() || `Clip ${(clip?.clip_index ?? 0) + 1}`;
}

/** Green above 85, plain above 70, muted below — the same three bands
 *  everywhere a score appears, so a number means the same thing in the table
 *  as it does on the card. */
export function scoreBand(value) {
  if (value === null || value === undefined) return "unknown";
  if (value >= 85) return "strong";
  if (value >= 70) return "fair";
  return "weak";
}

/**
 * The job's shape, as a CSS aspect-ratio.
 *
 * Clips do NOT store one — `aspect_ratio` is a column on video_jobs and on
 * nothing else (baseline_video_engine_tables.sql:37). A per-clip "9:16" tag was
 * therefore a label asserting something no row knew, and it read 9:16 over a
 * 16:9 clip. The shape has to be passed down from the job, and where the job
 * does not have one either, nothing is claimed.
 */
export function aspectRatioCss(ratio, fallback = "9 / 16") {
  const match = /^(\d+)\s*[:/]\s*(\d+)$/.exec(String(ratio ?? "").trim());
  if (!match) return fallback;
  return `${match[1]} / ${match[2]}`;
}
