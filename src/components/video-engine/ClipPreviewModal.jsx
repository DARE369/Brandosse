import React, { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { refreshClipUrl } from "../../services/videoEngineApi";
const platformLabels = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
  universal: "Universal",
};

export default function ClipPreviewModal({ clip, onClose }) {
  const videoRef = useRef(null);
  const attemptsRef = useRef(0);
  const [videoSrc, setVideoSrc] = useState(clip.public_url || "");
  const [refreshState, setRefreshState] = useState("idle");

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleVideoError() {
    if (attemptsRef.current >= 2) {
      setRefreshState("failed");
      return;
    }

    attemptsRef.current += 1;
    setRefreshState("refreshing");

    try {
      const { url } = await refreshClipUrl(clip.id);
      setVideoSrc(url);
      setRefreshState("idle");

      window.setTimeout(() => {
        videoRef.current?.load();
        videoRef.current?.play?.().catch(() => {});
      }, 0);
    } catch {
      setRefreshState("failed");
    }
  }

  return (
    <div className="ve-modal" role="dialog" aria-modal="true" aria-label="Clip preview" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="ve-modal-panel">
        <header className="ve-modal-header">
          <div>
            <h2>{clip.ai_title || `Clip ${Number(clip.clip_index ?? 0) + 1}`}</h2>
            <span className={`ve-platform ve-platform-${clip.platform_target || "universal"}`}>
              {platformLabels[clip.platform_target] || "Universal"}
            </span>
          </div>
          <button className="ve-icon-btn" type="button" onClick={onClose} aria-label="Close preview">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="ve-video-frame">
          {refreshState === "refreshing" ? (
            <div className="ve-video-state">
              <Loader2 size={28} className="ve-spin" aria-hidden="true" />
              <span>Refreshing link...</span>
            </div>
          ) : refreshState === "failed" ? (
            <div className="ve-video-state">
              <Download size={28} aria-hidden="true" />
              <span>Video link expired. Please download instead.</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              autoPlay
              muted
              playsInline
              onError={handleVideoError}
            />
          )}
        </div>

        {clip.ai_caption ? <p className="ve-modal-caption">{clip.ai_caption}</p> : null}
      </div>
    </div>
  );
}
