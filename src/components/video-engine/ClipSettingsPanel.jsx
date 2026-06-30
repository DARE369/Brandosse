"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import AspectRatioPicker from "./AspectRatioPicker";

// CaptionStylePicker is lazy-loaded so it doesn't bloat the initial bundle.
// The loading fallback is a quiet placeholder so the panel doesn't jump.
const CaptionStylePicker = dynamic(() => import("./CaptionStylePicker"), {
  ssr: false,
  loading: () => (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap",
      opacity: 0.4, pointerEvents: "none",
    }}>
      {["Karaoke", "Bold Drop", "Box Pop", "Classic", "Color Pop", "Focus Word"].map((l) => (
        <div key={l} style={{
          padding: "8px 12px", borderRadius: 8, minWidth: 80,
          border: "0.5px solid var(--color-border-tertiary)",
          background: "var(--color-background-primary)",
          fontSize: 12, color: "var(--color-text-secondary)",
          textAlign: "center",
        }}>{l}</div>
      ))}
    </div>
  ),
});

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", marginLeft: 6 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

const numberInputStyle = {
  width:        "100%",
  padding:      "7px 10px",
  fontSize:     13,
  borderRadius: 7,
  border:       "0.5px solid var(--color-border-tertiary)",
  background:   "var(--color-background-primary)",
  color:        "var(--color-text-primary)",
  outline:      "none",
  boxSizing:    "border-box",
};

export default function ClipSettingsPanel({ prefs, dispatch }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOpen = useCallback(() => setIsOpen((v) => !v), []);

  const hasNonDefault =
    prefs.aspectRatio    !== "9:16"    ||
    prefs.captionStyle   !== "karaoke" ||
    prefs.clipCountTarget !== ""       ||
    prefs.minDuration    !== ""        ||
    prefs.maxDuration    !== ""        ||
    prefs.specificMoments.trim() !== "";

  return (
    <div style={{
      borderRadius: 10,
      border:       "0.5px solid var(--color-border-tertiary)",
      overflow:     "hidden",
    }}>

      {/* Toggle row */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        style={{
          display:        "flex",
          alignItems:     "center",
          gap:            8,
          width:          "100%",
          padding:        "10px 14px",
          background:     "var(--color-background-secondary)",
          border:         "none",
          borderBottom:   isOpen ? "0.5px solid var(--color-border-tertiary)" : "none",
          cursor:         "pointer",
          textAlign:      "left",
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
          Advanced settings
        </span>
        {hasNonDefault && !isOpen && (
          <span style={{
            fontSize:     10,
            padding:      "2px 8px",
            borderRadius: 10,
            background:   "var(--color-background-primary)",
            border:       "0.5px solid var(--color-border-tertiary)",
            color:        "var(--color-text-secondary)",
          }}>
            customised
          </span>
        )}
        <span style={{
          fontSize:   12,
          color:      "var(--color-text-secondary)",
          transform:  isOpen ? "rotate(180deg)" : "none",
          transition: "transform 0.15s ease",
        }}>
          ▾
        </span>
      </button>

      {/* Settings body */}
      {isOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "16px 14px" }}>

          <Field label="Aspect ratio">
            <AspectRatioPicker
              value={prefs.aspectRatio}
              onChange={(val) => dispatch({ type: "SET_ASPECT_RATIO", payload: val })}
            />
          </Field>

          <Field label="Caption style">
            <CaptionStylePicker
              value={prefs.captionStyle}
              onChange={(val) => dispatch({ type: "SET_CAPTION_STYLE", payload: val })}
            />
          </Field>

          <Field label="Number of clips" hint="1–20, leave blank for auto">
            <input
              type="number"
              min={1}
              max={20}
              placeholder="Auto"
              value={prefs.clipCountTarget}
              onChange={(e) => dispatch({ type: "SET_CLIP_COUNT", payload: e.target.value })}
              style={{ ...numberInputStyle, maxWidth: 120 }}
            />
          </Field>

          <Field label="Clip duration" hint="seconds">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={15}
                max={600}
                placeholder="Min (sec)"
                value={prefs.minDuration}
                onChange={(e) => dispatch({ type: "SET_MIN_DURATION", payload: e.target.value })}
                style={{ ...numberInputStyle, flex: 1 }}
              />
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>to</span>
              <input
                type="number"
                min={15}
                max={600}
                placeholder="Max (sec)"
                value={prefs.maxDuration}
                onChange={(e) => dispatch({ type: "SET_MAX_DURATION", payload: e.target.value })}
                style={{ ...numberInputStyle, flex: 1 }}
              />
            </div>
          </Field>

          <Field label="Focus on moments" hint="optional">
            <textarea
              rows={3}
              placeholder="e.g. Find the part where they reveal the main insight, or the funniest moment…"
              value={prefs.specificMoments}
              onChange={(e) => dispatch({ type: "SET_SPECIFIC_MOMENTS", payload: e.target.value })}
              style={{
                ...numberInputStyle,
                resize:     "vertical",
                lineHeight: 1.5,
                fontFamily: "inherit",
              }}
            />
          </Field>

        </div>
      )}
    </div>
  );
}
