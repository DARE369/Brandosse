"use client";

import styles from "./CaptionStylePicker.module.css";

/**
 * The six burned-in caption treatments, each showing what it actually does.
 *
 * ── Why the preview matters ─────────────────────────────────────────────────
 * Captions are the visible output of this product — they are burned into every
 * clip and cannot be changed afterwards without re-running the job. The old
 * picker offered six names and a one-line description, so the only way to find
 * out what "Box Pop" looked like was to spend credits and wait five minutes.
 * Choosing blind and paying to find out is the worst trade in the product.
 *
 * These are CSS approximations, not renders of the real encoder output, and the
 * label says so. An approximation that shows movement direction, weight, and
 * emphasis is enough to choose between six options; pretending it is frame-exact
 * would be the dishonest version.
 *
 * The values map to the server enum in app/api/video/submit/route.ts:31-33.
 */

export const CAPTION_STYLES = [
  { value: "karaoke", name: "Karaoke", desc: "Words highlight as spoken", demo: "spoken", anim: styles.animKaraoke },
  { value: "bold_drop", name: "Bold drop", desc: "Big bold words drop in", demo: "BIG", anim: styles.animDrop },
  { value: "box_pop", name: "Box pop", desc: "Boxed words pop in", demo: "boxed", anim: styles.animPop, boxed: true },
  { value: "classic", name: "Classic", desc: "White text, black outline", demo: "classic", anim: "" },
  { value: "color_pop", name: "Colour pop", desc: "Key words in colour", demo: "colour", anim: styles.animColour, coloured: true },
  { value: "focus_word", name: "Focus word", desc: "One word at a time", demo: "one", anim: styles.animFocus, big: true },
];

export function CaptionStylePicker({ value, onChange, idPrefix = "caption-style" }) {
  function handleKeyDown(event, index) {
    const total = CAPTION_STYLES.length;
    let next = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      next = (index + 1) % total;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      next = (index - 1 + total) % total;
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onChange(CAPTION_STYLES[index].value);
      return;
    } else {
      return;
    }

    onChange(CAPTION_STYLES[next].value);
    const group = event.currentTarget.closest('[role="radiogroup"]');
    group?.querySelectorAll('[role="radio"]')?.[next]?.focus();
  }

  return (
    <div className={styles.grid} role="radiogroup" aria-label="Caption style">
      {CAPTION_STYLES.map((style, index) => {
        const selected = value === style.value;
        return (
          <div
            key={style.value}
            id={`${idPrefix}-${style.value}`}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={[styles.option, selected ? styles.selected : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(style.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className={styles.stage} aria-hidden="true">
              <span
                className={[
                  styles.demo,
                  style.anim,
                  style.boxed ? styles.demoBoxed : "",
                  style.coloured ? styles.demoColoured : "",
                  style.big ? styles.demoBig : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {style.demo}
              </span>
            </span>
            <span className={styles.meta}>
              <span className={styles.name}>{style.name}</span>
              <span className={styles.desc}>{style.desc}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
