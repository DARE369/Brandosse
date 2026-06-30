"use client";

import { useState, useEffect } from "react";
import VideoPlayer from "./VideoPlayer";
import { normalizeScore, scoreColor, formatDuration, SCORE_BAR_COLORS } from "./clip-utils";

function ScoreBar({ label, value, color }) {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 30, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: "var(--color-border-tertiary)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 22, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function PreviewModal({ clip, onClose, onRefreshUrl }) {
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, []);

  if (!clip) return null;

  const overall  = normalizeScore(clip.overall_score);
  const hook     = normalizeScore(clip.hook_score);
  const flow     = normalizeScore(clip.flow_score);
  const value    = normalizeScore(clip.content_score);
  const trend    = normalizeScore(clip.trend_score);
  const isFailed = clip.render_status === "failed";

  const copyCaption = () => {
    if (!clip.ai_caption) return;
    navigator.clipboard.writeText(clip.ai_caption)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  };

  return (
    /*
      position:absolute so the overlay fills the gallery's containing block (which
      has position:relative). Do NOT use position:fixed — it collapses iframe height.
    */
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={clip.ai_title || "Clip preview"}
      style={{
        position:       "absolute",
        inset:          0,
        background:     "rgba(0, 0, 0, 0.55)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         100,
        padding:        16,
      }}
    >
      {/* Modal card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:    "var(--color-background-primary)",
          borderRadius:  "var(--border-radius-lg)",
          border:        "0.5px solid var(--color-border-tertiary)",
          maxWidth:      620,
          width:         "100%",
          maxHeight:     "90vh",
          overflowY:     "auto",
          display:       "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          10,
          padding:      "12px 16px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          flexShrink:   0,
        }}>
          <span style={{
            fontSize:     13,
            fontWeight:   500,
            color:        "var(--color-text-primary)",
            flex:         1,
            minWidth:     0,
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}>
            {clip.ai_title || `Clip ${clip.clip_index + 1}`}
          </span>
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{
              width:          28,
              height:         28,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              border:         "0.5px solid var(--color-border-tertiary)",
              borderRadius:   "var(--border-radius-md)",
              background:     "var(--color-background-secondary)",
              color:          "var(--color-text-secondary)",
              cursor:         "pointer",
              fontSize:       14,
              flexShrink:     0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {isFailed ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 28, color: "var(--color-danger)", marginBottom: 10 }}>⚠</div>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "var(--color-text-primary)" }}>
              This clip failed to render
            </p>
            <p style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55, marginBottom: 12 }}>
              {clip.error_message || "An error occurred during rendering."}
            </p>
            <div style={{
              display:      "inline-block",
              padding:      "4px 12px",
              borderRadius: 20,
              background:   "var(--color-success-bg)",
              color:        "var(--color-success-text)",
              fontSize:     10,
              fontWeight:   500,
              border:       "0.5px solid var(--color-success-border)",
            }}>
              Credits not deducted
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 0, padding: 16 }}>
            {/* Video — 200px wide */}
            <div style={{ width: 200, flexShrink: 0, marginRight: 16 }}>
              <VideoPlayer
                src={clip.public_url}
                poster={clip.thumbnail_url || undefined}
                title={clip.ai_title}
                onError={() => onRefreshUrl && onRefreshUrl(clip.id)}
              />
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {overall !== null && (
                  <div style={{
                    padding:      "3px 10px",
                    borderRadius: 12,
                    background:   `${scoreColor(overall)}18`,
                    color:        scoreColor(overall),
                    border:       `1px solid ${scoreColor(overall)}33`,
                    fontSize:     12,
                    fontWeight:   600,
                  }}>
                    {overall}
                  </div>
                )}
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>virality</span>
                {clip.duration_secs > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {formatDuration(clip.duration_secs)}
                  </span>
                )}
              </div>

              {clip.ai_caption && (
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                  {clip.ai_caption}
                </p>
              )}

              {(hook !== null || flow !== null || value !== null || trend !== null) && (
                <div>
                  <ScoreBar label="Hook"  value={hook}  color={SCORE_BAR_COLORS.Hook}  />
                  <ScoreBar label="Flow"  value={flow}  color={SCORE_BAR_COLORS.Flow}  />
                  <ScoreBar label="Value" value={value} color={SCORE_BAR_COLORS.Value} />
                  <ScoreBar label="Trend" value={trend} color={SCORE_BAR_COLORS.Trend} />
                </div>
              )}

              {clip.why_this_works && (
                <div style={{
                  borderLeft:  "2px solid var(--color-border-tertiary)",
                  paddingLeft: 8,
                  fontSize:    11,
                  color:       "var(--color-text-secondary)",
                  fontStyle:   "italic",
                  lineHeight:  1.5,
                }}>
                  {clip.why_this_works}
                </div>
              )}

              {clip.platform_target && (
                <div>
                  <span style={{
                    fontSize:     10,
                    padding:      "2px 8px",
                    borderRadius: 8,
                    background:   "var(--color-background-secondary)",
                    border:       "0.5px solid var(--color-border-tertiary)",
                    color:        "var(--color-text-secondary)",
                  }}>
                    {clip.platform_target}
                  </span>
                </div>
              )}

              <div style={{ display: "flex", gap: 7, marginTop: "auto" }}>
                <a
                  href={clip.public_url}
                  download={`clip-${clip.clip_index + 1}.mp4`}
                  style={{
                    flex:           1,
                    padding:        "7px 10px",
                    borderRadius:   "var(--border-radius-md)",
                    background:     "var(--color-text-primary)",
                    color:          "var(--color-background-primary)",
                    textAlign:      "center",
                    fontSize:       11,
                    fontWeight:     500,
                    textDecoration: "none",
                    display:        "block",
                  }}
                >
                  ↓ Download
                </a>
                <button
                  onClick={copyCaption}
                  disabled={!clip.ai_caption}
                  style={{
                    padding:      "7px 10px",
                    borderRadius: "var(--border-radius-md)",
                    border:       `0.5px solid ${copied ? "var(--color-success-border)" : "var(--color-border-tertiary)"}`,
                    background:   copied ? "var(--color-success-bg)" : "var(--color-background-primary)",
                    color:        copied ? "var(--color-success-text)" : "var(--color-text-primary)",
                    fontSize:     11,
                    cursor:       "pointer",
                    whiteSpace:   "nowrap",
                  }}
                >
                  {copied ? "✓ Copied" : "Copy caption"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
