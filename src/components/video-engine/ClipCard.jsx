import React, { useState } from "react";
import { Check, Clipboard, Download, Eye, Loader2, Play, XCircle } from "lucide-react";
import { useClipDownload } from "../../hooks/video-engine/useClipDownload";
import ClipPreviewModal from "./ClipPreviewModal";

const platformLabels = {
  tiktok:    "TikTok",
  reels:     "Reels",
  shorts:    "Shorts",
  universal: "Universal",
};

function getDuration(clip) {
  if (clip.duration_secs) return Math.round(clip.duration_secs);
  return Math.max(0, Math.round(Number(clip.end_time_secs || 0) - Number(clip.start_time_secs || 0)));
}

export default function ClipCard({ clip, index }) {
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const { downloadClip, getStateForClip } = useClipDownload();
  const downloadState = getStateForClip(clip.id);
  const score    = clip.overall_score == null ? null : Math.round(Number(clip.overall_score) * 100);
  const platform = clip.platform_target || "universal";
  const ready    = clip.render_status === "complete" && Boolean(clip.public_url);
  const failed   = clip.render_status === "failed";

  async function copyCaption() {
    if (!clip.ai_caption) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(clip.ai_caption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 3000);
    }
  }

  return (
    <>
      <article className={`ve-clip-card${failed ? " failed" : ""}`}>
        <div className="ve-clip-thumb">
          {clip.thumbnail_url ? (
            <img src={clip.thumbnail_url} alt={clip.ai_title || `Clip ${index + 1} thumbnail`} loading="lazy" />
          ) : (
            <div className="ve-thumb-placeholder">
              <Play size={26} aria-hidden="true" />
            </div>
          )}
          {score !== null ? <span className="ve-score-chip" aria-hidden="true">{score}%</span> : null}
        </div>

        <div className="ve-clip-body">
          <div>
            <h3>{clip.ai_title || `Clip ${index + 1}`}</h3>
            <div className="ve-clip-meta">
              <span className={`ve-platform ve-platform-${platform}`}>{platformLabels[platform] || "Universal"}</span>
              <span>{getDuration(clip)}s</span>
            </div>
          </div>

          {score !== null ? (
            <div
              className="ve-score-bar"
              role="progressbar"
              aria-valuenow={score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Overall score: ${score}%`}
            >
              <span style={{ width: `${score}%` }} />
            </div>
          ) : null}

          {failed ? (
            <div className="ve-clip-failed">
              <XCircle size={16} aria-hidden="true" />
              <span>Processing failed</span>
            </div>
          ) : ready ? (
            <div className="ve-clip-actions">
              <button type="button" className="ve-secondary-btn" onClick={() => setShowPreview(true)}>
                <Eye size={15} aria-hidden="true" />
                Preview
              </button>

              <button
                type="button"
                className="ve-secondary-btn"
                onClick={() => downloadClip(clip.id, clip.ai_title || `clip_${index + 1}`, clip.clip_index ?? index)}
                disabled={downloadState !== "idle"}
                aria-label={downloadState === "refreshing" ? "Preparing download" : downloadState === "error" ? "Retry download" : "Download clip"}
              >
                {downloadState === "refreshing"
                  ? <Loader2 size={15} className="ve-spin" aria-hidden="true" />
                  : <Download size={15} aria-hidden="true" />}
                {downloadState === "refreshing" ? "Preparing" : downloadState === "error" ? "Retry" : "Download"}
              </button>

              <button
                type="button"
                className={`ve-secondary-btn ve-wide-action${copyFailed ? " ve-btn-error" : ""}`}
                onClick={copyCaption}
                disabled={!clip.ai_caption}
                aria-label={copied ? "Caption copied" : copyFailed ? "Copy failed" : "Copy caption"}
              >
                {copied
                  ? <Check size={15} aria-hidden="true" />
                  : <Clipboard size={15} aria-hidden="true" />}
                {copied ? "Copied!" : copyFailed ? "Copy failed" : "Copy caption"}
              </button>
            </div>
          ) : (
            <div className="ve-clip-rendering">
              <Loader2 size={16} className="ve-spin" aria-hidden="true" />
              <span>Rendering…</span>
            </div>
          )}
        </div>
      </article>

      {showPreview && ready ? <ClipPreviewModal clip={clip} onClose={() => setShowPreview(false)} /> : null}
    </>
  );
}
