import styles from "./StatCard.module.css";

const TREND_COLOR = {
  positive: "var(--uiv2-success)",
  negative: "var(--uiv2-text-tertiary)",
  info: "var(--uiv2-info)",
  neutral: "var(--uiv2-text-secondary)",
};

/** Dashboard stat tile: label + big value + optional trend + sub caption. */
export function StatCard({ label, value, trend, trendTone = "neutral", sub, className = "" }) {
  const classes = [styles.card, className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
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
    </div>
  );
}
