"use client";

import { memo } from "react";
import { normalizeScore, scoreColor, formatDuration, SCORE_BAR_COLORS } from "./clip-utils";

// ─────────────────────────────────────────────────────────────────────────────
// ClipRow — a single row in the list.
//
// Wrapped in React.memo so it only re-renders when its own props change.
// Without memo: selecting clip #3 in a 15-item list re-renders all 15 rows.
// With memo: only the previously-selected and newly-selected rows re-render.
//
// IMPORTANT: the parent must pass a stable `onSelect` reference (via useCallback)
// or React.memo will be invalidated on every parent render regardless.
// ─────────────────────────────────────────────────────────────────────────────
const ClipRow = memo(function ClipRow({ clip, isSelected, onSelect }) {
  const isFailed = clip.render_status === "failed";
  const overall  = normalizeScore(clip.overall_score);
  const hook     = normalizeScore(clip.hook_score);
  const flow     = normalizeScore(clip.flow_score);
  const value    = normalizeScore(clip.content_score);
  const trend    = normalizeScore(clip.trend_score);

  // Dot opacity encodes relative strength — dims dots for scores below 70
  const dotOpacity = (val) => (val === null ? 0 : val >= 70 ? 1 : 0.35);

  return (
    <div
      onClick={() => !isFailed && onSelect(clip.id)}
      role="button"
      aria-selected={isSelected}
      aria-label={
        isFailed
          ? `Clip ${clip.clip_index + 1}: failed - ${clip.error_message || "render failed"}. Credits not deducted.`
          : (clip.ai_title || `Clip ${clip.clip_index + 1}`)
      }
      style={{
        display:      "flex",
        alignItems:   "center",
        height:       68,
        flexShrink:   0,
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        cursor:       isFailed ? "default" : "pointer",
        background:   isSelected
          ? "var(--color-background-info)"
          : "var(--color-background-primary)",
        opacity:    isFailed ? 0.5 : 1,
        transition: "background 0.1s ease",
        // CSS containment: tells the browser that visual changes inside this
        // row (background on selection) cannot affect elements outside it.
        contain: "content",
      }}
    >
      {/* ── Score badge (44px) ── */}
      <div style={{
        width:          44,
        flexShrink:     0,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        paddingLeft:    8,
      }}>
        <div style={{
          width:          30,
          height:         30,
          borderRadius:   "50%",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          fontSize:       11,
          fontWeight:     500,
          background:     overall !== null
            ? `${scoreColor(overall)}18`
            : "var(--color-background-secondary)",
          color:          overall !== null
            ? scoreColor(overall)
            : "var(--color-text-secondary)",
          border:         `1px solid ${overall !== null
            ? scoreColor(overall) + "33"
            : "var(--color-border-tertiary)"}`,
        }}>
          {isFailed ? "✕" : (overall ?? "—")}
        </div>
      </div>

      {/* ── Thumbnail (108px) ── */}
      {/*
        16:9 crop image — 88×50px — keeps rows at 68px instead of 750px.
        loading="lazy" skips network requests for off-screen thumbnails.
      */}
      <div style={{
        width:      108,
        flexShrink: 0,
        padding:    "0 10px",
        display:    "flex",
        alignItems: "center",
      }}>
        <div style={{
          width:      88,
          height:     50,
          borderRadius: 4,
          overflow:   "hidden",
          background: "var(--color-bg-subtle)",
          flexShrink: 0,
        }}>
          {clip.thumbnail_url && !isFailed ? (
            <img
              src={clip.thumbnail_url}
              alt={clip.ai_title || "clip thumbnail"}
              loading="lazy"
              decoding="async"
              width={88}
              height={50}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div style={{
              width:          "100%",
              height:         "100%",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       isFailed ? 16 : 11,
              color:          isFailed ? "var(--color-danger)" : "rgba(255,255,255,0.15)",
            }}>
              {isFailed ? "⚠" : "▶"}
            </div>
          )}
        </div>
      </div>

      {/* ── Info column (flexible) ── */}
      <div style={{ flex: 1, minWidth: 0, padding: "0 8px 0 0" }}>
        <div style={{
          fontSize:      12,
          fontWeight:    500,
          color:         isSelected
            ? "var(--color-text-info)"
            : isFailed
              ? "var(--color-text-secondary)"
              : "var(--color-text-primary)",
          whiteSpace:    "nowrap",
          overflow:      "hidden",
          textOverflow:  "ellipsis",
          marginBottom:  3,
          lineHeight:    1.3,
        }}>
          {clip.ai_title || `Clip ${clip.clip_index + 1}`}
        </div>

        {isFailed ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            <span style={{
              fontSize: 10, color: "var(--color-danger)", lineHeight: 1.4,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {(clip.error_message || "Render failed").slice(0, 55)}
            </span>
            <span style={{ fontSize: 9, color: "var(--color-text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>
              · Credits not deducted
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "nowrap" }}>
            {clip.duration_secs > 0 && (
              <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flexShrink: 0 }}>
                {formatDuration(clip.duration_secs)}
              </span>
            )}
            {clip.platform_target && (
              <span style={{
                fontSize:   9,
                padding:    "1px 5px",
                borderRadius: 4,
                background: "var(--color-background-secondary)",
                border:     "0.5px solid var(--color-border-tertiary)",
                color:      "var(--color-text-secondary)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}>
                {clip.platform_target}
              </span>
            )}
            {/* Score dots: 4 coloured circles, full opacity ≥70, dimmed otherwise */}
            {(hook !== null || value !== null) && (
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {[
                  { val: hook,  color: SCORE_BAR_COLORS.Hook,  label: "Hook"  },
                  { val: flow,  color: SCORE_BAR_COLORS.Flow,  label: "Flow"  },
                  { val: value, color: SCORE_BAR_COLORS.Value, label: "Value" },
                  { val: trend, color: SCORE_BAR_COLORS.Trend, label: "Trend" },
                ].filter(d => d.val !== null).map(({ val, color, label }) => (
                  <div
                    key={label}
                    title={`${label}: ${val}`}
                    style={{
                      width:        6,
                      height:       6,
                      borderRadius: "50%",
                      background:   color,
                      opacity:      dotOpacity(val),
                      flexShrink:   0,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Download (36px) ── */}
      {/*
        stopPropagation prevents the row's onClick from firing when clicking
        the download link, which would also select the clip.
      */}
      <div style={{ width: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!isFailed && clip.public_url && (
          <a
            href={clip.public_url}
            download={`clip-${clip.clip_index + 1}.mp4`}
            onClick={(e) => e.stopPropagation()}
            title="Download clip"
            aria-label={`Download ${clip.ai_title || "clip"}`}
            style={{
              width:          26,
              height:         26,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              borderRadius:   5,
              border:         "0.5px solid var(--color-border-tertiary)",
              background:     "var(--color-background-primary)",
              color:          "var(--color-text-secondary)",
              textDecoration: "none",
              fontSize:       12,
              flexShrink:     0,
            }}
          >
            ↓
          </a>
        )}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ClipListPanel — scrollable list container.
// Used in split mode (left 42%) and list mode (full width).
// ─────────────────────────────────────────────────────────────────────────────
export default function ClipListPanel({ clips, selectedClipId, onSelect, fullWidth = false }) {
  return (
    <div style={{
      width:       fullWidth ? "100%" : "42%",
      flexShrink:  0,
      borderRight: fullWidth ? "none" : "0.5px solid var(--color-border-tertiary)",
      display:     "flex",
      flexDirection: "column",
      overflow:    "hidden",
    }}>
      {/* List header */}
      <div style={{
        padding:        "7px 12px",
        borderBottom:   "0.5px solid var(--color-border-tertiary)",
        background:     "var(--color-background-secondary)",
        flexShrink:     0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontSize:      10,
          fontWeight:    500,
          color:         "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          {clips.length} clip{clips.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/*
        overflow-y: auto scopes scrolling to this panel in split mode.
        In list mode the panel expands with content (no fixed parent height).
      */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {clips.map((clip) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            isSelected={clip.id === selectedClipId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
