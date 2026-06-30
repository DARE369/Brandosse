"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const styles = {
  container: {
    position: "relative",
    width: "100%",
    aspectRatio: "9 / 16",
    backgroundColor: "#000",
    borderRadius: "12px",
    overflow: "hidden",
    cursor: "pointer",
    userSelect: "none",
  },

  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },

  poster: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },

  pausedOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0, 0, 0, 0.20)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  playButton: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  },

  loader: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.4)",
  },

  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: "24px 10px 10px",
    background: "linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.75))",
  },

  progressBar: {
    width: "100%",
    height: 3,
    WebkitAppearance: "none",
    appearance: "none",
    background: "transparent",
    cursor: "pointer",
    marginBottom: 6,
    outline: "none",
    border: "none",
    padding: 0,
    display: "block",
  },

  controlsRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  timeDisplay: {
    color: "rgba(255, 255, 255, 0.85)",
    fontSize: 11,
    fontFamily: "monospace",
    flex: 1,
    lineHeight: 1,
  },

  iconButton: {
    background: "none",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: 14,
    lineHeight: 1,
    opacity: 0.85,
    display: "flex",
    alignItems: "center",
  },

  errorState: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#111",
  },

  errorText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
    maxWidth: 140,
    lineHeight: 1.5,
  },

  errorButton: {
    padding: "6px 14px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 6,
    color: "#fff",
    fontSize: 11,
    cursor: "pointer",
  },
};

function formatTime(secs) {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function VideoPlayer({ src, poster, title, onError }) {
  const videoRef = useRef(null);

  const [playing, setPlaying]       = useState(false);
  const [muted, setMuted]           = useState(true);
  const [progress, setProgress]     = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(0);
  const [isLoading, setIsLoading]   = useState(false);
  const [hasError, setHasError]     = useState(false);
  const [showPoster, setShowPoster] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!video.duration) return;
      setCurrentTime(video.currentTime);
      setProgress((video.currentTime / video.duration) * 100);
    };

    const handleDurationChange = () => {
      setDuration(video.duration || 0);
    };

    const handleWaiting  = () => setIsLoading(true);
    const handlePlaying  = () => { setIsLoading(false); setHasError(false); };
    const handleCanPlay  = () => setIsLoading(false);

    const handleEnded = () => {
      setPlaying(false);
      video.currentTime = 0;
      setProgress(0);
      setCurrentTime(0);
    };

    const handleError = () => {
      setIsLoading(false);
      setHasError(true);
      setPlaying(false);
      if (onError) onError();
    };

    video.addEventListener("timeupdate",      handleTimeUpdate);
    video.addEventListener("durationchange",  handleDurationChange);
    video.addEventListener("waiting",         handleWaiting);
    video.addEventListener("playing",         handlePlaying);
    video.addEventListener("canplay",         handleCanPlay);
    video.addEventListener("ended",           handleEnded);
    video.addEventListener("error",           handleError);

    return () => {
      video.removeEventListener("timeupdate",      handleTimeUpdate);
      video.removeEventListener("durationchange",  handleDurationChange);
      video.removeEventListener("waiting",         handleWaiting);
      video.removeEventListener("playing",         handlePlaying);
      video.removeEventListener("canplay",         handleCanPlay);
      video.removeEventListener("ended",           handleEnded);
      video.removeEventListener("error",           handleError);
    };
  }, [onError]);

  useEffect(() => {
    setHasError(false);
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setShowPoster(true);
  }, [src]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;

    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      setShowPoster(false);
      setIsLoading(true);
      video.play().then(() => {
        setPlaying(true);
        setIsLoading(false);
      }).catch(() => {
        setIsLoading(false);
      });
    }
  }, [playing, hasError]);

  const toggleMute = useCallback((e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !muted;
    setMuted(!muted);
  }, [muted]);

  const handleSeek = useCallback((e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const ratio = parseFloat(e.target.value) / 100;
    video.currentTime = ratio * video.duration;
    setProgress(parseFloat(e.target.value));
  }, []);

  if (!src) {
    return (
      <div style={styles.container}>
        <div style={styles.errorState}>
          <span style={{ fontSize: 28 }}>🎬</span>
          <p style={styles.errorText}>Video not available yet</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} onClick={togglePlay} role="button"
         aria-label={playing ? "Pause video" : `Play ${title || "clip"}`}>

      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        muted={muted}
        playsInline
        preload="metadata"
        style={styles.video}
      />

      {showPoster && poster && !playing && (
        <img src={poster} alt={title || "clip thumbnail"} style={styles.poster} />
      )}

      {isLoading && !hasError && (
        <div style={styles.loader}>
          <LoadingSpinner />
        </div>
      )}

      {hasError && (
        <div style={styles.errorState} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 24 }}>⚠️</span>
          <p style={styles.errorText}>
            Could not load video. The link may have expired.
          </p>
          <button
            style={styles.errorButton}
            onClick={(e) => { e.stopPropagation(); if (onError) onError(); }}
          >
            Refresh link
          </button>
        </div>
      )}

      {!playing && !isLoading && !hasError && (
        <div style={styles.pausedOverlay}>
          <button style={styles.playButton} onClick={togglePlay}
                  aria-label={`Play ${title || "clip"}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#000">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
        </div>
      )}

      {!hasError && (
        <div style={styles.controls} onClick={(e) => e.stopPropagation()}>

          <style>{`
            .vp-range::-webkit-slider-runnable-track {
              background: linear-gradient(
                to right,
                rgba(255,255,255,0.9) 0%,
                rgba(255,255,255,0.9) ${progress}%,
                rgba(255,255,255,0.3) ${progress}%,
                rgba(255,255,255,0.3) 100%
              );
              height: 3px;
              border-radius: 2px;
            }
            .vp-range::-webkit-slider-thumb {
              -webkit-appearance: none;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: #fff;
              margin-top: -3.5px;
              cursor: pointer;
            }
            .vp-range::-moz-range-track {
              background: rgba(255,255,255,0.3);
              height: 3px;
              border-radius: 2px;
            }
            .vp-range::-moz-range-progress {
              background: rgba(255,255,255,0.9);
              height: 3px;
              border-radius: 2px;
            }
            .vp-range::-moz-range-thumb {
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: #fff;
              border: none;
              cursor: pointer;
            }
          `}</style>

          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={handleSeek}
            className="vp-range"
            style={styles.progressBar}
            aria-label="Video progress"
          />

          <div style={styles.controlsRow}>
            <span style={styles.timeDisplay}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <button style={styles.iconButton} onClick={toggleMute}
                    aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? "🔇" : "🔊"}
            </button>
          </div>

        </div>
      )}

    </div>
  );
}

function LoadingSpinner() {
  return (
    <>
      <style>{`
        @keyframes vp-spin { to { transform: rotate(360deg); } }
        .vp-spinner {
          width: 32px; height: 32px;
          border: 3px solid rgba(255,255,255,0.2);
          border-top-color: rgba(255,255,255,0.9);
          border-radius: 50%;
          animation: vp-spin 0.8s linear infinite;
        }
      `}</style>
      <div className="vp-spinner" />
    </>
  );
}
