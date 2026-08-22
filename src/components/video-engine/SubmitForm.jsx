import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Coins, FileVideo, Layers, Link2, Loader2, Send, Upload, Video, WifiOff } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { VIDEO_ENGINE_CONSTANTS } from "../../lib/video-engine/constants";
import { useWorkerHealth } from "../../hooks/video-engine/useWorkerHealth";
import { requestUploadTicket, submitVideoJob } from "../../services/videoEngineApi";
import { fetchUserJobs } from "../../services/videoEngineData";
import ClipSettingsPanel from "./ClipSettingsPanel";

// Mirrors MAX_CONCURRENT_JOBS / activeStatuses in src/lib/video-engine/rate-limiter.ts
// (the actual server-enforced limit) — kept in sync here only so the UI can
// show real slot usage before submitting, not to duplicate the enforcement.
const MAX_CONCURRENT_JOBS = 2;
const ACTIVE_JOB_STATUSES = ["queued", "downloading", "transcribing", "analyzing", "rendering"];

// ─── Upload source ───────────────────────────────────────────────────────────
// The worker has always supported source_platform = 'upload'
// (stages/download.py:203) and app/api/video/submit accepts it, but no UI could
// ever create such a job and the bucket it reads from did not exist. This is
// that missing third of the feature.
//
// It matters more than convenience: uploading is the ONLY ingestion path that
// does not depend on YouTube tolerating a datacenter IP. Link ingestion is kept,
// and kept honest about being the less reliable of the two.
// Uploads go STRAIGHT TO THE WORKER, not to Supabase Storage.
//
// Supabase on this project refuses any bucket limit above 50MB (the free-plan
// ceiling, measured 2026-08-22 — 1024/500/200MB all rejected with HTTP 413). A
// 60-minute 1080p podcast is 1-3GB, so that path only ever worked for the wrong
// size of video, and raising it is a paid plan rather than a code change.
//
// The worker already has a paid-for 25GB volume. Uploading there costs nothing
// extra, has no 50MB ceiling, and skips a download hop — the file lands on the
// machine that needs it. Auth is a short-lived signed ticket from
// /api/video/upload-ticket; the worker secret never reaches the browser.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const ACCEPTED_VIDEO_TYPES = [
  "video/mp4", "video/quicktime", "video/x-matroska",
  "video/webm", "video/x-msvideo", "video/mpeg",
];

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

/** Reject before uploading, so a doomed file never costs the user the wait. */
function validateFile(file) {
  if (!file) return "Choose a video file.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — `
      + "compress it, trim it, or paste a link instead.";
  }
  if (file.size === 0) return "That file is empty.";
  if (file.type && !ACCEPTED_VIDEO_TYPES.includes(file.type)) {
    return `${file.type || "That file type"} is not a supported video format. Use MP4, MOV, MKV, WebM or AVI.`;
  }
  return "";
}

function getUrlParam() {
  try {
    return new URLSearchParams(window.location.search).get("url") || "";
  } catch {
    return "";
  }
}

