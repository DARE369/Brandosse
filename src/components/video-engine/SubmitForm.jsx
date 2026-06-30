import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Coins, Loader2, Send, Video, WifiOff } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { VIDEO_ENGINE_CONSTANTS } from "../../lib/video-engine/constants";
import { useWorkerHealth } from "../../hooks/video-engine/useWorkerHealth";
import { submitVideoJob } from "../../services/videoEngineApi";
import ClipSettingsPanel from "./ClipSettingsPanel";

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
  const workerStatus = useWorkerHealth();
  const [url, setUrl] = useState("");
  const [debouncedUrl, setDebouncedUrl] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const debounceRef = useRef(null);

  const [prefs, dispatchPrefs] = useReducer(prefsReducer, initialPrefs);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedUrl(url), 280);
    return () => clearTimeout(debounceRef.current);
  }, [url]);

  const detected = useMemo(() => detectPlatform(debouncedUrl), [debouncedUrl]);
  const hasEnoughCredits = initialCredits >= VIDEO_ENGINE_CONSTANTS.MIN_CREDITS_REQUIRED;
  const canSubmit = !isSubmitting && hasEnoughCredits && ["youtube", "twitter"].includes(detected);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setIsSubmitting(true);

    try {
      const payload = {
        url:      url.trim(),
        platform: detected,
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
          <p>Paste a YouTube or Twitter/X URL and turn the strongest moments into ready-to-post clips.</p>
        </div>

        <div className="ve-icon-shell" aria-hidden="true">
          <Video size={22} />
        </div>
      </div>

      <form className="ve-submit-card" onSubmit={handleSubmit} noValidate>
        <label className="ve-field" htmlFor="ve-url-input">
          <span>Video URL</span>
          <input
            id="ve-url-input"
            type="url"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setError(""); }}
            placeholder="https://www.youtube.com/watch?v=..."
            autoFocus
            autoComplete="off"
            aria-describedby="ve-url-hint"
            aria-invalid={detected === "unknown" ? "true" : "false"}
          />
        </label>

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
        </div>

        <ClipSettingsPanel prefs={prefs} dispatch={dispatchPrefs} />

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

        {detected ? (
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
              <button type="button" onClick={() => navigate("/app/billing/credits")}>
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
          <span>{isSubmitting ? "Starting job…" : "Process video"}</span>
          {!isSubmitting ? <ArrowRight size={16} aria-hidden="true" /> : null}
        </button>
      </form>
    </section>
  );
}
