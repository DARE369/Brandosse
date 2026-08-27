"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Link2, Loader2, Upload, X } from "lucide-react";
import { Button } from "../../../ui-v2";
import { VIDEO_ENGINE_CONSTANTS } from "../../../lib/video-engine/constants";
import { requestUploadTicket, submitVideoJob, uploadSourceToWorker } from "../../../services/videoEngineApi";
import usePersistentState from "../../../hooks/usePersistentState";
import { CaptionStylePicker } from "./CaptionStylePicker";
import { formatBytes, formatTimecode } from "../videoShared";
import styles from "./NewJobSheet.module.css";

/**
 * Submitting a job, as a sheet over the list rather than a separate page.
 *
 * ── Why it is not its own route any more ────────────────────────────────────
 * Every question this form raises is answered by the list behind it: how many
 * slots are in use, what is already running, what the balance is. Navigating
 * away from that context to a standalone page and then back again was making
 * the person hold those numbers in their head. The sheet keeps them on screen.
 *
 * ── Two source paths, and they are not equal ────────────────────────────────
 * Uploading always works. Pasting a link depends on the source platform
 * tolerating an automated download from a datacentre, and YouTube frequently
 * does not — 4 of 9 lifetime job failures were exactly that. The interface says
 * so BEFORE the person commits, because after is too late: they have waited
 * through a download and watched it fail.
 *
 * A third tab, "From your Library", is deliberately absent. The worker's
 * storage reader is hardcoded to the video-source-cache bucket
 * (video-worker/database.py:464) and Library uploads cap at 50MB
 * (supabase/functions/personal-asset-upload/index.ts:28), so it could only ever
 * have clipped 2-5 minute videos. A tab that works for almost nothing is worse
 * than no tab.
 */

const ASPECT_RATIOS = [
  { value: "9:16", use: "TikTok · Reels · Shorts" },
  { value: "4:5", use: "Instagram feed" },
  { value: "1:1", use: "Square" },
  { value: "16:9", use: "Landscape · YouTube" },
  // Accepted by app/api/video/submit/route.ts:31 and never offered by the old
  // picker — backend capability with no control in front of it.
  { value: "3:4", use: "Tall feed" },
];

const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
  "video/mpeg",
];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

// Server bounds, mirrored exactly. The old form advertised 1-20 clips while the
// server rejected anything above 15, so a valid-looking entry was refused after
// the fact with a raw validation string.
const CLIP_COUNT_MIN = 1;
const CLIP_COUNT_MAX = 15;
const CLIP_SECONDS_MIN = 10;
const CLIP_SECONDS_MAX = 600;

const DEFAULT_PREFS = {
  aspectRatio: "9:16",
  captionStyle: "karaoke",
  clipCountTarget: "",
  minDuration: "",
  maxDuration: "",
  specificMoments: "",
};

function prefsReducer(state, action) {
  switch (action.type) {
    case "SET":
      return { ...state, [action.field]: action.value };
    case "HYDRATE":
      return { ...DEFAULT_PREFS, ...action.value };
    case "RESET":
      return DEFAULT_PREFS;
    default:
      return state;
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
  if (/^https?:\/\//i.test(trimmed)) return "unsupported";
  return null;
}

function validateFile(file) {
  if (!file) return "Choose a video file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — compress it, trim it, or paste a link instead.`;
  }
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return `${file.type} is not a supported video format. Use MP4, MOV, MKV, WebM, AVI or MPEG.`;
  }
  return "";
}

/** Bytes per second, smoothed, so the estimate does not jitter every frame. */
function useTransferRate() {
  const samples = useRef([]);

  return useCallback((loaded) => {
    const now = Date.now();
    samples.current.push({ at: now, loaded });
    samples.current = samples.current.filter((sample) => now - sample.at < 8000);
    if (samples.current.length < 2) return null;

    const first = samples.current[0];
    const last = samples.current[samples.current.length - 1];
    const seconds = (last.at - first.at) / 1000;
    if (seconds <= 0) return null;
    return (last.loaded - first.loaded) / seconds;
  }, []);
}

