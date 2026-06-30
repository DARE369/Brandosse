"use client";

const STYLES = [
  { value: "karaoke",    label: "Karaoke",    description: "Words highlight as spoken"      },
  { value: "bold_drop",  label: "Bold Drop",  description: "Big bold words drop in"         },
  { value: "box_pop",    label: "Box Pop",    description: "Boxed captions pop in"          },
  { value: "classic",    label: "Classic",    description: "Clean white, black outline"     },
  { value: "color_pop",  label: "Color Pop",  description: "Colored emphasis words"         },
  { value: "focus_word", label: "Focus Word", description: "One key word at a time"         },
];

export default function CaptionStylePicker({ value, onChange }) {
  function handleKeyDown(e, index) {
    const total = STYLES.length;
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (index + 1) % total;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (index - 1 + total) % total;
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onChange(STYLES[index].value);
      return;
    }
    if (next !== index) {
      onChange(STYLES[next].value);
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
      aria-label="Caption style"
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {STYLES.map((style, index) => {
        const selected = value === style.value;
        return (
          <div
            key={style.value}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(style.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "center",
              justifyContent: "center",
              gap:           2,
              padding:       "8px 12px",
              borderRadius:  8,
              border:        selected
                ? "1.5px solid var(--color-border-primary)"
                : "0.5px solid var(--color-border-tertiary)",
              background:    selected
                ? "var(--color-background-secondary)"
                : "var(--color-background-primary)",
              cursor:        "pointer",
              minWidth:      80,
              transition:    "border-color 0.12s ease, background 0.12s ease",
              outline:       "none",
              userSelect:    "none",
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 2px var(--color-border-primary)"; }}
            onBlur={(e)  => { e.currentTarget.style.boxShadow = "none"; }}
          >
            <span style={{
              fontSize:   12,
              fontWeight: selected ? 600 : 400,
              color:      selected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              lineHeight: 1,
            }}>
              {style.label}
            </span>
            <span style={{
              fontSize:  9,
              color:     "var(--color-text-secondary)",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}>
              {style.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