function detectPlatform(url) {
  const trimmed = url.trim();
  if (!trimmed) return null;

  for (const pattern of VIDEO_ENGINE_CONSTANTS.YOUTUBE_URL_PATTERNS) {
    if (pattern.test(trimmed)) return "youtube";
  }

  for (const pattern of VIDEO_ENGINE_CONSTANTS.TWITTER_URL_PATTERNS) {
    if (pattern.test(trimmed)) return "twitter";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return "unknown";
  return null;
}

const platformCopy = {
  youtube: { label: "YouTube detected", tone: "success" },
  twitter: { label: "Twitter / X detected", tone: "success" },
  unknown: { label: "Platform not supported. Paste a YouTube or Twitter/X URL.", tone: "warning" },
};

// ─── Preferences state ───────────────────────────────────────────────────────

const initialPrefs = {
  aspectRatio:      "9:16",
  captionStyle:     "karaoke",
  clipCountTarget:  "",
  minDuration:      "",
  maxDuration:      "",
  specificMoments:  "",
};

function prefsReducer(state, action) {
  switch (action.type) {
    case "SET_ASPECT_RATIO":
      return { ...state, aspectRatio: action.payload };
    case "SET_CAPTION_STYLE":
      return { ...state, captionStyle: action.payload };
    case "SET_CLIP_COUNT":
      return { ...state, clipCountTarget: action.payload };
    case "SET_MIN_DURATION": {
      const next = { ...state, minDuration: action.payload };
      // Guard: clear maxDuration if it is now <= minDuration
      if (
        next.minDuration !== "" &&
        next.maxDuration !== "" &&
        parseInt(next.minDuration, 10) >= parseInt(next.maxDuration, 10)
      ) {
        next.maxDuration = "";
      }
      return next;
    }
    case "SET_MAX_DURATION": {
      const next = { ...state, maxDuration: action.payload };
      // Guard: clear minDuration if it is now >= maxDuration
      if (
        next.minDuration !== "" &&
        next.maxDuration !== "" &&
        parseInt(next.maxDuration, 10) <= parseInt(next.minDuration, 10)
      ) {
        next.minDuration = "";
      }
      return next;
    }
    case "SET_SPECIFIC_MOMENTS":
      return { ...state, specificMoments: action.payload };
    case "RESET":
      return initialPrefs;
    default:
      return state;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SubmitForm({ initialCredits = 0, creditError = "" }) {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const workerStatus = useWorkerHealth();
  const [url, setUrl] = useState(getUrlParam);
  const [debouncedUrl, setDebouncedUrl] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const debounceRef = useRef(null);

  // "upload" is the default because it is the path that actually works — it
  // needs nothing from YouTube. See SOURCE_BUCKET above.
  const [sourceMode, setSourceMode] = useState("upload");
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [prefs, dispatchPrefs] = useReducer(prefsReducer, initialPrefs);

  useEffect(() => {
    if (!user?.id) return;
    fetchUserJobs(user.id)
      .then((jobs) => setActiveJobsCount(jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status)).length))
      .catch(() => {});
  }, [user?.id]);

  const slotsFull = activeJobsCount >= MAX_CONCURRENT_JOBS;

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedUrl(url), 280);
    return () => clearTimeout(debounceRef.current);
  }, [url]);

  const detected = useMemo(() => detectPlatform(debouncedUrl), [debouncedUrl]);
  const hasEnoughCredits = initialCredits >= VIDEO_ENGINE_CONSTANTS.MIN_CREDITS_REQUIRED;
  const linkReady = ["youtube", "twitter"].includes(detected);
  const fileReady = Boolean(file) && !validateFile(file);
  const canSubmit = !isSubmitting && !isUploading && !slotsFull && hasEnoughCredits
    && (sourceMode === "upload" ? fileReady : linkReady);

  function handleFileChange(event) {
    const chosen = event.target.files?.[0] || null;
    setFile(chosen);
    // Validate immediately so the problem is visible while the file picker is
    // still fresh in mind, not after pressing submit.
    setError(chosen ? validateFile(chosen) : "");
  }

  /**
   * Put the file in the user's own folder and hand the worker the path.
   *
   * The path shape is load-bearing: the storage policies scope every operation
   * to (storage.foldername(name))[1] = auth.uid(), so `{user_id}/{uuid}.{ext}`
   * is what makes one user unable to read another's unpublished source video.
   */
  async function uploadSource(chosen) {
    // 1. Ask our own server for a signed, short-lived permission slip. The
    //    worker secret stays on the server; the browser only ever holds an HMAC
    //    bound to this user and this one upload.
    const ticket = await requestUploadTicket();

    // 2. Send the bytes straight to the worker's volume.
    const ext = (chosen.name.split(".").pop() || "mp4").toLowerCase().slice(0, 5);
    const response = await fetch(ticket.upload_url, {
      method: "POST",
      headers: {
        "Content-Type": chosen.type || "video/mp4",
        "X-Upload-User": ticket.user_id,
        "X-Upload-Id": ticket.upload_id,
        "X-Upload-Expires": String(ticket.expires_at),
        "X-Upload-Signature": ticket.signature,
        "X-Upload-Ext": ext,
      },
      body: chosen,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json())?.detail || "";
      } catch {
        detail = await response.text().catch(() => "");
      }
      if (response.status === 507) {
        throw new Error(detail || "The worker is out of disk space. Try again once current jobs finish.");
      }
      if (response.status === 413) {
        throw new Error(detail || `That file is over the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`);
      }
      if (response.status === 403) {
        throw new Error("That upload window expired. Reload the page and try again.");
      }
      throw new Error(detail || `Upload failed (HTTP ${response.status}).`);
    }

    // 3. The job stores a worker:// reference. download.py recognises it and
    //    skips fetching, because the file is already on the machine.
    return ticket.source_url;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setIsSubmitting(true);

    try {
      let sourceUrl = url.trim();
      let sourcePlatform = detected;

      if (sourceMode === "upload") {
        const problem = validateFile(file);
        if (problem) throw new Error(problem);
        setIsUploading(true);
        try {
          // The job stores the storage PATH, not a public URL — the bucket is
          // private and the worker reads it with the service role.
          sourceUrl = await uploadSource(file);
          sourcePlatform = "upload";
        } finally {
          setIsUploading(false);
        }
      }

      const payload = {
        url:      sourceUrl,
        platform: sourcePlatform,
        // Only send non-default preferences so the API applies DB defaults
        ...(prefs.aspectRatio  !== "9:16"    && { aspect_ratio:       prefs.aspectRatio }),
        ...(prefs.captionStyle !== "karaoke"  && { caption_style:      prefs.captionStyle }),
        ...(prefs.clipCountTarget !== ""      && { clip_count_target:  parseInt(prefs.clipCountTarget, 10) }),
        ...(prefs.minDuration    !== ""       && { min_duration_secs:  parseInt(prefs.minDuration, 10) }),
        ...(prefs.maxDuration    !== ""       && { max_duration_secs:  parseInt(prefs.maxDuration, 10) }),
        ...(prefs.specificMoments.trim() !== "" && { specific_moments: prefs.specificMoments.trim() }),
      };

      const result = await submitVideoJob(payload);
      navigate(`/app/video/jobs/${result.job_id}`);
    } catch (submitError) {
      setError(submitError.message || "Submission failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="ve-page ve-submit-page" aria-labelledby="ve-submit-title">
      <div className="ve-page-header">
        <div>
          <button
            type="button"
            className="ve-back-btn"
            onClick={() => navigate("/app/video/jobs")}
            aria-label="Back to My videos"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            My videos
          </button>
          <p className="ve-kicker">Video engine</p>
          <h1 id="ve-submit-title">Process a video</h1>
          <p>Upload a video, or paste a link, and turn its strongest moments into ready-to-post clips.</p>
        </div>

        <div className="ve-icon-shell" aria-hidden="true">
          <Video size={22} />
        </div>
      </div>

      <form className="ve-submit-card" onSubmit={handleSubmit} noValidate>
        <div className="ve-source-modes" role="tablist" aria-label="Where the video comes from">
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === "upload"}
            className={`ve-source-mode ${sourceMode === "upload" ? "is-active" : ""}`}
            onClick={() => { setSourceMode("upload"); setError(""); }}
          >
            <Upload size={16} aria-hidden="true" />
            <span>Upload a file</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === "link"}
            className={`ve-source-mode ${sourceMode === "link" ? "is-active" : ""}`}
            onClick={() => { setSourceMode("link"); setError(""); }}
          >
            <Link2 size={16} aria-hidden="true" />
            <span>Paste a link</span>
          </button>
        </div>

        {sourceMode === "upload" ? (
          <label className="ve-field ve-field-file" htmlFor="ve-file-input">
            <span>Video file</span>
            <input
              id="ve-file-input"
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_VIDEO_TYPES.join(",")}
              onChange={handleFileChange}
              aria-describedby="ve-url-hint"
            />
            {file ? (
              <span className="ve-file-chosen">
                <FileVideo size={15} aria-hidden="true" />
                {file.name} — {formatBytes(file.size)}
              </span>
            ) : (
              <span className="ve-field-hint">
                MP4, MOV, MKV, WebM or AVI, up to {formatBytes(MAX_UPLOAD_BYTES)}. Uploaded straight to the processor.
              </span>
            )}
          </label>
        ) : (
          <label className="ve-field" htmlFor="ve-url-input">
            <span>Video URL</span>
            <input
              id="ve-url-input"
              type="url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setError(""); }}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
              aria-describedby="ve-url-hint"
              aria-invalid={detected === "unknown" ? "true" : "false"}
            />
            {/* Said before they submit, not after it fails. YouTube blocks
                datacenter IPs and the block moves; uploading does not depend on
                anyone's tolerance. */}
            <span className="ve-field-hint">
              Links can fail — YouTube blocks automated downloads from servers, and when it
              does there is nothing this app can do about it. Uploading the file always works.
            </span>
          </label>
        )}

        <div className="ve-submit-meta" id="ve-url-hint">
          <div className="ve-meta-row">
            <Coins size={17} aria-hidden="true" />
            <span>
              <strong>{initialCredits}</strong> credits available
            </span>
          </div>
          <div className="ve-meta-row ve-meta-rate">
            <span>1 credit / minute of video</span>
          </div>
          <div className="ve-meta-row">
            <Layers size={16} aria-hidden="true" />
            <span>
              <strong>{activeJobsCount}</strong> of {MAX_CONCURRENT_JOBS} processing slots in use
            </span>
          </div>
        </div>

        <ClipSettingsPanel prefs={prefs} dispatch={dispatchPrefs} />

        {slotsFull ? (
          <div className="ve-inline-status ve-inline-warning" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>
              You already have {activeJobsCount} video{activeJobsCount === 1 ? "" : "s"} being processed. Wait for one
              to finish before submitting another.
            </span>
          </div>
        ) : null}

        {workerStatus === "unhealthy" ? (
          <div className="ve-inline-status ve-inline-warning" role="status">
            <WifiOff size={16} aria-hidden="true" />
            <span>Video worker is offline. Jobs can be queued but will start once the worker restarts.</span>
          </div>
        ) : null}

        {creditError ? (
          <div className="ve-inline-status ve-inline-warning" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{creditError}</span>
          </div>
        ) : null}

        {sourceMode === "link" && detected ? (
          <div
            className={`ve-inline-status ve-inline-${platformCopy[detected].tone}`}
            aria-live="polite"
            role="status"
          >
            <AlertCircle size={16} aria-hidden="true" />
            <span>{platformCopy[detected].label}</span>
          </div>
        ) : null}

        {!hasEnoughCredits ? (
          <div className="ve-inline-status ve-inline-warning" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>
              You need at least {VIDEO_ENGINE_CONSTANTS.MIN_CREDITS_REQUIRED} credits to process a video.{" "}
              <button type="button" onClick={() => navigate("/app/billing")}>
                Buy credits
              </button>
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="ve-inline-status ve-inline-danger" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <button className="ve-primary-btn" type="submit" disabled={!canSubmit}>
          {isSubmitting ? <Loader2 size={17} className="ve-spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          <span>{isUploading ? "Uploading…" : isSubmitting ? "Starting job…" : "Process video"}</span>
          {!isSubmitting ? <ArrowRight size={16} aria-hidden="true" /> : null}
        </button>
      </form>
    </section>
  );
}
