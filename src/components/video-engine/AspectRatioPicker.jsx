"use client";

const RATIOS = [
  { value: "9:16", label: "9:16", description: "TikTok · Reels · Shorts" },
  { value: "4:5",  label: "4:5",  description: "Instagram Feed"           },
  { value: "1:1",  label: "1:1",  description: "Square"                   },
  { value: "16:9", label: "16:9", description: "Landscape · YouTube"      },
];

export default function AspectRatioPicker({ value, onChange }) {
  function handleKeyDown(e, index) {
    const total = RATIOS.length;
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (index + 1) % total;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (index - 1 + total) % total;
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onChange(RATIOS[index].value);
      return;
    }
    if (next !== index) {
      onChange(RATIOS[next].value);
      const group = e.currentTarget.closest('[role="radiogroup"]');
      if (group) {
        const buttons = group.querySelectorAll('[role="radio"]');
        if (buttons[next]) buttons[next].focus();
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Aspect ratio"
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {RATIOS.map((ratio, index) => {
        const selected = value === ratio.value;
        return (
          <div
            key={ratio.value}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(ratio.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "center",
              justifyContent: "center",
              gap:           2,
              padding:       "8px 14px",
              borderRadius:  8,
              border:        selected
                ? "1.5px solid var(--color-border-primary)"
                : "0.5px solid var(--color-border-tertiary)",
              background:    selected
                ? "var(--color-background-secondary)"
                : "var(--color-background-primary)",
              cursor:        "pointer",
              minWidth:      60,
              transition:    "border-color 0.12s ease, background 0.12s ease",
              outline:       "none",
              userSelect:    "none",
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 2px var(--color-border-primary)"; }}
            onBlur={(e)  => { e.currentTarget.style.boxShadow = "none"; }}
          >
            <span style={{
              fontSize:   13,
              fontWeight: selected ? 600 : 400,
              color:      selected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              lineHeight: 1,
            }}>
              {ratio.label}
            </span>
            <span style={{
              fontSize:  9,
              color:     "var(--color-text-secondary)",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}>
              {ratio.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
