"use client";

import { useState } from "react";
import VideoPlayer from "./VideoPlayer";
import { normalizeScore, scoreColor, formatDuration, SCORE_BAR_COLORS } from "./clip-utils";

function ScoreBar({ label, value, color }) {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 30, flexShrink: 0 }}>
        {label}
      </span>
      <div style={{
        flex:         1,
        height:       3,
        background:   "var(--color-border-tertiary)",
        borderRadius: 2,
        overflow:     "hidden",
      }}>
        <div style={{
          height:     "100%",
          width:      `${value}%`,
          background: color,
          borderRadius: 2,
          transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 22, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

export default function ClipPreviewPanel({ clip, onRefreshUrl }) {
  const [copied, setCopied] = useState(false);

  if (!clip) {
    return (
      <div style={{
        flex:           1,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            8,
        padding:        24,
      }}>
        <div style={{ fontSize: 32, opacity: 0.15 }}>▶</div>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>
          Select a clip from the list on the left
        </p>
      </div>
    );
  }

  if (clip.render_status === "failed") {
    return (
      <div style={{
        flex:           1,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            10,
        padding:        24,
      }}>
        <div style={{ fontSize: 28, color: "var(--color-danger)" }}>⚠</div>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", textAlign: "center" }}>
          This clip failed to render
        </p>
        <p style={{
          fontSize:   11,
          color:      "var(--color-text-secondary)",
          textAlign:  "center",
          lineHeight: 1.55,
          maxWidth:   280,
        }}>
          {clip.error_message || "An error occurred during rendering. The source content may be unsupported."}
        </p>
        <div style={{
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
    );
  }

  const overall = normalizeScore(clip.overall_score);
  const hook    = normalizeScore(clip.hook_score);
  const flow    = normalizeScore(clip.flow_score);
  const value   = normalizeScore(clip.content_score);
  const trend   = normalizeScore(clip.trend_score);

  const copyCaption = () => {
    if (!clip.ai_caption) return;
    navigator.clipboard.writeText(clip.ai_caption)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* Video column — fixed 160px width */}
        {/*
          VideoPlayer has preload="metadata": the browser only fetches the first
          few KB of the video (duration + dimensions) until the user presses play.
          When clip changes, VideoPlayer's useEffect on src resets state to paused.
        */}
        <div style={{
          width:      160,
          flexShrink: 0,
          padding:    "14px 0 14px 14px",
          display:    "flex",
          alignItems: "flex-start",
        }}>
          <VideoPlayer
            src={clip.public_url}
            poster={clip.thumbnail_url || undefined}
            title={clip.ai_title}
            onError={() => onRefreshUrl && onRefreshUrl(clip.id)}
          />
        </div>

        {/* Info column — scrollable */}
        <div style={{
          flex:          1,
          minWidth:      0,
          padding:       "14px 14px 14px 10px",
          overflowY:     "auto",
          display:       "flex",
          flexDirection: "column",
          gap:           10,
        }}>
          {/* Score badge + duration */}
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
                flexShrink:   0,
              }}>
                {overall}
              </div>
            )}
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>virality</span>
            {clip.duration_secs > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>
                {formatDuration(clip.duration_secs)}
              </span>
            )}
          </div>

          {/* Title */}
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", lineHeight: 1.3 }}>
            {clip.ai_title || `Clip ${clip.clip_index + 1}`}
          </div>

          {/* Caption */}
          {clip.ai_caption && (
            <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
              {clip.ai_caption}
            </p>
          )}

          {/* Score breakdown bars */}
          {(hook !== null || flow !== null || value !== null || trend !== null) && (
            <div>
              <ScoreBar label="Hook"  value={hook}  color={SCORE_BAR_COLORS.Hook}  />
              <ScoreBar label="Flow"  value={flow}  color={SCORE_BAR_COLORS.Flow}  />
              <ScoreBar label="Value" value={value} color={SCORE_BAR_COLORS.Value} />
              <ScoreBar label="Trend" value={trend} color={SCORE_BAR_COLORS.Trend} />
            </div>
          )}

          {/* "Why this works" — only when Pack 1 has populated it */}
          {clip.why_this_works && (
            <div style={{
              borderLeft:  "2px solid var(--color-border-tertiary)",
              paddingLeft: 8,
              fontSize:    11,
              color:       "var(--color-text-secondary)",
              fontStyle:   "italic",
              lineHeight:  1.55,
            }}>
              {clip.why_this_works}
            </div>
          )}

          {/* Platform tag */}
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

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 7 }}>
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
                cursor:       clip.ai_caption ? "pointer" : "not-allowed",
                whiteSpace:   "nowrap",
                transition:   "all 0.15s ease",
              }}
            >
              {copied ? "✓ Copied" : "Copy caption"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
