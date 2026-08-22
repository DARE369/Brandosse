import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, Clock, Download, FileAudio, Film, Loader2, RefreshCw, Search, Sparkles, WifiOff, X } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { JOB_STATUS_ORDER } from "../../lib/video-engine/constants";

const stages = [
  { key: "queued",      label: "In Queue",    description: "Waiting for the worker",       estimate: "Usually seconds", icon: Clock },
  { key: "downloading", label: "Downloading", description: "Fetching source media",         estimate: "1–3 minutes",    icon: Download },
  { key: "transcribing",label: "Transcribing",description: "Creating word-level transcript",estimate: "1–2 minutes",    icon: FileAudio },
  { key: "analyzing",   label: "Analyzing",   description: "Scoring viral moments",         estimate: "Under 1 minute", icon: Search },
  { key: "rendering",   label: "Rendering",   description: "Producing vertical clips",      estimate: "2–5 minutes",    icon: Film },
  { key: "complete",    label: "Complete",    description: "Clips are ready",               estimate: "",               icon: Sparkles },
];

function normalizeErrorStage(errorStage) {
  const v = String(errorStage || "").toLowerCase();
  if (v.includes("download"))  return "downloading";
  if (v.includes("transcrib")) return "transcribing";
  if (v.includes("analy"))     return "analyzing";
  if (v.includes("render"))    return "rendering";
  if (v.includes("queue"))     return "queued";
  return "rendering";
}

function getStageState(stageKey, status, errorStage) {
  if (status === "failed") {
    const failedStage = normalizeErrorStage(errorStage);
    const failedIndex = JOB_STATUS_ORDER.indexOf(failedStage);
    const stageIndex  = JOB_STATUS_ORDER.indexOf(stageKey);
    if (stageKey === failedStage) return "failed";
    if (stageIndex >= 0 && failedIndex >= 0 && stageIndex < failedIndex) return "complete";
    return "pending";
  }
  const currentIndex = JOB_STATUS_ORDER.indexOf(status);
  const stageIndex   = JOB_STATUS_ORDER.indexOf(stageKey);
  if (status === "complete" && stageKey === "complete") return "complete";
  if (stageIndex < currentIndex) return "complete";
  if (stageIndex === currentIndex) return "active";
  return "pending";
}

function StageMarker({ stage, state }) {
  const Icon = stage.icon;
  const stateLabel = { complete: "Done", failed: "Failed", active: "In progress", pending: "Pending" }[state];

  if (state === "complete") return (
    <span className="ve-stage-marker ve-stage-complete" aria-label={`${stage.label}: ${stateLabel}`}>
      <Check size={17} aria-hidden="true" />
    </span>
  );
  if (state === "failed") return (
    <span className="ve-stage-marker ve-stage-failed" aria-label={`${stage.label}: ${stateLabel}`}>
      <X size={17} aria-hidden="true" />
    </span>
  );
  if (state === "active") return (
    <span className="ve-stage-marker ve-stage-active" aria-label={`${stage.label}: ${stateLabel}`}>
      <Loader2 size={17} className="ve-spin" aria-hidden="true" />
    </span>
  );
  return (
    <span className="ve-stage-marker ve-stage-pending" aria-label={`${stage.label}: ${stateLabel}`}>
      <Icon size={17} aria-hidden="true" />
    </span>
  );
}

function useElapsedTime(isActive) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive) { setElapsed(0); return; }
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  if (elapsed < 60) return elapsed > 0 ? `${elapsed}s` : null;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

/**
 * LOCK L2.7 — translate a provider error into something the user can act on.
 *
 * This surface previously rendered `errorMessage` verbatim, so users saw raw
 * yt-dlp output. It also carried a hardcoded line saying credits "have been
 * refunded", which was wired to no refund state at all — the UI asserted a
 * financial fact it had no knowledge of. Both are fixed here: the message is
 * humanised, the raw text is demoted to a collapsed details block, and the
 * refund claim is gone.
 *
 * Ordered most-specific first. Unknown errors fall through to a generic
 * message rather than a guess.
 */
function explainJobError(raw, stage) {
  const text = String(raw || '').toLowerCase();

  // The dominant real-world failure: 4 of 9 lifetime job failures.
  if (text.includes('sign in to confirm') || text.includes('not a bot') || text.includes('cookies-from-browser')) {
    return {
      message: 'YouTube blocked the download. It does this to servers it does not recognise, and it is not something you did wrong.',
      nextStep: 'Try uploading the video file directly instead of pasting a link.',
    };
  }
  if (text.includes('requested format is not available') || text.includes('no video formats')) {
    return {
      message: 'That video is not available in a format we can download.',
      nextStep: 'Try a different source, or upload the file directly.',
    };
  }
  if (text.includes('private') || text.includes('members-only') || text.includes('unavailable')) {
    return {
      message: 'That video is private, restricted, or unavailable in this region.',
      nextStep: 'Use a publicly viewable video, or upload the file directly.',
    };
  }
  if (text.includes('no audio')) {
    return {
      message: 'That video has no audio track, so it cannot be transcribed into clips.',
      nextStep: 'Clipping needs speech to find moments worth cutting.',
    };
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return {
      message: 'Processing took too long and was stopped.',
      nextStep: 'Shorter videos process more reliably. Try again, or use a shorter source.',
    };
  }
  if (text.includes('api key') || text.includes('unauthorized') || text.includes('401')) {
    return {
      message: 'The video service is not configured correctly. This is a problem on our side, not yours.',
      nextStep: null,
    };
  }

  return {
    message: stage
      ? `Something went wrong while we were at the "${stage}" step.`
      : 'Something went wrong while processing this video.',
    nextStep: 'You can try again, or upload the file directly.',
  };
}