export function NewJobSheet({ open, onClose, onSubmitted, capacity, userId }) {
  const [mode, setMode] = useState("upload");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | uploading | submitting
  const [progress, setProgress] = useState(null);

  const [prefs, dispatch] = useReducer(prefsReducer, DEFAULT_PREFS);
  const [remember, setRemember] = usePersistentState("video.rememberSettings", true, {
    userId: userId ?? null,
    enabled: Boolean(userId),
  });
  const [savedPrefs, setSavedPrefs] = usePersistentState("video.defaultPrefs", null, {
    userId: userId ?? null,
    enabled: Boolean(userId),
  });

  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const measureRate = useTransferRate();

  // A daily user re-picking 9:16 and the same caption style forever is a tax the
  // product was charging for nothing.
  useEffect(() => {
    if (open && remember && savedPrefs) dispatch({ type: "HYDRATE", value: savedPrefs });
  }, [open, remember, savedPrefs]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && phase === "idle") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, phase]);

  const detected = useMemo(() => detectPlatform(url), [url]);
  const fileProblem = file ? validateFile(file) : "";

  const balance = capacity?.balance ?? null;
  const minCredits = capacity?.min_credits_to_submit ?? VIDEO_ENGINE_CONSTANTS.MIN_CREDITS_REQUIRED;
  // A null balance means the read failed. Blocking on an unknown would refuse a
  // person who can actually afford it, so an unknown balance does not block —
  // the server is the authority and will refuse properly if it must.
  const blockedOnCredits = balance !== null && balance < minCredits;
  const slotsFull = (capacity?.slots_used ?? 0) >= (capacity?.slots_total ?? 2);
  const hourFull = (capacity?.submitted_this_hour ?? 0) >= (capacity?.hourly_limit ?? 10);

  const sourceReady = mode === "upload" ? Boolean(file) && !fileProblem : detected === "youtube" || detected === "twitter";
  const canSubmit = sourceReady && !blockedOnCredits && !hourFull && phase === "idle";

  function reset() {
    setUrl("");
    setFile(null);
    setError("");
    setProgress(null);
    setPhase("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    if (phase !== "idle") return;
    reset();
    onClose();
  }

  function handleFileChange(event) {
    const chosen = event.target.files?.[0] || null;
    setFile(chosen);
    // Validated immediately, while the file picker is still fresh in mind,
    // rather than after pressing submit.
    setError(chosen ? validateFile(chosen) : "");
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");

    try {
      let sourceUrl = url.trim();
      let platform = detected;

      if (mode === "upload") {
        const problem = validateFile(file);
        if (problem) throw new Error(problem);

        setPhase("uploading");
        setProgress({ loaded: 0, total: file.size, ratio: 0, rate: null });

        const controller = new AbortController();
        abortRef.current = controller;

        const ticket = await requestUploadTicket();
        sourceUrl = await uploadSourceToWorker(file, ticket, {
          signal: controller.signal,
          onProgress: ({ loaded, total, ratio }) => {
            setProgress({ loaded, total, ratio, rate: measureRate(loaded) });
          },
        });
        platform = "upload";
      }

      setPhase("submitting");

      const payload = {
        url: sourceUrl,
        platform,
        // Only non-default values are sent, so absent keys let the database
        // defaults apply rather than being overwritten with an explicit choice
        // the person never made.
        ...(prefs.aspectRatio !== DEFAULT_PREFS.aspectRatio && { aspect_ratio: prefs.aspectRatio }),
        ...(prefs.captionStyle !== DEFAULT_PREFS.captionStyle && { caption_style: prefs.captionStyle }),
        ...(prefs.clipCountTarget !== "" && { clip_count_target: parseInt(prefs.clipCountTarget, 10) }),
        ...(prefs.minDuration !== "" && { min_duration_secs: parseInt(prefs.minDuration, 10) }),
        ...(prefs.maxDuration !== "" && { max_duration_secs: parseInt(prefs.maxDuration, 10) }),
        ...(prefs.specificMoments.trim() !== "" && { specific_moments: prefs.specificMoments.trim() }),
      };

      const result = await submitVideoJob(payload);

      if (remember) setSavedPrefs(prefs);

      reset();
      onSubmitted(result.job_id);
    } catch (submitError) {
      if (submitError?.name === "AbortError") {
        setPhase("idle");
        setProgress(null);
        setError("Upload cancelled. Nothing was charged.");
        return;
      }
      setPhase("idle");
      setProgress(null);
      setError(submitError?.message || "Submission failed. Please try again.");
    } finally {
      abortRef.current = null;
    }
  }

  if (!open) return null;

  const remainingBytes = progress ? Math.max(0, progress.total - progress.loaded) : 0;
  const etaSeconds = progress?.rate && progress.rate > 0 ? remainingBytes / progress.rate : null;

  return (
    <div className={styles.scrim} onMouseDown={handleClose} role="presentation">
      <section
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-job-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <p className={styles.kicker}>New job</p>
            <h2 id="new-job-title" className={styles.title}>What should we clip?</h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={handleClose}
            disabled={phase !== "idle"}
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit} noValidate>
          {/* Refusals first — before the person invests any effort. */}
          {blockedOnCredits ? (
            <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>You need at least {minCredits} credits to start a job. You have {balance}.</strong>
                <p>Your settings stay here while you buy.</p>
              </div>
              <Button size="sm" onClick={() => { window.location.href = "/app/billing"; }}>Add credits</Button>
            </div>
          ) : null}

          {hourFull ? (
            <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>You have hit the hourly limit of {capacity?.hourly_limit} submissions.</strong>
                <p>{capacity?.hour_resets_at ? `A slot frees up at ${new Date(capacity.hour_resets_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.` : "Try again shortly."}</p>
              </div>
            </div>
          ) : null}

          {slotsFull && !hourFull ? (
            <div className={`${styles.notice} ${styles.noticeWarning}`}>
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>Both processing slots are busy — this one would wait.</strong>
                <p>You can still submit; it starts as soon as a slot frees up. If you would rather wait, do not upload a large file yet.</p>
              </div>
            </div>
          ) : null}

          {/* ── Source ── */}
          <div className={styles.tabs} role="tablist" aria-label="Where the video comes from">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "upload"}
              className={mode === "upload" ? styles.tabActive : styles.tab}
              onClick={() => { setMode("upload"); setError(""); }}
              disabled={phase !== "idle"}
            >
              <Upload size={15} aria-hidden="true" /> Upload a file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "link"}
              className={mode === "link" ? styles.tabActive : styles.tab}
              onClick={() => { setMode("link"); setError(""); }}
              disabled={phase !== "idle"}
            >
              <Link2 size={15} aria-hidden="true" /> Paste a link
            </button>
          </div>

          {mode === "upload" ? (
            phase === "uploading" && progress ? (
              <div className={styles.uploadCard}>
                <div className={styles.uploadHead}>
                  <div className={styles.uploadName}>
                    <strong>{file?.name}</strong>
                    <span className={styles.mono}>
                      {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
                      {progress.rate ? ` · ${formatBytes(progress.rate)}/s` : ""}
                      {etaSeconds !== null && Number.isFinite(etaSeconds) ? ` · about ${formatTimecode(etaSeconds)} left` : ""}
                    </span>
                  </div>
                  <Button variant="danger" size="sm" onClick={cancelUpload} type="button">Cancel upload</Button>
                </div>
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                </div>
                <div className={styles.uploadFoot}>
                  <span>Uploading — {Math.round(progress.ratio * 100)}%</span>
                  <span>Nothing is charged yet</span>
                </div>
              </div>
            ) : (
              <label className={styles.dropzone} htmlFor="video-source-file">
                <strong>Drop a video file here, or choose one</strong>
                <span className={styles.mono}>
                  MP4 · MOV · MKV · WEBM · AVI · MPEG — up to {formatBytes(MAX_UPLOAD_BYTES)}, up to{" "}
                  {VIDEO_ENGINE_CONSTANTS.MAX_SOURCE_DURATION_MINUTES} min
                </span>
                <input
                  id="video-source-file"
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  onChange={handleFileChange}
                  className={styles.fileInput}
                />
                {file ? (
                  <span className={styles.chosen}>{file.name} — {formatBytes(file.size)}</span>
                ) : (
                  <span className={styles.hint}>Uploading always works. It is the reliable path.</span>
                )}
              </label>
            )
          ) : (
            <div className={styles.linkField}>
              <input
                type="url"
                value={url}
                onChange={(event) => { setUrl(event.target.value); setError(""); }}
                placeholder="https://www.youtube.com/watch?v=..."
                autoComplete="off"
                className={detected === "unsupported" ? styles.inputBad : styles.input}
                aria-invalid={detected === "unsupported"}
                aria-describedby="link-reliability"
              />
              {detected === "unsupported" ? (
                <p className={styles.errorText}>
                  That link is not supported. Upload the file instead, or paste a YouTube or X link.
                </p>
              ) : null}
              <p className={styles.mono}>
                SUPPORTED — YOUTUBE WATCH · YOUTU.BE · YOUTUBE SHORTS · X STATUS. NOT PLAYLISTS OR PRIVATE VIDEOS.
              </p>
              {/* Said before they submit, not after it fails. */}
              <div id="link-reliability" className={`${styles.notice} ${styles.noticeWarning}`}>
                <AlertCircle size={16} aria-hidden="true" />
                <p>
                  Links can fail. YouTube blocks automated downloads from servers, and when it does there is nothing
                  this app can do about it. If it matters, upload the file instead. Failed jobs are refunded
                  automatically.
                </p>
              </div>
            </div>
          )}

          {/* ── Settings ── */}
          <fieldset className={styles.settings} disabled={phase !== "idle"}>
            <legend className={styles.srOnly}>Clip settings</legend>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Shape</span>
              <div className={styles.chips} role="radiogroup" aria-label="Aspect ratio">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.aspectRatio === ratio.value}
                    className={prefs.aspectRatio === ratio.value ? styles.chipActive : styles.chip}
                    onClick={() => dispatch({ type: "SET", field: "aspectRatio", value: ratio.value })}
                  >
                    <span className={styles.chipValue}>{ratio.value}</span>
                    <span className={styles.chipUse}>{ratio.use}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                Captions — burned in
                <em className={styles.fieldAside}>Previews are approximations of the real output</em>
              </span>
              <CaptionStylePicker
                value={prefs.captionStyle}
                onChange={(value) => dispatch({ type: "SET", field: "captionStyle", value })}
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="clip-count">How many clips</label>
                <div className={styles.inlineField}>
                  <input
                    id="clip-count"
                    type="number"
                    min={CLIP_COUNT_MIN}
                    max={CLIP_COUNT_MAX}
                    placeholder="Auto"
                    value={prefs.clipCountTarget}
                    onChange={(event) => dispatch({ type: "SET", field: "clipCountTarget", value: event.target.value })}
                    className={styles.numberInput}
                  />
                  <span className={styles.hint}>
                    {CLIP_COUNT_MIN}–{CLIP_COUNT_MAX}. Blank lets us decide — usually about{" "}
                    {VIDEO_ENGINE_CONSTANTS.TARGET_CLIPS_PER_JOB}.
                  </span>
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Clip length</span>
                <div className={styles.inlineField}>
                  <input
                    type="number"
                    min={CLIP_SECONDS_MIN}
                    max={CLIP_SECONDS_MAX}
                    placeholder="Min"
                    value={prefs.minDuration}
                    onChange={(event) => dispatch({ type: "SET", field: "minDuration", value: event.target.value })}
                    className={styles.numberInput}
                    aria-label="Minimum clip length in seconds"
                  />
                  <span className={styles.mono}>to</span>
                  <input
                    type="number"
                    min={CLIP_SECONDS_MIN}
                    max={CLIP_SECONDS_MAX}
                    placeholder="Max"
                    value={prefs.maxDuration}
                    onChange={(event) => dispatch({ type: "SET", field: "maxDuration", value: event.target.value })}
                    className={styles.numberInput}
                    aria-label="Maximum clip length in seconds"
                  />
                  <span className={styles.hint}>seconds · {CLIP_SECONDS_MIN}–{CLIP_SECONDS_MAX}</span>
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="specific-moments">
                What to look for <em className={styles.fieldAside}>optional</em>
              </label>
              <textarea
                id="specific-moments"
                rows={3}
                maxLength={500}
                placeholder="e.g. the argument about retention, and anything where they disagree"
                value={prefs.specificMoments}
                onChange={(event) => dispatch({ type: "SET", field: "specificMoments", value: event.target.value })}
                className={styles.textarea}
              />
              <div className={styles.counterRow}>
                <span className={styles.mono}>STEERS WHICH MOMENTS WE PICK</span>
                <span className={styles.mono}>{prefs.specificMoments.length} / 500</span>
              </div>
            </div>

            <label className={styles.remember}>
              <input
                type="checkbox"
                checked={Boolean(remember)}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember these settings for next time
            </label>
          </fieldset>

          {error ? (
            <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {/* ── Cost and submit ── */}
          <footer className={styles.foot}>
            <div className={styles.cost}>
              <span className={styles.fieldLabel}>Cost</span>
              <p className={styles.costRate}>
                {capacity?.credits_per_source_minute ?? 1} credit per minute of source
              </p>
              {/*
                No total is shown, and that is deliberate. The true charge is not
                knowable until the worker has fetched the video and measured it
                (video-worker/job_runner.py:51), so any figure here would be a
                guess dressed as a price. The rate is a fact; a total is not.
              */}
              <p className={styles.costNote}>
                We charge the real figure once we have measured the video, and refund in full if the job fails.
                {balance !== null ? ` Your balance is ${balance}.` : " Your balance could not be read just now."}
              </p>
            </div>

            <div className={styles.submitCol}>
              <Button type="submit" disabled={!canSubmit}>
                {phase === "uploading" ? (
                  <><Loader2 size={15} className={styles.spin} aria-hidden="true" /> Uploading…</>
                ) : phase === "submitting" ? (
                  <><Loader2 size={15} className={styles.spin} aria-hidden="true" /> Starting…</>
                ) : (
                  <>Start clipping <ArrowRight size={15} aria-hidden="true" /></>
                )}
              </Button>
              <span className={styles.mono}>YOU CAN CLOSE THE TAB ONCE IT STARTS</span>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
