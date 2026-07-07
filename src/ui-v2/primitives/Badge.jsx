import styles from "./Badge.module.css";

const TONE_CLASS = {
  neutral: styles.neutral,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  info: styles.info,
  accent: styles.accent,
};

/** Status pill — "Scheduled", "Failed", "Simulated", "In use", etc. */
export function Badge({ tone = "neutral", dot = false, children, className = "" }) {
  const classes = [styles.badge, TONE_CLASS[tone] || styles.neutral, className].filter(Boolean).join(" ");
  return (
    <span className={classes}>
      {dot ? <span className={styles.dot} /> : null}
      {children}
    </span>
  );
}