export default function JobStatusPipeline({ status, errorMessage, errorStage, sourceTitle, sourceUrl, isConnected, downloadProgress, clips = [] }) {
  const { navigate } = useAppNavigation();
  const isFailed = status === "failed";
  const activeStage = stages.find((s) => s.key === status);
  const elapsedLabel = useElapsedTime(!isFailed && status !== "complete" && status !== "queued");

  const hasDownloadProgress = typeof downloadProgress === "number" && downloadProgress > 0;
  const downloadPercent = hasDownloadProgress ? Math.min(100, Math.round(downloadProgress)) : 0;

  const totalClips = clips.length;
  const doneClips = clips.filter((c) => c.render_status === "complete" || c.render_status === "failed").length;
  const renderPercent = totalClips > 0 ? Math.round((doneClips / totalClips) * 100) : 0;

  // Derived once — this was being recomputed three times per render.
  const failureExplanation = React.useMemo(
    () => explainJobError(errorMessage, errorStage),
    [errorMessage, errorStage],
  );

  return (
    <section className="ve-page ve-status-page" aria-labelledby="ve-status-title">
      <div className="ve-status-nav">
        <button
          type="button"
          className="ve-back-btn"
          onClick={() => navigate("/app/video/jobs")}
          aria-label="Back to My videos"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          My videos
        </button>

        {isFailed ? (
          <button
            type="button"
            className="ve-secondary-btn ve-retry-job-btn"
            onClick={() => navigate(`/app/video/new${sourceUrl ? `?url=${encodeURIComponent(sourceUrl)}` : ''}`)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Try again
          </button>
        ) : null}
      </div>

      <div className="ve-page-header ve-status-header">
        <div>
          {!isConnected ? (
            <p className="ve-kicker ve-kicker-warn">
              <WifiOff size={13} aria-hidden="true" />
              {" "}Reconnecting…
            </p>
          ) : (
            <p className="ve-kicker">Live updates active</p>
          )}
          <h1 id="ve-status-title">{isFailed ? "Processing failed" : "Processing your video"}</h1>
          <p>{sourceTitle || "Updating this page as the worker moves through each stage."}</p>
          {activeStage?.estimate && !isFailed ? (
            <span className="ve-active-estimate">
              {activeStage.description}.{" "}
              {activeStage.estimate}.
              {elapsedLabel ? <span className="ve-elapsed">{" "}({elapsedLabel} elapsed)</span> : null}
            </span>
          ) : null}
        </div>
      </div>

      <ol className="ve-pipeline" aria-label="Processing pipeline">
        {stages.map((stage, index) => {
          const state = getStageState(stage.key, status, errorStage);
          const lineFilled = state === "complete";

          return (
            <li className={`ve-pipeline-stage ve-stage-row-${state}`} key={stage.key}>
              <div className="ve-pipeline-left">
                <StageMarker stage={stage} state={state} />
                {index < stages.length - 1 ? (
                  <span className={`ve-stage-line ${lineFilled ? "filled" : ""}`} aria-hidden="true" />
                ) : null}
              </div>
              <div className="ve-pipeline-copy">
                <strong>{stage.label}</strong>
                <span>{state === "active" ? stage.description : stage.estimate || stage.description}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {status === "downloading" && (
        <div className="ve-progress-section">
          <div className="ve-progress-label">
            <Loader2 size={16} className="ve-spin" style={{ display: "inline", marginRight: "8px" }} aria-hidden="true" />
            Downloading video file...{hasDownloadProgress ? ` ${downloadPercent}%` : ""}
          </div>
          <div className="ve-progress-bar-container">
            {hasDownloadProgress ? (
              <div
                className="ve-progress-bar"
                role="progressbar"
                aria-valuenow={downloadPercent}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label={`Download progress: ${downloadPercent}%`}
                style={{ width: `${downloadPercent}%` }}
              />
            ) : (
              <div className="ve-progress-bar ve-progress-indeterminate" role="progressbar" aria-label="Download in progress" />
            )}
          </div>
          <div className="ve-progress-subtext">Large files may take a few minutes. The page will update automatically when the next stage begins.</div>
        </div>
      )}

      {status === "rendering" && totalClips > 0 && (
        <div className="ve-progress-section">
          <div className="ve-progress-label">
            <Loader2 size={16} className="ve-spin" style={{ display: "inline", marginRight: "8px" }} aria-hidden="true" />
            {doneClips < totalClips
              ? `Rendering clip ${doneClips + 1} of ${totalClips}...`
              : "Finishing up..."}
          </div>
          <div className="ve-progress-bar-container">
            <div
              className="ve-progress-bar"
              role="progressbar"
              aria-valuenow={renderPercent}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label={`Rendering progress: ${doneClips} of ${totalClips} clips complete`}
              style={{ width: `${renderPercent}%` }}
            />
          </div>
          <div className="ve-progress-subtext">Each clip is cropped, captioned, and uploaded individually. This page updates as each one finishes.</div>
        </div>
      )}

      {isFailed && errorMessage ? (
        <div className="ve-error-panel" role="alert">
          <strong>What went wrong</strong>
          <p>{failureExplanation.message}</p>
          {failureExplanation.nextStep ? (
            <p className="ve-error-hint">{failureExplanation.nextStep}</p>
          ) : null}
          {/*
            LOCK L2.7 — the raw provider error is available but demoted.
            It used to be the ONLY thing shown, which meant users saw yt-dlp
            stack output verbatim ("Sign in to confirm you're not a bot. Use
            --cookies-from-browser"). That is the single most common real
            failure on this pipeline — 4 of 9 lifetime failures — and it is
            meaningless to the person reading it.
          */}
          <details className="ve-error-details">
            <summary>Technical detail</summary>
            <pre>{errorMessage}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
