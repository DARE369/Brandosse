import styles from "./StatCard.module.css";

const TREND_COLOR = {
  positive: "var(--uiv2-success)",
  negative: "var(--uiv2-text-tertiary)",
  info: "var(--uiv2-info)",
  neutral: "var(--uiv2-text-secondary)",
};

/**
 * Dashboard stat tile: label + big value + optional trend + sub caption.
 *
 * ── Why it can be actionable ────────────────────────────────────────────────
 * The tile took no action at all, which made some of these numbers dead ends.
 * The clearest case: the personal Dashboard counts "Clips ready" as one of four
 * headline figures, and nothing anywhere on that screen led to the Videos
 * surface — the product told a person their clips existed and offered no way to
 * reach them. A number that names something the user owns should be a door to
 * it.
 *
 * Passing `onClick` turns the tile into a real <button> rather than a div with
 * a handler, so it is focusable, keyboard-operable, and announced as
 * actionable. Tiles without one render exactly as before.
 */
export function StatCard({ label, value, trend, trendTone = "neutral", sub, className = "", onClick, actionLabel }) {
  const interactive = typeof onClick === "function";
  const classes = [styles.card, interactive ? styles.interactive : "", className].filter(Boolean).join(" ");

  const content = (
    <>
      <div className={styles.label}>{label}</div>
      <div className={styles.row}>
        <span className={styles.value}>{value}</span>
        {trend ? (
          <span className={styles.trend} style={{ color: TREND_COLOR[trendTone] || TREND_COLOR.neutral }}>
            {trend}
          </span>
        ) : null}
      </div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
    </>
  );

  if (!interactive) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      // The visible label is a noun ("Clips ready"), which does not say what
      // pressing it does. Callers pass the verb.
      aria-label={actionLabel ? `${label}: ${value}. ${actionLabel}` : undefined}
    >
      {content}
    </button>
  );
}
